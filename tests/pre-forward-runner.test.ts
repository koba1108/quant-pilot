import { test } from "bun:test";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FileArtifactStore } from "../src/data/artifact-store.ts";
import { captureCredentialedSample } from "../src/data/credentialed-sample-runner.ts";
import { sha256Canonical } from "../src/data/provenance.ts";
import { loadUniverseMaster } from "../src/data/universe-master.ts";
import { validatePreForwardConfig } from "../src/pre-forward/config.ts";
import {
  assertPreForwardConfigSnapshotArtifact,
  buildPreForwardConfigSnapshotArtifact,
  type PreForwardConfigSnapshotPayload,
} from "../src/pre-forward/config-snapshot.ts";
import {
  assertPreForwardCredentialedConfigSnapshotArtifact,
  type PreForwardCredentialedConfigSnapshotPayload,
} from "../src/pre-forward/credentialed-config-snapshot.ts";
import {
  buildPreForwardDecisionArtifact,
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
const credentialedFixtureConfigPath = join(repositoryRoot, "research/provider-samples/fixture.config.json");
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
    const artifactRoot = join(root, "data/generated/pre-forward/artifacts");
    const ledgerPath = join(root, "data/generated/pre-forward/ledger.sqlite");
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

async function loadSyntheticDecisionFixture(
  configPath: string,
  artifactRoot: string,
  cwd = repositoryRoot,
): Promise<{
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
  }).sort((left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
  return {
    config,
    input: sealLoadedPreForwardInput({
      evidenceTier: "synthetic_fixture",
      disposition: "research_only",
      inputArtifactIds: artifacts.map((artifact) => artifact.provenance.artifactId).sort(),
      series,
      missingCapabilities: ["not_credentialed_provider_evidence"],
      limitations: [
        "Synthetic artifacts validate the manual Pre-Forward operating loop, not investment performance.",
        "Provider-adjusted values are not classified as Total Return.",
      ],
    }),
    universeMaster: await loadUniverseMaster(join(cwd, config.universe.masterPath!)),
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

    const store = new FileArtifactStore(artifactRoot);
    const initial = await loadSyntheticDecisionFixture(configPath, artifactRoot, root);
    const orphanCreatedAt = "2025-01-07T00:06:00Z";
    const orphanConfigSnapshot = buildPreForwardConfigSnapshotArtifact(initial.config, orphanCreatedAt);
    const orphanUniverseSnapshot = buildPreForwardUniverseSnapshotArtifact(
      initial.universeMaster,
      orphanCreatedAt,
    );
    await store.put(orphanConfigSnapshot);
    await store.put(orphanUniverseSnapshot);
    const orphanPayload = buildPreForwardDecisionPackage({
      config: initial.config,
      configFingerprint: sha256Canonical(initial.config),
      configSnapshotArtifactId: orphanConfigSnapshot.provenance.artifactId,
      strategy: initial.config.strategies[0]!,
      asOf: fixtureAsOf,
      createdAt: orphanCreatedAt,
      input: initial.input,
      universeMaster: initial.universeMaster,
      universeSnapshotArtifactId: orphanUniverseSnapshot.provenance.artifactId,
      beforeState: buildVirtualPortfolioState({
        portfolioId: initial.config.strategies[0]!.portfolioId,
        cashJpy: 1_000_000,
        positions: [],
        distributionReceivables: [],
        highWaterMarkJpy: 1_000_000,
        stopped: false,
      }),
    });
    const orphanArtifact = buildPreForwardDecisionArtifact(orphanPayload);
    await store.put(orphanArtifact);
    assert.notEqual(orphanArtifact.provenance.artifactId, first.results[0]!.decisionArtifactId);
    await assert.rejects(
      () => runPreForward(configPath, fixtureAsOf, {
        cwd: root,
        replayDecisionArtifactId: orphanArtifact.provenance.artifactId,
      }),
      /run index does not match its Decision Package/,
    );
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const originalMasterText = (await readFile(masterPath, "utf8")).trimEnd();
    await writeFile(masterPath, `${originalMasterText}\n${futureAlphaRevision}\n`, "utf8");
    const revisedMaster = await loadUniverseMaster(masterPath);
    const revisedConfigValue = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    revisedConfigValue.execution.policyVersion += "-next";
    revisedConfigValue.execution.commissionBps += 1;
    for (const strategy of revisedConfigValue.strategies as MutableConfig[]) {
      strategy.strategyConfigVersion += "-next";
      strategy.validFrom = "2025-02-01";
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
    const relocatedRepeat = await runPreForward(configPath, fixtureAsOf, { cwd: root });
    assert.deepEqual(
      relocatedRepeat.results.map((result) => result.decisionArtifactId),
      first.results.map((result) => result.decisionArtifactId),
    );
    assert.ok(relocatedRepeat.results.every((result) => result.idempotent && !result.stateTransitionApplied));
    await assert.rejects(
      () => lstat(unrelatedLedgerPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    await assert.rejects(
      () => runPreForward(configPath, "2025-02-03T00:00:00Z", { cwd: root }),
      /ledger relocation.*explicit audited migration/,
    );
    const reassociatedConfigValue = structuredClone(revisedConfigValue);
    const reassociatedStrategies = reassociatedConfigValue.strategies as MutableConfig[];
    const firstPortfolioId = reassociatedStrategies[0]!.portfolioId;
    reassociatedStrategies[0]!.portfolioId = reassociatedStrategies[1]!.portfolioId;
    reassociatedStrategies[1]!.portfolioId = firstPortfolioId;
    await writeFile(configPath, `${JSON.stringify(reassociatedConfigValue, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => runPreForward(configPath, "2025-02-03T00:00:00Z", { cwd: root }),
      /strategy reassignment.*explicit audited amendment/,
    );
    const replayed = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      replayDecisionArtifactId: first.results[0]!.decisionArtifactId,
    });
    assert.equal(replayed.operation, "replay");
    assert.equal(replayed.results[0]!.decisionArtifactId, first.results[0]!.decisionArtifactId);
    assert.equal(replayed.results[0]!.stateTransitionApplied, false);
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const relocatedArtifactRoot = join(root, "data/generated/pre-forward/relocated-artifacts");
    const doublyRelocatedLedgerPath = join(root, "doubly-relocated-ledger.sqlite");
    const doublyRelocatedConfigValue = structuredClone(revisedConfigValue);
    doublyRelocatedConfigValue.artifactRoot = { kind: "absolute", path: relocatedArtifactRoot };
    doublyRelocatedConfigValue.ledgerPath = { kind: "absolute", path: doublyRelocatedLedgerPath };
    await writeFile(configPath, `${JSON.stringify(doublyRelocatedConfigValue, null, 2)}\n`, "utf8");
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });
    await assert.rejects(
      () => runPreForward(configPath, fixtureAsOf, { cwd: root }),
      /artifactRoot relocation.*explicit audited migration/,
    );
    await assert.rejects(
      () => lstat(doublyRelocatedLedgerPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

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

test("explicit replay resolves the retained portfolio binding after current portfolio IDs are replaced", async () => {
  await withTemporaryRuntime(async (value, root) => {
    value.universe.masterPath = "universe-master.csv";
    await writeFile(
      join(root, value.universe.masterPath),
      await readFile(join(repositoryRoot, "tests/fixtures/universe/universe-master-v1.csv"), "utf8"),
      "utf8",
    );
  }, async ({ root, configPath, ledgerPath }) => {
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });
    const first = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      clock: () => fixtureCreatedAt,
    });
    const retainedDecisionArtifactId = first.results[0]!.decisionArtifactId;
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const replacementConfig = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    for (const strategy of replacementConfig.strategies as MutableConfig[]) {
      strategy.portfolioId += "-new-experiment";
      strategy.strategyConfigVersion += "-new-experiment";
    }
    await writeFile(configPath, `${JSON.stringify(replacementConfig, null, 2)}\n`, "utf8");

    const bindingRoot = join(root, "data/generated/pre-forward/runtime-bindings");
    const replayedBeforeEnrollment = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      replayDecisionArtifactId: retainedDecisionArtifactId,
    });
    assert.equal(replayedBeforeEnrollment.results[0]!.decisionArtifactId, retainedDecisionArtifactId);
    assert.equal(replayedBeforeEnrollment.results[0]!.stateTransitionApplied, false);
    assert.equal((await readdir(bindingRoot)).length, 2);
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });

    const replacementRun = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      clock: () => fixtureCreatedAt,
    });
    assert.ok(replacementRun.results.every((result) => result.stateTransitionApplied));
    assert.equal((await readdir(bindingRoot)).length, 4);
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 4, entries: 4 });

    const replayedAfterEnrollment = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      replayDecisionArtifactId: retainedDecisionArtifactId,
    });
    assert.equal(replayedAfterEnrollment.results[0]!.decisionArtifactId, retainedDecisionArtifactId);
    assert.equal(replayedAfterEnrollment.results[0]!.stateTransitionApplied, false);
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 4, entries: 4 });
  });
});

test("retained decisions fail closed without recreating a missing ledger", async () => {
  await withTemporaryRuntime(async (value, root) => {
    value.universe.masterPath = "universe-master.csv";
    await writeFile(
      join(root, value.universe.masterPath),
      await readFile(join(repositoryRoot, "tests/fixtures/universe/universe-master-v1.csv"), "utf8"),
      "utf8",
    );
  }, async ({ root, configPath, ledgerPath }) => {
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });
    const first = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      clock: () => fixtureCreatedAt,
    });
    assert.equal(first.status, "executed");
    await rm(ledgerPath, { force: true });

    for (const request of [
      () => runPreForward(configPath, fixtureAsOf, { cwd: root }),
      () => runPreForward(configPath, "2025-02-03T00:00:00Z", { cwd: root }),
      () => runPreForward(configPath, fixtureAsOf, {
        cwd: root,
        replayDecisionArtifactId: first.results[0]!.decisionArtifactId,
      }),
    ]) {
      await assert.rejects(
        request,
        /Retained pre-forward ledger is missing; execution requires explicit audited recovery/,
      );
      await assert.rejects(
        () => lstat(ledgerPath),
        (error: NodeJS.ErrnoException) => error.code === "ENOENT",
      );
    }
  });
});

test("a portfolio cannot advance when a committed Decision Package is missing", async () => {
  await withTemporaryRuntime(async (value, root) => {
    value.universe.masterPath = "universe-master.csv";
    await writeFile(
      join(root, value.universe.masterPath),
      await readFile(join(repositoryRoot, "tests/fixtures/universe/universe-master-v1.csv"), "utf8"),
      "utf8",
    );
  }, async ({ root, configPath, artifactRoot, ledgerPath }) => {
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });
    const first = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      clock: () => fixtureCreatedAt,
    });
    assert.equal(first.status, "executed");
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
    const missingArtifactPath = join(
      artifactRoot,
      `${first.results[0]!.decisionArtifactId.slice("sha256:".length)}.json`,
    );
    await rm(missingArtifactPath, { force: true });

    await assert.rejects(
      () => runPreForward(configPath, "2025-02-03T00:00:00Z", { cwd: root }),
      /Committed Pre-Forward Decision Package is missing for run/,
    );
    await assert.rejects(
      () => lstat(missingArtifactPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
  });
});

test("an invalid first-run ledger cannot persist runtime bindings", async () => {
  await withTemporaryRuntime(async () => {}, async ({ root, configPath, ledgerPath }) => {
    await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
    await writeFile(ledgerPath, "not a sqlite database", { mode: 0o600 });

    await assert.rejects(() => runPreForward(configPath, fixtureAsOf, { cwd: root }));
    const bindingRoot = join(root, "data/generated/pre-forward/runtime-bindings");
    assert.equal((await readdir(bindingRoot)).length, 0);

    const correctedLedgerPath = join(root, "data/generated/pre-forward/corrected-ledger.sqlite");
    const correctedConfig = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    correctedConfig.ledgerPath = { kind: "absolute", path: correctedLedgerPath };
    await writeFile(configPath, `${JSON.stringify(correctedConfig, null, 2)}\n`, "utf8");

    await assert.rejects(() => runPreForward(configPath, fixtureAsOf, { cwd: root }));
    assert.deepEqual(databaseCounts(correctedLedgerPath), { runs: 0, entries: 0 });
    assert.equal(
      (await readdir(bindingRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length,
      2,
    );
  });
});

test("an invalid first-run artifact root cannot persist runtime bindings", async () => {
  if (process.platform === "win32") return;
  await withTemporaryRuntime(async (value, root) => {
    value.universe.masterPath = "universe-master.csv";
    await writeFile(
      join(root, value.universe.masterPath),
      await readFile(join(repositoryRoot, "tests/fixtures/universe/universe-master-v1.csv"), "utf8"),
      "utf8",
    );
  }, async ({ root, configPath, artifactRoot, ledgerPath }) => {
    await mkdir(artifactRoot, { recursive: true, mode: 0o755 });
    await chmod(dirname(artifactRoot), 0o700);
    await chmod(artifactRoot, 0o755);

    await assert.rejects(
      () => runPreForward(configPath, fixtureAsOf, { cwd: root }),
      /Artifact store root permissions must be owner-only \(0700\)/,
    );
    const bindingRoot = join(root, "data/generated/pre-forward/runtime-bindings");
    await assert.rejects(
      () => lstat(bindingRoot),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    await assert.rejects(
      () => lstat(ledgerPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

    const correctedArtifactRoot = join(root, "data/generated/pre-forward/corrected-artifacts");
    const correctedConfig = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    correctedConfig.artifactRoot = { kind: "absolute", path: correctedArtifactRoot };
    await writeFile(configPath, `${JSON.stringify(correctedConfig, null, 2)}\n`, "utf8");
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });

    const report = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
      clock: () => fixtureCreatedAt,
    });
    assert.equal(report.status, "executed");
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
    assert.equal(
      (await readdir(bindingRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length,
      2,
    );
  });
});

test("runtime binding pins the ledger before a decision and missing binding evidence blocks", async () => {
  await withTemporaryRuntime(async () => {}, async ({ root, configPath, ledgerPath }) => {
    await assert.rejects(() => runPreForward(configPath, fixtureAsOf, { cwd: root }));
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 0, entries: 0 });

    const originalConfig = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    const alternateLedgerPath = join(root, "data/generated/pre-forward/alternate-ledger.sqlite");
    const alternateConfig = structuredClone(originalConfig);
    alternateConfig.ledgerPath = { kind: "absolute", path: alternateLedgerPath };
    await writeFile(configPath, `${JSON.stringify(alternateConfig, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => runPreForward(configPath, fixtureAsOf, { cwd: root }),
      /ledger relocation.*explicit audited migration/,
    );
    await assert.rejects(
      () => lstat(alternateLedgerPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

    await writeFile(configPath, `${JSON.stringify(originalConfig, null, 2)}\n`, "utf8");
    const reassignedConfig = structuredClone(originalConfig);
    const reassignedStrategies = reassignedConfig.strategies as MutableConfig[];
    const firstPortfolioId = reassignedStrategies[0]!.portfolioId;
    reassignedStrategies[0]!.portfolioId = reassignedStrategies[1]!.portfolioId;
    reassignedStrategies[1]!.portfolioId = firstPortfolioId;
    await writeFile(configPath, `${JSON.stringify(reassignedConfig, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => runPreForward(configPath, fixtureAsOf, { cwd: root }),
      /strategy reassignment.*explicit audited amendment/,
    );
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 0, entries: 0 });

    await writeFile(configPath, `${JSON.stringify(originalConfig, null, 2)}\n`, "utf8");
    const bindingRoot = join(root, "data/generated/pre-forward/runtime-bindings");
    const bindingDirectories = (await readdir(bindingRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.equal(bindingDirectories.length, 2);
    const missingBindingPath = join(bindingRoot, bindingDirectories[0]!, "runtime.binding.json");
    await rm(missingBindingPath, { force: true });
    await assert.rejects(
      () => runPreForward(configPath, fixtureAsOf, { cwd: root }),
      /runtime binding is missing.*explicit audited process/,
    );
    await assert.rejects(
      () => lstat(missingBindingPath),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 0, entries: 0 });
  });
});

test("D-009 cost-benefit gate keeps marginal synthetic trades in cash", async () => {
  await withTemporaryRuntime(async (value, root) => {
    for (const instrument of value.execution.instruments as MutableConfig[]) {
      instrument.expectedBenefit.grossExpectedBenefitBps = 1;
    }
    for (const strategy of value.strategies as MutableConfig[]) {
      strategy.portfolioId += "-benefit-gate";
      strategy.strategyConfigVersion += "-benefit-gate";
    }
    value.universe.masterPath = "universe-master.csv";
    await writeFile(
      join(root, value.universe.masterPath),
      await readFile(join(repositoryRoot, "tests/fixtures/universe/universe-master-v1.csv"), "utf8"),
      "utf8",
    );
  }, async ({ root, configPath, artifactRoot, ledgerPath }) => {
    await seedPreForwardFixture(configPath, {
      cwd: root,
      csvRoot: join(repositoryRoot, "tests/fixtures/market-data"),
    });
    const report = await runPreForward(configPath, fixtureAsOf, {
      cwd: root,
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

    const reassignedConfig = JSON.parse(await readFile(configPath, "utf8")) as MutableConfig;
    const reassignedStrategies = reassignedConfig.strategies as MutableConfig[];
    const firstPortfolioId = reassignedStrategies[0]!.portfolioId;
    reassignedStrategies[0]!.portfolioId = reassignedStrategies[1]!.portfolioId;
    reassignedStrategies[1]!.portfolioId = firstPortfolioId;
    await writeFile(configPath, `${JSON.stringify(reassignedConfig, null, 2)}\n`, "utf8");

    for (const asOf of [fixtureAsOf, "2025-02-03T00:00:00Z"]) {
      await assert.rejects(
        () => runPreForward(configPath, asOf, { cwd: root }),
        /strategy reassignment.*explicit audited amendment/,
      );
    }
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 2 });
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
    const store = new FileArtifactStore(join(root, "data/generated/pre-forward/artifacts"));
    await store.put(artifact);
  }, async ({ root, configPath, ledgerPath }) => {
    const first = await runPreForward(configPath, "2026-08-31T00:00:00Z", { cwd: root });
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
    const second = await runPreForward(configPath, "2026-08-31T00:00:00Z", { cwd: root });
    assert.ok(second.results.every((result) => result.idempotent && !result.stateTransitionApplied));
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 0 });
  });

  await withTemporaryRuntime(async (value, root) => {
    const sampleConfig = JSON.parse(await readFile(credentialedFixtureConfigPath, "utf8")) as MutableConfig;
    sampleConfig.mode = "live";
    sampleConfig.artifactRoot = {
      kind: "absolute",
      path: join(root, "data/generated/provider-sample/source-artifacts"),
    };
    for (const provider of sampleConfig.providers as MutableConfig[]) delete provider.fixtureFile;
    sampleConfig.credentialUseAuthorized = true;
    sampleConfig.costAuthorized = true;
    sampleConfig.rawRetentionAuthorized = true;
    sampleConfig.licenseRetentionConfirmed = true;
    const sampleConfigPath = join(root, "sample.config.json");
    await writeFile(sampleConfigPath, `${JSON.stringify(sampleConfig, null, 2)}\n`, "utf8");
    const jquantsToken = "authorized-jquants-token";
    const eodhdToken = "authorized-eodhd-token";
    const captured = await captureCredentialedSample(sampleConfigPath, {
      cwd: root,
      env: { JQUANTS_API_KEY: jquantsToken, EODHD_API_TOKEN: eodhdToken },
      fetchImpl: (async (input: string | URL | Request): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.origin === "https://api.jquants.com") {
          const code = url.searchParams.get("code")!;
          return new Response(JSON.stringify({
            data: [{ Date: "2025-01-07", Code: code, C: 100, AdjC: 100, AdjFactor: 1, Vo: 10, Va: 1_000 }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify([{
          date: "2025-01-07", close: 100, adjusted_close: 100, volume: 10,
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
      clock: () => "2025-01-09T00:00:00Z",
      liveAuthorization: {
        credentialUse: true,
        cost: true,
        rawRetention: true,
        licenseRetention: true,
      },
    });
    value.input = {
      kind: "credentialed_sample_audit",
      auditArtifactId: captured.provenance.artifactId,
      sampleConfigPath: "sample.config.json",
      providerId: "jquants_v2",
    };
    delete value.universe.masterPath;
    value.universe.allowedStatuses = ["pre_forward_candidate"];
    value.execution.instruments = [];
    for (const strategy of value.strategies as MutableConfig[]) {
      strategy.portfolioId += "-credentialed";
      strategy.strategyConfigVersion += "-credentialed";
    }
  }, async ({ root, configPath, artifactRoot, ledgerPath }) => {
    const asOf = "2025-01-10T00:00:00Z";
    const first = await runPreForward(configPath, asOf, {
      cwd: root,
      clock: () => "2025-01-10T00:05:00Z",
    });
    assert.equal(first.status, "blocked");
    assert.deepEqual(databaseCounts(ledgerPath), { runs: 2, entries: 0 });
    const sourceArtifactRoot = join(root, "data/generated/provider-sample/source-artifacts");
    await rm(sourceArtifactRoot, { recursive: true, force: true });
    await writeFile(join(root, "sample.config.json"), "{}\n", "utf8");

    const repeated = await runPreForward(configPath, asOf, { cwd: root });
    assert.deepEqual(
      repeated.results.map((result) => result.decisionArtifactId),
      first.results.map((result) => result.decisionArtifactId),
    );
    assert.ok(repeated.results.every((result) => result.idempotent && !result.stateTransitionApplied));
    const replayed = await runPreForward(configPath, asOf, {
      cwd: root,
      replayDecisionArtifactId: first.results[0]!.decisionArtifactId,
    });
    assert.equal(replayed.results[0]!.decisionArtifactId, first.results[0]!.decisionArtifactId);
    assert.equal(replayed.results[0]!.stateTransitionApplied, false);

    const store = new FileArtifactStore(artifactRoot);
    const decision = await store.read<PreForwardDecisionPackage>(first.results[0]!.decisionArtifactId);
    const sampleConfigArtifactId = decision.payload.input.credentialedSampleConfigArtifactId!;
    assert.match(sampleConfigArtifactId, /^sha256:[0-9a-f]{64}$/);
    assert.ok(decision.payload.input.inputArtifactIds.includes(sampleConfigArtifactId));
    const snapshot = await store.read<PreForwardCredentialedConfigSnapshotPayload>(sampleConfigArtifactId);
    assertPreForwardCredentialedConfigSnapshotArtifact(snapshot);
    assert.equal(snapshot.payload.config.mode, "live");
    await assert.rejects(
      () => lstat(sourceArtifactRoot),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
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

    const endedMasterBody = {
      schemaVersion: universeMaster.schemaVersion,
      records: universeMaster.records.map((record) => (
        record.code === "ALPHA" ? { ...record, lastEligibleDate: "2025-01-06" } : record
      )),
    };
    const endedUniverseMaster = {
      ...endedMasterBody,
      fingerprint: sha256Canonical(endedMasterBody),
    };
    const endedPayload = buildPreForwardDecisionPackage({
      config,
      configFingerprint: sha256Canonical(config),
      configSnapshotArtifactId: configSnapshotArtifactId(config),
      strategy: config.strategies[0],
      asOf: fixtureAsOf,
      createdAt: fixtureCreatedAt,
      input,
      universeMaster: endedUniverseMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(endedUniverseMaster),
      beforeState,
    });
    assert.equal(endedPayload.status, "blocked");
    const endedDiagnostic = endedPayload.instrumentDiagnostics.find((diagnostic) => diagnostic.code === "ALPHA")!;
    assert.equal(endedDiagnostic.universeDecision?.reason, "past_last_eligible_date");
    assert.equal(endedDiagnostic.dataAgeDays, 1);
    assert.equal(endedPayload.portfolio.beforeValuation, undefined);
    assert.equal(endedPayload.risk.hardStopTriggered, false);
    assert.deepEqual(endedPayload.execution.orders, []);
    assert.deepEqual(endedPayload.portfolio.afterState, beforeState);
    assert.ok(endedPayload.blockedReasons.includes("ALPHA:universe_past_last_eligible_date"));
    assert.ok(endedPayload.blockedReasons.includes("portfolio:held_asset_not_executable_at_cutoff"));
  });
});

test("the hard stop uses an intervening daily-close high-water mark between monthly cutoffs", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const { integrityFingerprint: _integrityFingerprint, ...inputBody } = fixture.input;
    const input = sealLoadedPreForwardInput({
      ...inputBody,
      series: fixture.input.series.map((series) => ({
        ...series,
        bars: series.code === "ALPHA"
          ? series.bars.map((bar) => (
            bar.tradingDate === "2025-01-03"
              ? { ...bar, close: 1_500, adjustedClose: 1_500 }
              : bar.tradingDate === "2025-01-06"
                ? { ...bar, close: 1_040, adjustedClose: 1_040 }
                : bar
          ))
          : series.bars,
      })),
    });
    const beforeState = buildVirtualPortfolioState({
      portfolioId: fixture.config.strategies[0].portfolioId,
      cashJpy: 0,
      positions: [{ code: "ALPHA", units: 1_000, averageCostJpy: 1_000 }],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: false,
      lastAsOf: "2025-01-01T00:00:00Z",
    });
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

    assert.equal(payload.status, "executed");
    assert.equal(payload.risk.highWaterMarkJpy, 1_500_000);
    assert.equal(payload.risk.equityBeforeJpy, 1_040_000);
    assert.ok(Math.abs(payload.risk.drawdownBefore! - (1_040_000 / 1_500_000 - 1)) < 1e-12);
    assert.equal(payload.risk.hardStopTriggered, true);
    assert.equal(payload.risk.hardStopPhase, "before_rebalance");
    assert.deepEqual(payload.portfolio.afterState.positions, []);
    assert.equal(payload.execution.orders[0]?.reason, "hard_stop_before_rebalance");
  });
});

test("daily high-water-mark reconstruction does not fill a missing held-asset price", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const { integrityFingerprint: _integrityFingerprint, ...inputBody } = fixture.input;
    const input = sealLoadedPreForwardInput({
      ...inputBody,
      series: fixture.input.series.map((series) => ({
        ...series,
        bars: series.code === "BETA"
          ? series.bars.filter((bar) => bar.tradingDate !== "2025-01-03")
          : series.bars,
      })),
    });
    const beforeState = buildVirtualPortfolioState({
      portfolioId: fixture.config.strategies[0].portfolioId,
      cashJpy: 0,
      positions: [
        { code: "ALPHA", units: 1_000, averageCostJpy: 100 },
        { code: "BETA", units: 1_000, averageCostJpy: 100 },
      ],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: false,
      lastAsOf: "2025-01-01T00:00:00Z",
    });
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
    assert.equal(payload.portfolio.beforeValuation, undefined);
    assert.equal(payload.risk.hardStopTriggered, false);
    assert.deepEqual(payload.execution.orders, []);
    assert.deepEqual(payload.portfolio.afterState, beforeState);
    assert.ok(payload.blockedReasons.includes("portfolio:incomplete_daily_high_water_mark_prices"));
    assert.ok(!payload.blockedReasons.includes("portfolio:missing_valuation_price_for_held_asset"));
  });
});

test("held-event coverage validates the prior cutoff on its Asia-Tokyo market date", async () => {
  await withTemporaryRuntime(async () => {}, async ({ configPath, artifactRoot }) => {
    await seedPreForwardFixture(configPath, { cwd: repositoryRoot });
    const fixture = await loadSyntheticDecisionFixture(configPath, artifactRoot);
    const asOf = "2025-02-01T00:00:00Z";
    const createdAt = "2025-02-01T00:05:00Z";
    const { integrityFingerprint: _integrityFingerprint, ...inputBody } = fixture.input;
    const input = sealLoadedPreForwardInput({
      ...inputBody,
      series: fixture.input.series.map((series) => (
        series.code === "ALPHA"
          ? {
            ...series,
            bars: series.bars.filter((bar) => bar.tradingDate >= "2025-01-01"),
            returnEventCoverage: {
              ...series.returnEventCoverage!,
              startDate: "2025-01-01",
              endDate: "2025-02-01",
            },
          }
          : series
      )),
    });
    const beforeState = buildVirtualPortfolioState({
      portfolioId: fixture.config.strategies[0].portfolioId,
      cashJpy: 0,
      positions: [{ code: "ALPHA", units: 1_000, averageCostJpy: 100 }],
      distributionReceivables: [],
      highWaterMarkJpy: 1_000_000,
      stopped: false,
      lastAsOf: "2024-12-31T15:30:00Z",
    });
    const payload = buildPreForwardDecisionPackage({
      config: fixture.config,
      configFingerprint: sha256Canonical(fixture.config),
      configSnapshotArtifactId: configSnapshotArtifactId(fixture.config, createdAt),
      strategy: fixture.config.strategies[0],
      asOf,
      createdAt,
      input,
      universeMaster: fixture.universeMaster,
      universeSnapshotArtifactId: universeSnapshotArtifactId(fixture.universeMaster, createdAt),
      beforeState,
    });

    assert.equal(payload.status, "blocked");
    assert.equal(payload.risk.valuationEventCoverage, "complete_synthetic_no_events");
    assert.ok(!payload.blockedReasons.includes("portfolio:distribution_event_coverage_missing_for_held_interval"));
    assert.ok(!payload.blockedReasons.includes("portfolio:corporate_action_unit_coverage_missing_for_held_interval"));
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
