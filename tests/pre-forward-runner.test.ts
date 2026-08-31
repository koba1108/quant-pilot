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
  buildPreForwardDecisionPackage,
  buildVirtualPortfolioState,
  type PreForwardDecisionPackage,
} from "../src/pre-forward/decision.ts";
import { seedPreForwardFixture } from "../src/pre-forward/fixture-seeder.ts";
import { PreForwardLedger } from "../src/pre-forward/ledger.ts";
import {
  assertPreForwardDailyBarsArtifact,
  buildPreForwardDailyBarsFixture,
  type LoadedPreForwardInput,
  type PreForwardDailyBarsPayload,
} from "../src/pre-forward/market-input.ts";
import {
  preForwardExitCode,
  runPreForward,
} from "../src/pre-forward/runner.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const fixtureConfigPath = join(repositoryRoot, "tests/fixtures/pre-forward/config.json");
const fixtureAsOf = "2025-01-07T00:00:00Z";
const fixtureCreatedAt = "2025-01-07T00:05:00Z";

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

test("manual pre-forward fixture executes Trend/Rotation, persists decisions, replays, and reruns idempotently", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot, ledgerPath }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const first = await runPreForward(configPath, fixtureAsOf, {
      cwd: repositoryRoot,
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

    const second = await runPreForward(configPath, fixtureAsOf, { cwd: repositoryRoot });
    assert.equal(second.status, "executed");
    assert.deepEqual(
      second.results.map((result) => result.decisionArtifactId),
      first.results.map((result) => result.decisionArtifactId),
    );
    assert.ok(second.results.every((result) => result.idempotent && !result.stateTransitionApplied));
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
    await assert.rejects(
      () => runPreForward(configPath, "2025-01-08T00:00:00Z", { cwd: repositoryRoot }),
      /Monthly Pre-Forward cycle 2025-01 already uses cutoff.*intramonth reassessment/,
    );
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const replayed = await runPreForward(configPath, fixtureAsOf, {
      cwd: repositoryRoot,
      replayDecisionArtifactId: first.results[0]!.decisionArtifactId,
    });
    assert.equal(replayed.operation, "replay");
    assert.equal(replayed.results[0]!.decisionArtifactId, first.results[0]!.decisionArtifactId);
    assert.equal(replayed.results[0]!.stateTransitionApplied, false);
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

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

test("the -30% high-water-mark stop liquidates even when distribution evidence is incomplete", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
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
      } as const;
    });
    const input: LoadedPreForwardInput = {
      evidenceTier: "synthetic_fixture",
      disposition: "research_only",
      inputArtifactIds: artifacts.map((artifact) => artifact.provenance.artifactId).sort(),
      series,
      missingCapabilities: ["not_credentialed_provider_evidence"],
      limitations: ["test"],
    };
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
      strategy: config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input,
      universeMaster: await loadUniverseMaster(join(repositoryRoot, config.universe.masterPath!)),
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
    assert.ok(payload.blockedReasons.includes("portfolio:distribution_event_coverage_missing_for_held_interval"));
    assert.ok(payload.blockedReasons.includes("portfolio:cost_aware_replacement_policy_not_approved"));
  });
});
