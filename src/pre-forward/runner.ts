import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { FileArtifactStore } from "../data/artifact-store.ts";
import {
  assertCapturedDailyBarsArtifact,
  type CapturedDailyBarsPayload,
} from "../data/provider-sample-artifacts.ts";
import {
  assertCredentialedSampleAuditPayload,
  replayCredentialedSample,
  type CredentialedSampleAuditPayload,
} from "../data/credentialed-sample-runner.ts";
import {
  canonicalJson,
  isIsoDateTime,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../data/provenance.ts";
import { loadUniverseMaster, type UniverseMaster } from "../data/universe-master.ts";
import { compareText } from "../determinism.ts";
import {
  assertStrategyConfigCurrent,
  PRE_FORWARD_MODE,
  validatePreForwardConfig,
  type PreForwardConfig,
  type PreForwardStrategyConfig,
} from "./config.ts";
import {
  assertPreForwardDecisionPackage,
  buildPreForwardDecisionArtifact,
  buildPreForwardDecisionPackage,
  buildPreForwardRunKey,
  preForwardCycleId,
  PRE_FORWARD_RUN_REPORT_SCHEMA_VERSION,
  type PreForwardDecisionPackage,
} from "./decision.ts";
import { PreForwardLedger } from "./ledger.ts";
import {
  assertPreForwardDailyBarsArtifact,
  sealLoadedPreForwardInput,
  type LoadedPreForwardInput,
  type LoadedPreForwardSeries,
  type PreForwardDailyBarsPayload,
} from "./market-input.ts";
import {
  resolvePreForwardArtifactRoot,
  resolvePreForwardLedgerPath,
  resolveRepositoryInputFile,
} from "./runtime-paths.ts";
import {
  assertPreForwardUniverseSnapshotArtifact,
  buildPreForwardUniverseSnapshotArtifact,
  type PreForwardUniverseSnapshotPayload,
} from "./universe-snapshot.ts";

export interface PreForwardStrategyRunResult {
  strategy: "trend" | "rotation";
  portfolioId: string;
  runKey: string;
  decisionArtifactId: string;
  status: "executed" | "blocked";
  idempotent: boolean;
  stateTransitionApplied: boolean;
  orderCount: number;
  modeledCostJpy: number;
  endingCashJpy: number;
  endingHoldings: readonly { code: string; units: number }[];
  blockedReasons: readonly string[];
}

export interface PreForwardRunReport {
  schemaVersion: typeof PRE_FORWARD_RUN_REPORT_SCHEMA_VERSION;
  mode: typeof PRE_FORWARD_MODE;
  formalForwardClockStarted: false;
  asOf: string;
  operation: "execute" | "replay";
  disposition: "research_only";
  status: "executed" | "blocked";
  results: readonly PreForwardStrategyRunResult[];
  reportFingerprint: string;
}

export interface RunPreForwardOptions {
  cwd?: string;
  replayDecisionArtifactId?: string;
  clock?: () => string;
}

interface LoadedRuntime {
  config: PreForwardConfig;
  configFingerprint: string;
  artifactRoot: string;
  store: FileArtifactStore;
  ledgerPath: string;
  input: LoadedPreForwardInput;
  universeMaster?: UniverseMaster;
}

async function resolveConfigPath(path: string, cwd: string): Promise<string> {
  if (!isAbsolute(path)) return resolveRepositoryInputFile(path, cwd);
  const physical = await realpath(path);
  const metadata = await lstat(physical);
  if (!metadata.isFile()) throw new Error("Pre-forward config path must be a regular file.");
  return physical;
}

export async function loadPreForwardConfig(path: string, cwd = process.cwd()): Promise<PreForwardConfig> {
  const configPath = await resolveConfigPath(path, resolve(cwd));
  return validatePreForwardConfig(JSON.parse(await readFile(configPath, "utf8")) as unknown);
}

function seriesFromFixture(
  artifact: VersionedDataArtifact<PreForwardDailyBarsPayload>,
): LoadedPreForwardSeries {
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
  };
}

function seriesFromCredentialed(
  artifact: VersionedDataArtifact<CapturedDailyBarsPayload>,
): LoadedPreForwardSeries {
  assertCapturedDailyBarsArtifact(artifact);
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
  };
}

async function loadManifestInput(
  config: PreForwardConfig,
  store: FileArtifactStore,
): Promise<LoadedPreForwardInput> {
  if (config.input.kind !== "daily_bars_manifest") throw new Error("Expected daily-bars manifest input.");
  const artifacts = await Promise.all(config.input.dailyBarsArtifactIds.map((id) => (
    store.read<PreForwardDailyBarsPayload>(id)
  )));
  const series = artifacts.map(seriesFromFixture).sort((left, right) => compareText(left.code, right.code));
  if (new Set(series.map((item) => item.code)).size !== series.length) {
    throw new Error("Pre-forward fixture manifest contains duplicate instrument series.");
  }
  return sealLoadedPreForwardInput({
    evidenceTier: "synthetic_fixture",
    disposition: "research_only",
    inputArtifactIds: [...config.input.dailyBarsArtifactIds],
    series,
    missingCapabilities: ["not_credentialed_provider_evidence"],
    limitations: [
      "Synthetic artifacts validate the manual Pre-Forward operating loop, not investment performance.",
      "Provider-adjusted values are not classified as Total Return.",
    ],
  });
}

async function loadCredentialedInput(
  config: PreForwardConfig,
  store: FileArtifactStore,
  cwd: string,
): Promise<LoadedPreForwardInput> {
  if (config.input.kind !== "credentialed_sample_audit") throw new Error("Expected credentialed-sample input.");
  const credentialedInput = config.input;
  const replayed = await replayCredentialedSample(
    credentialedInput.sampleConfigPath,
    credentialedInput.auditArtifactId,
    { cwd },
  );
  assertCredentialedSampleAuditPayload(replayed.payload);
  if (replayed.payload.evidenceTier !== "credentialed_sample_unverified") {
    throw new Error("Pre-forward credentialed input must come from a retained live credentialed_sample_unverified audit.");
  }
  const localAudit = await store.read<CredentialedSampleAuditPayload>(credentialedInput.auditArtifactId);
  if (canonicalJson(localAudit) !== canonicalJson(replayed)) {
    throw new Error("Pre-forward artifactRoot does not contain the replayed credentialed audit.");
  }
  const selected = (await Promise.all(replayed.payload.artifacts.dailyBarsIds.map(async (id) => {
    const artifact = await store.read<CapturedDailyBarsPayload>(id);
    assertCapturedDailyBarsArtifact(artifact);
    return artifact.payload.providerId === credentialedInput.providerId ? artifact : undefined;
  }))).filter((artifact): artifact is VersionedDataArtifact<CapturedDailyBarsPayload> => artifact !== undefined);
  const series = selected.map(seriesFromCredentialed).sort((left, right) => compareText(left.code, right.code));
  if (series.length === 0) throw new Error(`Credentialed audit has no retained ${credentialedInput.providerId} daily-bar artifacts.`);
  if (new Set(series.map((item) => item.code)).size !== series.length) {
    throw new Error("Credentialed pre-forward input contains duplicate selected-provider series.");
  }
  const failureLimitations = replayed.payload.providerFailures.map((failure) => (
    `Retained provider failure: ${failure.providerId}/${failure.stableId} ${failure.failureKind} ${failure.status}.`
  ));
  return sealLoadedPreForwardInput({
    evidenceTier: "credentialed_sample_unverified",
    disposition: "research_only",
    inputArtifactIds: [credentialedInput.auditArtifactId, ...selected.map((artifact) => artifact.provenance.artifactId)]
      .sort(compareText),
    parentAuditArtifactId: credentialedInput.auditArtifactId,
    series,
    missingCapabilities: replayed.payload.missingCapabilities,
    limitations: [...replayed.payload.limitations, ...failureLimitations],
  });
}

async function loadRuntime(configPath: string, options: RunPreForwardOptions): Promise<LoadedRuntime> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const config = await loadPreForwardConfig(configPath, cwd);
  const artifactRoot = await resolvePreForwardArtifactRoot(config.artifactRoot, cwd);
  const store = new FileArtifactStore(artifactRoot);
  const input = config.input.kind === "daily_bars_manifest"
    ? await loadManifestInput(config, store)
    : await loadCredentialedInput(config, store, cwd);
  const ledgerPath = await resolvePreForwardLedgerPath(config.ledgerPath, cwd);
  const universeMaster = config.universe.masterPath === undefined
    ? undefined
    : await loadUniverseMaster(await resolveRepositoryInputFile(config.universe.masterPath, cwd));
  return {
    config,
    configFingerprint: sha256Canonical(config),
    artifactRoot,
    store,
    ledgerPath,
    input,
    universeMaster,
  };
}

function strategyResult(
  payload: PreForwardDecisionPackage,
  decisionArtifactId: string,
  idempotent: boolean,
  stateTransitionApplied: boolean,
): PreForwardStrategyRunResult {
  return {
    strategy: payload.strategy.name,
    portfolioId: payload.portfolioId,
    runKey: payload.runKey,
    decisionArtifactId,
    status: payload.status,
    idempotent,
    stateTransitionApplied,
    orderCount: payload.execution.orders.length,
    modeledCostJpy: payload.execution.totalModeledCostJpy,
    endingCashJpy: payload.portfolio.afterState.cashJpy,
    endingHoldings: payload.portfolio.afterState.positions.map((position) => ({
      code: position.code,
      units: position.units,
    })),
    blockedReasons: payload.blockedReasons,
  };
}

function buildReport(
  asOf: string,
  operation: PreForwardRunReport["operation"],
  results: readonly PreForwardStrategyRunResult[],
): PreForwardRunReport {
  const body = {
    schemaVersion: PRE_FORWARD_RUN_REPORT_SCHEMA_VERSION,
    mode: PRE_FORWARD_MODE,
    formalForwardClockStarted: false as const,
    asOf,
    operation,
    disposition: "research_only" as const,
    status: results.some((result) => result.status === "blocked") ? "blocked" as const : "executed" as const,
    results,
  };
  return { ...body, reportFingerprint: sha256Canonical(body) };
}

function assertStoredDecisionIdentity(
  payload: PreForwardDecisionPackage,
  runtime: LoadedRuntime,
  strategy: PreForwardStrategyConfig,
  asOf: string,
): void {
  assertPreForwardDecisionPackage(payload);
  if (payload.cycleId === preForwardCycleId(asOf) && payload.asOf !== asOf) {
    throw new Error(
      `Monthly Pre-Forward cycle ${payload.cycleId} already uses cutoff ${payload.asOf}; `
        + "intramonth reassessment requires a separately approved audited mode.",
    );
  }
  if (payload.runKey !== buildPreForwardRunKey(strategy, asOf)
    || payload.asOf !== asOf
    || payload.portfolioId !== strategy.portfolioId
    || payload.strategy.name !== strategy.strategy
    || payload.strategy.strategyVersion !== strategy.strategyVersion
    || payload.strategy.strategyConfigVersion !== strategy.strategyConfigVersion
    || payload.configFingerprint !== runtime.configFingerprint) {
    throw new Error("Stored Decision Package does not match the requested config, strategy, and asOf identity.");
  }
}

async function loadRetainedUniverseMaster(
  store: FileArtifactStore,
  payload: PreForwardDecisionPackage,
): Promise<UniverseMaster | undefined> {
  const snapshotArtifactId = payload.universe.snapshotArtifactId;
  if (snapshotArtifactId === undefined) return undefined;
  const snapshot = await store.read<PreForwardUniverseSnapshotPayload>(snapshotArtifactId);
  assertPreForwardUniverseSnapshotArtifact(snapshot);
  if (snapshot.payload.master.fingerprint !== payload.universe.masterFingerprint) {
    throw new Error("Retained Universe snapshot does not match the Decision Package fingerprint.");
  }
  return snapshot.payload.master;
}

async function replayOne(
  runtime: LoadedRuntime,
  ledger: PreForwardLedger,
  artifact: VersionedDataArtifact<PreForwardDecisionPackage>,
  strategy: PreForwardStrategyConfig,
  asOf: string,
): Promise<PreForwardStrategyRunResult> {
  if (artifact.provenance.artifactKind !== "decision_package") {
    throw new Error("Pre-forward replay artifact must use artifactKind=decision_package.");
  }
  assertStoredDecisionIdentity(artifact.payload, runtime, strategy, asOf);
  const universeMaster = await loadRetainedUniverseMaster(runtime.store, artifact.payload);
  const rebuilt = buildPreForwardDecisionPackage({
    config: runtime.config,
    configFingerprint: runtime.configFingerprint,
    strategy,
    asOf,
    createdAt: artifact.payload.createdAt,
    input: runtime.input,
    universeMaster,
    universeSnapshotArtifactId: artifact.payload.universe.snapshotArtifactId,
    beforeState: artifact.payload.portfolio.beforeState,
    expectedLedgerHead: artifact.payload.ledger.expectedHeadBefore,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(artifact.payload)) {
    throw new Error("Replayed Pre-Forward decision does not match the immutable Decision Package.");
  }
  const rebuiltArtifact = buildPreForwardDecisionArtifact(rebuilt);
  if (canonicalJson(rebuiltArtifact) !== canonicalJson(artifact)) {
    throw new Error("Replayed Pre-Forward Decision Package artifact is not deterministic.");
  }
  ledger.verifyDecision(artifact.payload, artifact.provenance.artifactId);
  return strategyResult(artifact.payload, artifact.provenance.artifactId, true, false);
}

export async function runPreForward(
  configPath: string,
  asOf: string,
  options: RunPreForwardOptions = {},
): Promise<PreForwardRunReport> {
  if (!isIsoDateTime(asOf)) throw new Error("--as-of must be an ISO timestamp with timezone.");
  const runtime = await loadRuntime(configPath, options);
  const asOfDate = asOf.slice(0, 10);
  for (const strategy of runtime.config.strategies) assertStrategyConfigCurrent(strategy, asOfDate);
  const ledger = await PreForwardLedger.open(runtime.ledgerPath);
  try {
    if (options.replayDecisionArtifactId !== undefined) {
      const artifact = await runtime.store.read<PreForwardDecisionPackage>(options.replayDecisionArtifactId);
      const strategy = runtime.config.strategies.find((candidate) => (
        candidate.portfolioId === artifact.payload.portfolioId && candidate.strategy === artifact.payload.strategy.name
      ));
      if (strategy === undefined) throw new Error("Replay Decision Package has no matching configured strategy.");
      return buildReport(asOf, "replay", [await replayOne(runtime, ledger, artifact, strategy, asOf)]);
    }

    let createdAt: string | undefined;
    let universeSnapshotArtifact: ReturnType<typeof buildPreForwardUniverseSnapshotArtifact> | undefined;
    const results: PreForwardStrategyRunResult[] = [];
    for (const strategy of runtime.config.strategies) {
      const runKey = buildPreForwardRunKey(strategy, asOf);
      const existing = ledger.getExistingRun(runKey);
      if (existing !== undefined) {
        const artifact = await runtime.store.read<PreForwardDecisionPackage>(existing.decisionArtifactId);
        results.push(await replayOne(runtime, ledger, artifact, strategy, asOf));
        continue;
      }
      const opening = ledger.readPortfolioSnapshot(strategy.portfolioId, runtime.config.portfolio.initialCashJpy);
      createdAt ??= options.clock?.() ?? new Date().toISOString();
      if (runtime.universeMaster !== undefined && universeSnapshotArtifact === undefined) {
        universeSnapshotArtifact = buildPreForwardUniverseSnapshotArtifact(runtime.universeMaster, createdAt);
        await runtime.store.put(universeSnapshotArtifact);
      }
      const payload = buildPreForwardDecisionPackage({
        config: runtime.config,
        configFingerprint: runtime.configFingerprint,
        strategy,
        asOf,
        createdAt,
        input: runtime.input,
        universeMaster: runtime.universeMaster,
        universeSnapshotArtifactId: universeSnapshotArtifact?.provenance.artifactId,
        beforeState: opening.state,
        expectedLedgerHead: opening.headHash,
      });
      const artifact = buildPreForwardDecisionArtifact(payload);
      await runtime.store.put(artifact);
      const appended = ledger.appendDecision(payload, artifact.provenance.artifactId);
      results.push(strategyResult(
        payload,
        artifact.provenance.artifactId,
        appended.idempotent,
        appended.stateTransitionApplied,
      ));
    }
    return buildReport(asOf, "execute", results);
  } finally {
    ledger.close();
  }
}

export function preForwardExitCode(report: PreForwardRunReport): 0 | 1 {
  return report.status === "executed" ? 0 : 1;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function printHumanSummary(report: PreForwardRunReport): void {
  console.error(
    `[pre-forward] ${report.operation} asOf=${report.asOf} status=${report.status} `
      + "label=pre_forward_dry_run formalForwardClockStarted=false",
  );
  for (const result of report.results) {
    const suffix = result.status === "blocked"
      ? ` blockers=${result.blockedReasons.join(",")}`
      : ` holdings=${result.endingHoldings.length} orders=${result.orderCount} costJpy=${result.modeledCostJpy}`;
    console.error(
      `[pre-forward] ${result.strategy} status=${result.status} idempotent=${result.idempotent} `
        + `transition=${result.stateTransitionApplied} decision=${result.decisionArtifactId}${suffix}`,
    );
  }
}

async function main(): Promise<void> {
  const configPath = arg("config");
  const asOf = arg("as-of");
  if (configPath === undefined) throw new Error("pre-forward requires --config=<path>.");
  if (asOf === undefined) throw new Error("pre-forward requires an explicit --as-of=<ISO timestamp>.");
  const report = await runPreForward(configPath, asOf, {
    replayDecisionArtifactId: arg("replay-decision"),
  });
  printHumanSummary(report);
  console.log(JSON.stringify(JSON.parse(canonicalJson(report)), null, 2));
  process.exitCode = preForwardExitCode(report);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
