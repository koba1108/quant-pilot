import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FileArtifactStore } from "../src/data/artifact-store.ts";
import { sha256Canonical } from "../src/data/provenance.ts";
import { loadUniverseMaster } from "../src/data/universe-master.ts";
import { validatePreForwardConfig } from "../src/pre-forward/config.ts";
import {
  assertPreForwardConfigSnapshotArtifact,
  buildPreForwardConfigSnapshotArtifact,
  type PreForwardConfigSnapshotPayload,
} from "../src/pre-forward/config-snapshot.ts";
import {
  buildPreForwardDecisionPackage,
  buildVirtualPortfolioState,
  preForwardBarAvailableAt,
  type PreForwardDecisionPackage,
} from "../src/pre-forward/decision.ts";
import { seedPreForwardFixture } from "../src/pre-forward/fixture-seeder.ts";
import { PreForwardLedger } from "../src/pre-forward/ledger.ts";
import {
  assertPreForwardDailyBarsArtifact,
  buildPreForwardDailyBarsFixture,
  sealLoadedPreForwardInput,
  type LoadedPreForwardInput,
  type PreForwardDailyBarsPayload,
} from "../src/pre-forward/market-input.ts";
import {
  preForwardExitCode,
  runPreForward,
} from "../src/pre-forward/runner.ts";
import { buildPreForwardUniverseSnapshotArtifact } from "../src/pre-forward/universe-snapshot.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const fixtureConfigPath = join(repositoryRoot, "tests/fixtures/pre-forward/config.json");
const fixtureAsOf = "2025-01-07T00:00:00Z";
const fixtureCreatedAt = "2025-01-07T00:05:00Z";
const futureAlphaRevision = "universe-master-v1,univ-alpha-v2,univ-alpha-v1,instrument-alpha,ALPHA,synthetic,Synthetic Alpha,Synthetic,Core,test_candidate,core,false,etf,false,false,false,false,TEST,JPY,2023-01-02,,2026-08-31T00:00:00Z,2026-08-31T00:01:00Z,synthetic-fixture,universe-fixture,2026-08-31T00:02:00Z,v2,record-alpha-v2,future revision";

type MutableConfig = Record<string, any>;

async function baseConfig(): Promise<MutableConfig> {
  return JSON.parse(await readFile(fixtureConfigPath, "utf8")) as MutableConfig;
}

async function withTemporaryRuntime<T>(
  prepare: (value: MutableConfig, root: string) => Promise<void> | void,
  run: (setup: { root: string; configPath: string; artifactRoot: string; ledgerPath: string }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "quant-pilot-pre-forward-"));
  try {
    const value = await baseConfig();
    const artifactRoot = join(root, "artifacts");
    const ledgerPath = join(root, "ledger.sqlite");
    value.artifactRoot = { kind: "absolute", path: artifactRoot };
    value.ledgerPath = { kind: "absolute", path: ledgerPath };
    await prepare(value, root);
    const configPath = join(root, "pre-forward.config.json");
    await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return await run({ root, configPath, artifactRoot, ledgerPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function databaseCounts(path: string): { runs: number; entries: number } {
  const database = new Database(path, { readonly: true, strict: true });
  try {
    const runs = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM pre_forward_runs").get()!.count;
    const entries = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM portfolio_ledger_entries").get()!.count;
    return { runs, entries };
  } finally {
    database.close(true);
  }
}

function universeSnapshotArtifactId(
  master: Awaited<ReturnType<typeof loadUniverseMaster>>,
  createdAt = fixtureCreatedAt,
): string {
  return buildPreForwardUniverseSnapshotArtifact(master, createdAt).provenance.artifactId;
}

function configSnapshotArtifactId(
  config: ReturnType<typeof validatePreForwardConfig>,
  createdAt = fixtureCreatedAt,
): string {
  return buildPreForwardConfigSnapshotArtifact(config, createdAt).provenance.artifactId;
}

async function loadSyntheticDecisionFixture(configPath: string, artifactRoot: string): Promise<{
  config: ReturnType<typeof validatePreForwardConfig>;
  input: LoadedPreForwardInput;
  universeMaster: Awaited<ReturnType<typeof loadUniverseMaster>>;
}> {
  const config = validatePreForwardConfig(JSON.parse(await readFile(configPath, "utf8")) as unknown);
  const store = new FileArtifactStore(artifactRoot);
  const artifacts = await Promise.all(config.input.kind === "daily_bars_manifest"
    ? config.input.dailyBarsArtifactIds.map((id) => store.read<PreForwardDailyBarsPayload>(id))
    : []);
  const series = artifacts.map((artifact) => {
    assertPreForwardDailyBarsArtifact(artifact);
    return {
      code: artifact.payload.stableId,
      currency: artifact.payload.currency,
      bars: artifact.payload.bars,
      artifactId: artifact.provenance.artifactId,
      source: artifact.provenance.source,
      dataset: artifact.provenance.dataset,
      sourceVersion: artifact.provenance.sourceVersion,
      adapterVersion: artifact.provenance.adapterVersion,
      observedAt: artifact.provenance.observedAt,
      availableAt: artifact.provenance.availableAt,
      retrievedAt: artifact.provenance.retrievedAt,
      returnBasis: artifact.payload.returnClassification.adjustedClose,
      availabilityBasis: artifact.payload.availabilityBasis,
      returnEventCoverage: artifact.payload.returnEventCoverage,
    } as const;
  });
  return {
    config,
    input: sealLoadedPreForwardInput({
      evidenceTier: "synthetic_fixture",
      disposition: "research_only",
      inputArtifactIds: artifacts.map((artifact) => artifact.provenance.artifactId).sort(),
      series,
      missingCapabilities: ["not_credentialed_provider_evidence"],
      limitations: ["test"],
    }),
    universeMaster: await loadUniverseMaster(join(repositoryRoot, config.universe.masterPath!)),
  };
}

test("manual pre-forward fixture executes Trend/Rotation, persists decisions, replays, and reruns idempotently", async () => {
  await withTemporaryRuntime(async (value, root) => {
    value.universe.masterPath = "universe-master.csv";
    await writeFile(
      join(root, value.universe.masterPath),
      await readFile(join(repositoryRoot, "tests/fixtures/universe/universe-master-v1.csv"), "utf8"),
      "utf8",
    );
  }, async ({ root, configPath, artifactRoot, ledgerPath }) => {
    const masterPath = join(root, "universe-master.csv");
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });
    const first = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      clock: () => fixtureCreatedAt,
    });
    assert.equal(first.status, "executed");
    assert.equal(first.formalForwardClockStarted, false);
    assert.equal(first.results.length, 2);
    assert.equal(preForwardExitCode(first), 0);
    for (const result of first.results) {
      assert.equal(result.status, "executed");
      assert.equal(result.idempotent, false);
      assert.equal(result.stateTransitionApplied, true);
      assert.equal(result.endingHoldings.length, 3);
      assert.ok(result.orderCount > 0);
      assert.ok(result.modeledCostJpy > 0);
      assert.ok(result.endingCashJpy >= 0 && result.endingCashJpy < 1_000_000);
    }
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const originalMasterText = (await readFile(masterPath, "utf8")).trimEnd();
    await writeFile(masterPath, `${originalMasterText}\n${futureAlphaRevision}\n`, "utf8");
    const revisedMaster = await loadUniverseMaster(masterPath);
    const revisedConfigValue = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    revisedConfigValue.execution.policyVersion += "-next";
    revisedConfigValue.execution.commissionBps += 1;
    for (const strategy of revisedConfigValue.strategies as MutableConfig[]) {
      strategy.strategyConfigVersion += "-next";
    }
    await writeFile(configPath, `${JSON.stringify(revisedConfigValue, null, 2)}\n`, "utf8");
    const revisedConfig = validatePreForwardConfig(revisedConfigValue);
    const second = await runPreForward(configPath, fixtureAsOf, { cwd: root });
    assert.equal(second.status, "executed");
    assert.deepEqual(
      second.results.map((result) => result.decisionArtifactId),
      first.results.map((result) => result.decisionArtifactId),
    );
    assert.ok(second.results.every((result) => result.idempotent && !result.stateTransitionApplied));
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
    await assert.rejects(
      () => runPreForward(configPath, "2025-02-01T00:00:00+14:00", { cwd: root }),
      /Monthly Pre-Forward cycle 2025-01 already uses cutoff.*intramonth reassessment/,
    );
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const unrelatedLedgerPath = join(root, "later-config-ledger.sqlite");
    const relocatedConfigValue = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    relocatedConfigValue.ledgerPath = { kind: "absolute", path: unrelatedLedgerPath };
    await writeFile(configPath, `${JSON.stringify(relocatedConfigValue, null, 2)}\n`, "utf8");
    const replayed = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      replayDecisionArtifactId: first.results[0]!.decisionArtifactId,
    });
    assert.equal(replayed.operation, "replay");
    assert.equal(replayed.results[0]!.decisionArtifactId, first.results[0]!.decisionArtifactId);
    assert.equal(replayed.results[0]!.stateTransitionApplied, false);
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
    await assert.rejects(
      () => lstat(unrelatedLedgerPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

    const store = new FileArtifactStore(artifactRoot);
    for (const result of first.results) {
      const artifact = await store.read<PreForwardDecisionPackage>(result.decisionArtifactId);
      assert.equal(artifact.provenance.artifactKind, "decision_package");
      assert.equal(artifact.payload.mode, "pre_forward_dry_run");
      assert.equal(artifact.payload.cycleId, "2025-01");
      assert.equal(artifact.payload.createdAt, fixtureCreatedAt);
      assert.equal(artifact.provenance.observedAt, fixtureAsOf);
      assert.equal(artifact.provenance.availableAt, fixtureCreatedAt);
      assert.equal(artifact.provenance.retrievedAt, fixtureCreatedAt);
      assert.equal(artifact.payload.quantDecision.selectionMode, "quant_rank_plus_cost_benefit_gate_m2");
      assert.ok(artifact.payload.quantDecision.benefitGate.decisions.every((decision) => (
        decision.passed
          && decision.grossExpectedBenefitBps
            > decision.estimatedExecutionCostBps + decision.safetyMarginBps
      )));
      assert.ok(artifact.payload.execution.orders.every((order) => (
        order.reason === "rebalance"
          && order.benefitGate?.passed === true
          && order.riskOverride === undefined
      )));
      assert.equal(artifact.payload.input.disposition, "research_only");
      assert.notEqual(artifact.payload.configFingerprint, sha256Canonical(revisedConfig));
      assert.match(artifact.payload.configSnapshotArtifactId, /^sha256:[0-9a-f]{64}$/);
      const configSnapshot = await store.read<PreForwardConfigSnapshotPayload>(
        artifact.payload.configSnapshotArtifactId,
      );
      assertPreForwardConfigSnapshotArtifact(configSnapshot);
      assert.equal(configSnapshot.payload.configFingerprint, artifact.payload.configFingerprint);
      assert.notEqual(
        configSnapshot.payload.config.execution.policyVersion,
        revisedConfig.execution.policyVersion,
      );
      assert.notEqual(artifact.payload.universe.masterFingerprint, revisedMaster.fingerprint);
      assert.match(artifact.payload.universe.snapshotArtifactId!, /^sha256:[0-9a-f]{64}$/);
      assert.equal(artifact.payload.portfolio.afterState.positions.length, 3);
    }
    if (process.platform !== "win32") {
      assert.equal((await lstat(artifactRoot)).mode & 0o777, 0o700);
      assert.equal((await lstat(ledgerPath)).mode & 0o777, 0o600);
    }
    const ledger = await PreForwardLedger.open(ledgerPath);
    try {
      ledger.assertAppendOnlyGuards();
    } finally {
      ledger.close();
    }
  });
});

test("D-009 cost-benefit gate keeps marginal synthetic trades in cash", async () => {
  await withTemporaryRuntime((value) => {
    for (const instrument of value.execution.instruments as MutableConfig[]) {
      instrument.expectedBenefit.grossExpectedBenefitBps = 1;
    }
    for (const strategy of value.strategies as MutableConfig[]) {
      strategy.portfolioId += "-benefit-gate";
      strategy.strategyConfigVersion += "-benefit-gate";
    }
  }, async ({ configPath, artifactRoot, ledgerPath }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const report = await runPreForward(configPath, fixtureAsOf, {
      cwd: repositoryRoot,
      clock: () => fixtureCreatedAt,
    });
    assert.equal(report.status, "executed");
    assert.ok(report.results.every((result) => (
      result.orderCount === 0
        && result.endingCashJpy === 1_000_000
        && result.endingHoldings.length === 0
    )));
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
    const store = new FileArtifactStore(artifactRoot);
    for (const result of report.results) {
      const artifact = await store.read<PreForwardDecisionPackage>(result.decisionArtifactId);
      assert.deepEqual(artifact.payload.quantDecision.effectiveTargetWeights, { CASH: 1 });
      assert.ok(artifact.payload.quantDecision.benefitGate.decisions.every((decision) => !decision.passed));
    }
  });
});

test("signal history excludes every bar from before the resolved ETF listing date", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const records = fixture.universeMaster.records.map((record) => (
      record.code === "ALPHA" ? { ...record, listingDate: "2024-12-01" } : record
    ));
    const masterBody = { schemaVersion: fixture.universeMaster.schemaVersion, records };
    const universeMaster = { ...masterBody, fingerprint: sha256Canonical(masterBody) };
    const beforeState = buildVirtualPortfolioState({
      portfolioId: fixture.config.strategies[0].portfolioId,
      cashJpy: 1_000_000,
      positions: [],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: false,
    });
    const changedConfig = structuredClone(fixture.config);
    changedConfig.signal.maxDataAgeDays += 1;
    assert.throws(() => buildPreForwardDecisionPackage({
      config: changedConfig,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(changedConfig),
      strategy: changedConfig.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input: fixture.input,
      universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(universeMaster),
      beforeState,
    }), /Pre-forward config changed after validation/);
    const changedStrategy = structuredClone(fixture.config.strategies[0]);
    changedStrategy.strategyVersion += "-not-configured";
    assert.throws(() => buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(fixture.config),
      strategy: changedStrategy,
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input: fixture.input,
      universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(universeMaster),
      beforeState,
    }), /Pre-forward strategy is not bound to the validated config/);
    assert.throws(() => buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(
        fixture.config,
        "2025-01-07T00:06:00Z",
      ),
      strategy: fixture.config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input: fixture.input,
      universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(universeMaster),
      beforeState,
    }), /Pre-forward config must be bound to its retained snapshot artifact/);
    const payload = buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(fixture.config),
      strategy: fixture.config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input: fixture.input,
      universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(universeMaster),
      beforeState,
    });
    const diagnostic = payload.instrumentDiagnostics.find((item) => item.code === "ALPHA")!;
    assert.ok(diagnostic.excludedPreListingBarCount > 0);
    assert.ok(diagnostic.firstTradingDate === undefined || diagnostic.firstTradingDate >= "2024-12-01");
    assert.ok(diagnostic.usableBarCount < fixture.config.signal.minHistoryBars);
    assert.ok(diagnostic.blockers.includes("insufficient_history"));
    assert.equal(diagnostic.snapshot, undefined);
    assert.ok(!payload.quantDecision.ranking.some((asset) => asset.code === "ALPHA"));
  });
});

test("same-day closing bars remain unavailable before the conservative close floor", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const { integrityFingerprint: _integrityFingerprint, ...inputBody } = fixture.input;
    const input = sealLoadedPreForwardInput({
      ...inputBody,
      series: fixture.input.series.map((series) => ({
        ...series,
        availableAt: "2025-01-01T00:00:00Z",
      })),
    });
    const asOf = "2025-01-06T06:59:59Z";
    const payload = buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(fixture.config),
      strategy: fixture.config.strategies[0],
      asOf,
      createdAt: fixtureCreatedAt,
      input,
      universeMaster: fixture.universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(fixture.universeMaster),
      beforeState: buildVirtualPortfolioState({
        portfolioId: fixture.config.strategies[0].portfolioId,
        cashJpy: 1_000_000,
        positions: [],
        distributionReceivables: [],
        highWaterMarkJpy: 1_000_000,
        stopped: false,
      }),
    });
    for (const diagnostic of payload.instrumentDiagnostics) {
      assert.equal(diagnostic.signalDate, "2025-01-03");
      assert.equal(diagnostic.excludedUnavailableBarCount, 1);
      assert.ok(Date.parse(diagnostic.signalBarAvailableAt!) <= Date.parse(asOf));
      assert.equal(
        preForwardBarAvailableAt(input.series.find((series) => series.code === diagnostic.code)!, "2025-01-06"),
        "2025-01-06T07:00:00.000Z",
      );
    }
  });
});

test("incomplete retained input is blocked explicitly and never moves virtual cash", async () => {
  await withTemporaryRuntime(async (value, root) => {
    const artifact = buildPreForwardDailyBarsFixture({
      code: "JPX:1308",
      bars: [
        { code: "JPX:1308", tradingDate: "2026-04-20", close: 100, adjustedClose: 100, volume: 10 },
        { code: "JPX:1308", tradingDate: "2026-04-21", close: 101, adjustedClose: 101, volume: 11 },
        { code: "JPX:1308", tradingDate: "2026-04-22", close: 102, adjustedClose: 102, volume: 12 },
      ],
      observedAt: "2026-04-22T15:00:00Z",
      availableAt: "2026-08-29T09:07:28Z",
      retrievedAt: "2026-08-29T09:07:28Z",
    });
    value.input.dailyBarsArtifactIds = [artifact.provenance.artifactId];
    delete value.universe.masterPath;
    value.universe.allowedStatuses = ["pre_forward_candidate"];
    value.execution.instruments = [];
    for (const strategy of value.strategies as MutableConfig[]) {
      strategy.validFrom = "2026-08-29";
      strategy.validThrough = "2026-09-30";
      strategy.portfolioId += "-blocked";
      strategy.strategyConfigVersion += "-blocked";
    }
    const store = new FileArtifactStore(join(root, "artifacts"));
    await store.put(artifact);
  }, async ({ configPath, ledgerPath }) => {
    const first = await runPreForward(configPath, "2026-08-31T00:00:00Z", { cwd: repositoryRoot });
    assert.equal(first.status, "blocked");
    assert.equal(preForwardExitCode(first), 1);
    for (const result of first.results) {
      assert.equal(result.status, "blocked");
      assert.equal(result.stateTransitionApplied, false);
      assert.equal(result.endingCashJpy, 1_000_000);
      assert.deepEqual(result.endingHoldings, []);
      assert.ok(result.blockedReasons.includes("JPX:1308:insufficient_history"));
      assert.ok(result.blockedReasons.includes("JPX:1308:stale_market_data"));
      assert.ok(result.blockedReasons.includes("JPX:1308:universe_master_missing"));
      assert.ok(result.blockedReasons.includes("JPX:1308:missing_execution_assumptions"));
      assert.ok(result.blockedReasons.includes("JPX:1308:missing_expected_benefit_evidence"));
    }
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 0 });
    const second = await runPreForward(configPath, "2026-08-31T00:00:00Z", { cwd: repositoryRoot });
    assert.ok(second.results.every((result) => result.idempotent && !result.stateTransitionApplied));
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 0 });
  });
});

test("the -30% high-water-mark stop liquidates when complete no-event coverage proves held units", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const { config, input, universeMaster } = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const beforeState = buildVirtualPortfolioState({
      portfolioId: config.strategies[0].portfolioId,
      cashJpy: 0,
      positions: [{ code: "ALPHA", units: 1_000, averageCostJpy: 1_000 }],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: false,
      lastAsOf: "2025-01-01T00:00:00Z",
    });
    const payload = buildPreForwardDecisionPackage({
      config,
      configFingerprint: sha256Canonical(config),
      configSnapshotArtifactId: configSnapshotArtifactId(config),
      strategy: config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input,
      universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(universeMaster),
      beforeState,
    });
    assert.equal(payload.status, "executed");
    assert.equal(payload.risk.hardStopTriggered, true);
    assert.equal(payload.risk.hardStopPhase, "before_rebalance");
    assert.equal(payload.portfolio.afterState.stopped, true);
    assert.deepEqual(payload.portfolio.afterState.positions, []);
    assert.equal(payload.execution.orders.length, 1);
    assert.equal(payload.execution.orders[0]!.side, "sell");
    assert.equal(payload.execution.orders[0]!.reason, "hard_stop_before_rebalance");
    assert.equal(payload.execution.orders[0]!.riskOverride, "d010_mandatory_liquidation");
    assert.equal(payload.execution.orders[0]!.benefitGate, undefined);
    assert.ok(payload.execution.totalModeledCostJpy > 0);
    assert.equal(payload.risk.valuationEventCoverage, "complete_synthetic_no_events");
    assert.equal(payload.distributionAccounting.coverage, "complete_synthetic_no_events");
    assert.ok(!payload.blockedReasons.includes("portfolio:distribution_event_coverage_missing_for_held_interval"));
    assert.ok(payload.blockedReasons.includes("portfolio:cost_aware_replacement_policy_not_approved"));
  });
});

test("held-unit valuation fails closed when event coverage does not reach the decision cutoff", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const tamperedInput: LoadedPreForwardInput = {
      ...fixture.input,
      series: fixture.input.series.map((series) => ({
        ...series,
        returnEventCoverage: {
          ...series.returnEventCoverage!,
          endDate: series.bars.at(-1)!.tradingDate,
        },
      })),
    };
    const beforeState = buildVirtualPortfolioState({
      portfolioId: fixture.config.strategies[0].portfolioId,
      cashJpy: 0,
      positions: [{ code: "ALPHA", units: 1_000, averageCostJpy: 1_000 }],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: false,
      lastAsOf: "2025-01-01T00:00:00Z",
    });
    assert.throws(() => buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(fixture.config),
      strategy: fixture.config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input: tamperedInput,
      universeMaster: fixture.universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(fixture.universeMaster),
      beforeState,
    }), /Loaded pre-forward inputs changed after artifact validation/);
    const { integrityFingerprint: _integrityFingerprint, ...inputBody } = tamperedInput;
    const input = sealLoadedPreForwardInput(inputBody);
    assert.ok(input.series.every((series) => (
      series.returnEventCoverage!.endDate < fixtureAsOf.slice(0, 10)
    )));
    const payload = buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(fixture.config),
      strategy: fixture.config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input,
      universeMaster: fixture.universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(fixture.universeMaster),
      beforeState,
    });
    assert.equal(payload.status, "blocked");
    assert.equal(payload.risk.valuationEventCoverage, "missing_event_artifacts");
    assert.equal(payload.portfolio.beforeValuation, undefined);
    assert.equal(payload.risk.hardStopTriggered, false);
    assert.deepEqual(payload.execution.orders, []);
    assert.deepEqual(payload.portfolio.afterState, beforeState);
    assert.ok(payload.blockedReasons.includes("ALPHA:held_interval_return_event_coverage_missing"));
    assert.ok(payload.blockedReasons.includes("portfolio:corporate_action_unit_coverage_missing_for_held_interval"));
    assert.ok(payload.blockedReasons.includes("portfolio:distribution_event_coverage_missing_for_held_interval"));
  });
});

test("a stopped portfolio cannot bypass chronology during a safety cycle", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const beforeState = buildVirtualPortfolioState({
      portfolioId: fixture.config.strategies[0].portfolioId,
      cashJpy: 650_000,
      positions: [],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: true,
      stoppedAt: "2025-02-01T00:00:00Z",
      lastAsOf: "2025-02-01T00:00:00Z",
    });
    const payload = buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(
        fixture.config,
        "2025-02-02T00:00:00Z",
      ),
      strategy: fixture.config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: "2025-02-02T00:00:00Z",
      input: fixture.input,
      universeMaster: fixture.universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(
        fixture.universeMaster,
        "2025-02-02T00:00:00Z",
      ),
      beforeState,
    });
    assert.equal(payload.status, "blocked");
    assert.ok(payload.blockedReasons.includes("portfolio:as_of_not_after_last_state"));
    assert.deepEqual(payload.execution.orders, []);
    assert.deepEqual(payload.portfolio.afterState, beforeState);
    assert.equal(payload.portfolio.afterState.lastAsOf, "2025-02-01T00:00:00Z");
  });
});

test("pre-forward daily-bar artifacts cannot claim observation before a contained bar", () => {
  assert.throws(
    () => buildPreForwardDailyBarsFixture({
      code: "ALPHA",
      bars: [{ code: "ALPHA", tradingDate: "2025-01-07", close: 100, adjustedClose: 100 }],
      observedAt: "2025-01-06T15:00:00Z",
      availableAt: "2025-01-08T00:00:00Z",
      retrievedAt: "2025-01-08T00:00:00Z",
    }),
    /cannot predate a contained trading date/,
  );

  assert.throws(
    () => buildPreForwardDailyBarsFixture({
      code: "ALPHA",
      bars: [{ code: "ALPHA", tradingDate: "2025-01-07", close: 100, adjustedClose: 100 }],
      observedAt: "2025-01-07T00:00:00+14:00",
      availableAt: "2025-01-07T00:00:00+14:00",
      retrievedAt: "2025-01-07T00:00:00Z",
    }),
    /cannot predate a contained trading date/,
  );
});
