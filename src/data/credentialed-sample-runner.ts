import { mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { FileArtifactStore } from "./artifact-store.ts";
import {
  validateCredentialedSampleConfig,
  type CredentialedSampleConfig,
  type CredentialedSampleProviderConfig,
} from "./credentialed-sample-config.ts";
import {
  EODHD_EOD_ADAPTER_VERSION,
  EODHD_EOD_SOURCE_VERSION,
  EodhdEodResearchProvider,
  parseEodhdCapturedDailyBars,
} from "./eodhd-eod.ts";
import {
  JQUANTS_V2_ADAPTER_VERSION,
  JQUANTS_V2_SOURCE_VERSION,
  JQuantsV2ResearchProvider,
  parseJQuantsCapturedDailyBars,
} from "./jquants-v2.ts";
import type { CapturingMarketDataProvider } from "./provider.ts";
import {
  buildVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type VersionedDataArtifact,
} from "./provenance.ts";
import {
  createProviderHttpFixtureTransport,
  loadProviderHttpFixture,
} from "./provider-http-fixture.ts";
import {
  parseCapturedJson,
  type CapturedProviderHttpResponse,
} from "./provider-http-capture.ts";
import {
  assertCapturedDailyBarsArtifact,
  assertRawProviderResponseArtifact,
  buildCapturedDailyBarsArtifact,
  buildDailyBarComparableObservations,
  buildRawProviderResponseArtifact,
  type CapturedDailyBarsPayload,
  type ProviderSampleArtifactMetadata,
} from "./provider-sample-artifacts.ts";
import {
  assertReconciliationReportIntegrity,
  reconcileComparableObservations,
  type ComparableObservation,
  type ComparableObservationEvidence,
  type ReconciliationPolicy,
  type ReconciliationReport,
} from "./reconciliation.ts";
import { compareText } from "../determinism.ts";

export const CREDENTIALED_SAMPLE_REPORT_SCHEMA_VERSION = "credentialed-sample-report-v1" as const;
export const CREDENTIALED_SAMPLE_RUNNER_VERSION = "credentialed-sample-runner-v1" as const;

export const CREDENTIALED_SAMPLE_RECONCILIATION_POLICY: ReconciliationPolicy = {
  version: "credentialed-sample-daily-bars-v1",
  mode: "advisory",
  minSources: 2,
  tolerances: {
    close: { warningRelative: 0.001, blockingRelative: 0.01 },
    adjustedClose: { warningRelative: 0.001, blockingRelative: 0.02 },
    volume: { warningRelative: 0.01, blockingRelative: 0.1 },
    tradingValue: { warningRelative: 0.01, blockingRelative: 0.1 },
  },
};

export interface CredentialedSampleCoverage {
  providerId: "jquants_v2" | "eodhd_eod";
  source: string;
  independenceGroup: string;
  instruments: number;
  bars: number;
  fields: {
    close: number;
    adjustedClose: number;
    volume: number;
    tradingValue: number;
  };
  missingValues: {
    volume: number;
    tradingValue: number;
  };
}

export interface CredentialedSampleAuditPayload {
  schemaVersion: typeof CREDENTIALED_SAMPLE_REPORT_SCHEMA_VERSION;
  runnerVersion: typeof CREDENTIALED_SAMPLE_RUNNER_VERSION;
  sampleDefinitionFingerprint: string;
  mode: "fixture" | "live";
  evidenceTier: "fixture_contract" | "credentialed_sample_unverified";
  disposition: "research_only";
  productionSelection: "not_selected";
  failClosed: true;
  canEnableEtfRealistic: false;
  range: { start: string; end: string };
  providers: readonly {
    providerId: "jquants_v2" | "eodhd_eod";
    source: string;
    independenceGroup: string;
    credentialEnvVar: string;
  }[];
  instrumentIds: readonly string[];
  authorizationRecord: {
    credentialUseAuthorized: boolean;
    costAuthorized: boolean;
    rawRetentionAuthorized: boolean;
    licenseRetentionConfirmed: boolean;
  };
  availabilityModel: "retrieval_time_only_not_source_native_row_availability";
  artifacts: {
    rawResponseIds: readonly string[];
    dailyBarsIds: readonly string[];
    observationIds: readonly string[];
  };
  coverage: readonly CredentialedSampleCoverage[];
  reconciliation: ReconciliationReport;
  missingCapabilities: readonly string[];
  limitations: readonly string[];
  fingerprint: string;
}

export interface CredentialedSampleRuntimeAuthorization {
  credentialUse: boolean;
  cost: boolean;
  rawRetention: boolean;
  licenseRetention: boolean;
}

export interface CredentialedSampleRunOptions {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  clock?: () => string;
  liveAuthorization?: Partial<CredentialedSampleRuntimeAuthorization>;
}

interface ProviderRuntime {
  provider: CapturingMarketDataProvider;
  assertConsumed?: () => void;
  metadata: Pick<ProviderSampleArtifactMetadata, "providerId" | "dataset" | "sourceVersion" | "adapterVersion">;
}

function providerArtifactContract(
  providerId: CredentialedSampleProviderConfig["providerId"],
): ProviderRuntime["metadata"] {
  return providerId === "jquants_v2"
    ? {
      providerId: "jquants_v2",
      dataset: "jquants-v2-daily-bars",
      sourceVersion: JQUANTS_V2_SOURCE_VERSION,
      adapterVersion: JQUANTS_V2_ADAPTER_VERSION,
    }
    : {
      providerId: "eodhd_eod",
      dataset: "eodhd-eod-daily-bars",
      sourceVersion: EODHD_EOD_SOURCE_VERSION,
      adapterVersion: EODHD_EOD_ADAPTER_VERSION,
    };
}

const SAFE_REPOSITORY_ROOTS = ["data/raw/", "data/cache/", "data/generated/", "reports/generated/"];
const MISSING_CAPABILITIES = [
  "source_native_row_available_at",
  "source_native_revision_history",
  "exchange_calendar_and_session_exceptions",
  "point_in_time_listing_and_last_trading_date",
  "etf_distributions_and_corporate_actions",
  "historical_jpx_bid_ask_and_depth",
  "approved_production_license_and_retention_rights",
] as const;
const BASE_LIMITATIONS = [
  "Provider adjusted-close fields are not classified as Total Return.",
  "Retrieval time records when Quant Pilot observed a response; it is not source-native row availability.",
  "Missing fields and source disagreements remain explicit; the runner never selects a winning source.",
  "This sample does not select O-001 or enable etf_realistic.",
] as const;

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function safeRepositoryRelative(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return SAFE_REPOSITORY_ROOTS.some((prefix) => normalized.startsWith(prefix));
}

async function resolveArtifactRoot(config: CredentialedSampleConfig, cwd: string): Promise<string> {
  const repositoryRoot = await realpath(cwd);
  const declaredRoot = config.artifactRoot.kind === "relative"
    ? resolve(repositoryRoot, config.artifactRoot.path)
    : resolve(config.artifactRoot.path);
  if (config.artifactRoot.kind === "relative" && !isInside(repositoryRoot, declaredRoot)) {
    throw new Error("Relative artifactRoot escaped the repository root.");
  }
  if (isInside(repositoryRoot, declaredRoot)
    && !safeRepositoryRelative(relative(repositoryRoot, declaredRoot))) {
    throw new Error("Repository-local artifacts must stay inside an ignored runtime-data directory.");
  }
  await mkdir(declaredRoot, { recursive: true, mode: 0o700 });
  const physicalRoot = await realpath(declaredRoot);
  if (config.artifactRoot.kind === "relative" && !isInside(repositoryRoot, physicalRoot)) {
    throw new Error("Relative artifactRoot resolves through a symlink outside the repository.");
  }
  if (isInside(repositoryRoot, physicalRoot)
    && !safeRepositoryRelative(relative(repositoryRoot, physicalRoot))) {
    throw new Error("Physical artifactRoot is not inside an ignored runtime-data directory.");
  }
  return physicalRoot;
}

async function resolveFixturePath(path: string, cwd: string): Promise<string> {
  const repositoryRoot = await realpath(cwd);
  const declared = resolve(repositoryRoot, path);
  if (!isInside(repositoryRoot, declared)) throw new Error("Provider fixture path escaped the repository root.");
  const physical = await realpath(declared);
  if (!isInside(repositoryRoot, physical)) throw new Error("Provider fixture resolves outside the repository root.");
  return physical;
}

function normalizedSampleDefinition(config: CredentialedSampleConfig): unknown {
  return {
    schemaVersion: config.schemaVersion,
    mode: config.mode,
    range: config.range,
    providers: config.providers.map((provider) => ({
      providerId: provider.providerId,
      source: provider.source,
      independenceGroup: provider.independenceGroup,
      credentialEnvVar: provider.credentialEnvVar,
    })).sort((left, right) => compareText(left.providerId, right.providerId)),
    instruments: config.instruments.map((instrument) => ({
      stableId: instrument.stableId,
      currency: instrument.currency,
      mappings: [...instrument.mappings].sort((left, right) => compareText(left.providerId, right.providerId)),
    })).sort((left, right) => compareText(left.stableId, right.stableId)),
  };
}

function sampleDefinitionFingerprint(config: CredentialedSampleConfig): string {
  return sha256Canonical(normalizedSampleDefinition(config));
}

function assertLiveAuthorization(
  config: CredentialedSampleConfig,
  options: CredentialedSampleRunOptions,
): void {
  if (config.mode !== "live") return;
  const runtime = options.liveAuthorization ?? {};
  if (runtime.credentialUse !== true) throw new Error("Live capture requires --authorize-credential-use.");
  if (runtime.cost !== true) throw new Error("Live capture requires --authorize-cost.");
  if (runtime.rawRetention !== true) throw new Error("Live capture requires --authorize-raw-retention.");
  if (runtime.licenseRetention !== true) throw new Error("Live capture requires --confirm-license-retention.");
}

function assertLiveCredentials(config: CredentialedSampleConfig, options: CredentialedSampleRunOptions): void {
  if (config.mode !== "live") return;
  const env = options.env ?? process.env;
  for (const provider of config.providers) {
    const value = env[provider.credentialEnvVar];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Required credential environment variable is missing: ${provider.credentialEnvVar}.`);
    }
    if (value.trim() !== value || value.length < 8) {
      throw new Error(`Credential ${provider.credentialEnvVar} must be an unpadded token of at least eight characters.`);
    }
  }
}

async function buildProviderRuntime(
  config: CredentialedSampleConfig,
  providerConfig: CredentialedSampleProviderConfig,
  options: CredentialedSampleRunOptions,
  cwd: string,
): Promise<ProviderRuntime> {
  let credential: string;
  let fetchImpl: typeof fetch;
  let clock: () => string;
  let assertConsumed: (() => void) | undefined;
  const transport = providerConfig.providerId === "jquants_v2"
    ? { transport: "header" as const, field: "x-api-key" }
    : { transport: "query" as const, field: "api_token" };
  if (config.mode === "fixture") {
    const fixturePath = await resolveFixturePath(providerConfig.fixtureFile!, cwd);
    const fixture = await loadProviderHttpFixture(fixturePath);
    if (fixture.providerId !== providerConfig.providerId) {
      throw new Error(`Fixture ${providerConfig.fixtureFile} does not match provider ${providerConfig.providerId}.`);
    }
    credential = `fixture-credential-${providerConfig.providerId}`;
    const fixtureTransport = createProviderHttpFixtureTransport(fixture, { value: credential, ...transport });
    fetchImpl = fixtureTransport.fetch;
    clock = fixtureTransport.clock;
    assertConsumed = fixtureTransport.assertConsumed;
  } else {
    const value = (options.env ?? process.env)[providerConfig.credentialEnvVar];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Required credential environment variable is missing: ${providerConfig.credentialEnvVar}.`);
    }
    if (value.trim() !== value || value.length < 8) {
      throw new Error(`Credential ${providerConfig.credentialEnvVar} must be an unpadded token of at least eight characters.`);
    }
    credential = value;
    fetchImpl = options.fetchImpl ?? fetch;
    clock = options.clock ?? (() => new Date().toISOString());
  }
  if (providerConfig.providerId === "jquants_v2") {
    return {
      provider: new JQuantsV2ResearchProvider(
        credential,
        fetchImpl,
        "https://api.jquants.com",
        clock,
        providerConfig.credentialEnvVar,
      ),
      assertConsumed,
      metadata: providerArtifactContract("jquants_v2"),
    };
  }
  return {
    provider: new EodhdEodResearchProvider(
      credential,
      fetchImpl,
      "https://eodhd.com",
      clock,
      providerConfig.credentialEnvVar,
    ),
    assertConsumed,
    metadata: providerArtifactContract("eodhd_eod"),
  };
}

function coverage(
  config: CredentialedSampleConfig,
  dailyArtifacts: readonly VersionedDataArtifact<CapturedDailyBarsPayload>[],
): CredentialedSampleCoverage[] {
  return [...config.providers]
    .sort((left, right) => compareText(left.providerId, right.providerId))
    .map((provider) => {
      const artifacts = dailyArtifacts.filter((artifact) => artifact.payload.providerId === provider.providerId);
      const bars = artifacts.flatMap((artifact) => artifact.payload.bars);
      const volume = bars.filter((bar) => bar.volume !== undefined).length;
      const tradingValue = bars.filter((bar) => bar.tradingValue !== undefined).length;
      return {
        providerId: provider.providerId,
        source: provider.source,
        independenceGroup: provider.independenceGroup,
        instruments: artifacts.length,
        bars: bars.length,
        fields: { close: bars.length, adjustedClose: bars.length, volume, tradingValue },
        missingValues: { volume: bars.length - volume, tradingValue: bars.length - tradingValue },
      };
    });
}

function reportWithoutFingerprint(
  config: CredentialedSampleConfig,
  rawArtifacts: readonly VersionedDataArtifact<CapturedProviderHttpResponse>[],
  dailyArtifacts: readonly VersionedDataArtifact<CapturedDailyBarsPayload>[],
  observations: readonly ComparableObservation[],
  reconciliation: ReconciliationReport,
): Omit<CredentialedSampleAuditPayload, "fingerprint"> {
  return {
    schemaVersion: CREDENTIALED_SAMPLE_REPORT_SCHEMA_VERSION,
    runnerVersion: CREDENTIALED_SAMPLE_RUNNER_VERSION,
    sampleDefinitionFingerprint: sampleDefinitionFingerprint(config),
    mode: config.mode,
    evidenceTier: config.mode === "fixture" ? "fixture_contract" : "credentialed_sample_unverified",
    disposition: "research_only",
    productionSelection: "not_selected",
    failClosed: true,
    canEnableEtfRealistic: false,
    range: config.range,
    providers: config.providers.map((provider) => ({
      providerId: provider.providerId,
      source: provider.source,
      independenceGroup: provider.independenceGroup,
      credentialEnvVar: provider.credentialEnvVar,
    })).sort((left, right) => compareText(left.providerId, right.providerId)),
    instrumentIds: config.instruments.map((instrument) => instrument.stableId).sort(compareText),
    authorizationRecord: {
      credentialUseAuthorized: config.credentialUseAuthorized,
      costAuthorized: config.costAuthorized,
      rawRetentionAuthorized: config.rawRetentionAuthorized,
      licenseRetentionConfirmed: config.licenseRetentionConfirmed,
    },
    availabilityModel: "retrieval_time_only_not_source_native_row_availability",
    artifacts: {
      rawResponseIds: rawArtifacts.map((artifact) => artifact.provenance.artifactId).sort(compareText),
      dailyBarsIds: dailyArtifacts.map((artifact) => artifact.provenance.artifactId).sort(compareText),
      observationIds: observations.map((observation) => observation.artifact.provenance.artifactId).sort(compareText),
    },
    coverage: coverage(config, dailyArtifacts),
    reconciliation,
    missingCapabilities: [...MISSING_CAPABILITIES],
    limitations: [
      ...(config.mode === "fixture" ? ["Committed fixtures validate the capture contract; no provider credential was used."] : []),
      ...BASE_LIMITATIONS,
    ],
  };
}

function buildReport(
  config: CredentialedSampleConfig,
  rawArtifacts: readonly VersionedDataArtifact<CapturedProviderHttpResponse>[],
  dailyArtifacts: readonly VersionedDataArtifact<CapturedDailyBarsPayload>[],
  observations: readonly ComparableObservation[],
  reconciliation: ReconciliationReport,
): CredentialedSampleAuditPayload {
  const body = reportWithoutFingerprint(config, rawArtifacts, dailyArtifacts, observations, reconciliation);
  return { ...body, fingerprint: sha256Canonical(body) };
}

export function assertCredentialedSampleAuditPayload(payload: CredentialedSampleAuditPayload): void {
  if (payload.schemaVersion !== CREDENTIALED_SAMPLE_REPORT_SCHEMA_VERSION) {
    throw new Error(`Unsupported credentialed-sample report schemaVersion: ${String(payload.schemaVersion)}.`);
  }
  if (payload.runnerVersion !== CREDENTIALED_SAMPLE_RUNNER_VERSION
    || payload.disposition !== "research_only"
    || payload.productionSelection !== "not_selected"
    || payload.failClosed !== true
    || payload.canEnableEtfRealistic !== false) {
    throw new Error("Credentialed-sample report violates its fail-closed production boundary.");
  }
  if (payload.mode !== "fixture" && payload.mode !== "live") {
    throw new Error("Credentialed-sample report mode must be fixture or live.");
  }
  const expectedEvidenceTier = payload.mode === "fixture"
    ? "fixture_contract"
    : "credentialed_sample_unverified";
  if (payload.evidenceTier !== expectedEvidenceTier) {
    throw new Error("Credentialed-sample report evidence tier does not match its execution mode.");
  }
  if (payload.availabilityModel !== "retrieval_time_only_not_source_native_row_availability") {
    throw new Error("Credentialed-sample report must retain its limited availability model.");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(payload.sampleDefinitionFingerprint)) {
    throw new Error("Credentialed-sample report sampleDefinitionFingerprint must be a canonical SHA-256 identifier.");
  }
  if (!isCanonicalIsoDate(payload.range?.start)
    || !isCanonicalIsoDate(payload.range?.end)
    || payload.range.start > payload.range.end) {
    throw new Error("Credentialed-sample report range must contain ordered ISO dates.");
  }
  const authorization = payload.authorizationRecord;
  if (authorization === null || typeof authorization !== "object") {
    throw new Error("Credentialed-sample report authorization record must be an object.");
  }
  const authorizationValues = [
    authorization.credentialUseAuthorized,
    authorization.costAuthorized,
    authorization.rawRetentionAuthorized,
    authorization.licenseRetentionConfirmed,
  ];
  if (authorizationValues.some((value) => typeof value !== "boolean")) {
    throw new Error("Credentialed-sample report authorization values must be boolean.");
  }
  if ((payload.mode === "fixture" && authorizationValues.some(Boolean))
    || (payload.mode === "live" && authorizationValues.some((value) => value !== true))) {
    throw new Error("Credentialed-sample report authorization record does not match its execution mode.");
  }
  if (!Array.isArray(payload.providers) || payload.providers.length !== 2) {
    throw new Error("Credentialed-sample report must contain the two comparison providers.");
  }
  const expectedProviderIds = ["eodhd_eod", "jquants_v2"];
  const providerIds = payload.providers.map((provider) => provider.providerId);
  if (canonicalJson(providerIds) !== canonicalJson(expectedProviderIds)) {
    throw new Error("Credentialed-sample report provider identities must be complete and sorted.");
  }
  for (const field of ["source", "independenceGroup", "credentialEnvVar"] as const) {
    const values = payload.providers.map((provider) => provider[field]);
    if (values.some((value) => typeof value !== "string" || value.length === 0)
      || new Set(values).size !== values.length) {
      throw new Error(`Credentialed-sample report providers.${field} must be non-empty and unique.`);
    }
  }
  for (const provider of payload.providers) {
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(provider.source)
      || !/^[a-z0-9][a-z0-9._:-]*$/.test(provider.independenceGroup)) {
      throw new Error("Credentialed-sample report provider source identities must be lowercase and stable.");
    }
    const expectedCredentialEnvVar = provider.providerId === "jquants_v2"
      ? "JQUANTS_API_KEY"
      : "EODHD_API_TOKEN";
    if (provider.credentialEnvVar !== expectedCredentialEnvVar) {
      throw new Error("Credentialed-sample report provider credential environment is not allowlisted.");
    }
  }
  if (!Array.isArray(payload.instrumentIds)
    || payload.instrumentIds.length === 0
    || payload.instrumentIds.some((id) => typeof id !== "string" || id.length === 0)
    || new Set(payload.instrumentIds).size !== payload.instrumentIds.length
    || [...payload.instrumentIds].sort(compareText).some((id, index) => id !== payload.instrumentIds[index])) {
    throw new Error("Credentialed-sample report instrumentIds must be non-empty, unique, and sorted.");
  }
  if (payload.mode === "live" && (payload.instrumentIds.length < 5 || payload.instrumentIds.length > 10)) {
    throw new Error("Live credentialed-sample reports require 5 to 10 instruments.");
  }
  if (canonicalJson(payload.missingCapabilities) !== canonicalJson(MISSING_CAPABILITIES)) {
    throw new Error("Credentialed-sample report must retain the complete missing-capability list.");
  }
  const expectedLimitations = [
    ...(payload.mode === "fixture" ? ["Committed fixtures validate the capture contract; no provider credential was used."] : []),
    ...BASE_LIMITATIONS,
  ];
  if (canonicalJson(payload.limitations) !== canonicalJson(expectedLimitations)) {
    throw new Error("Credentialed-sample report must retain the complete limitation list.");
  }
  if (canonicalJson(payload.reconciliation.policy) !== canonicalJson(CREDENTIALED_SAMPLE_RECONCILIATION_POLICY)) {
    throw new Error("Credentialed-sample report reconciliation policy does not match the runner policy.");
  }
  const { fingerprint, ...body } = payload;
  if (fingerprint !== sha256Canonical(body)) throw new Error("Credentialed-sample report fingerprint is invalid.");
  assertReconciliationReportIntegrity(payload.reconciliation);
  for (const [field, ids] of Object.entries(payload.artifacts)) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(id))) {
      throw new Error(`Credentialed-sample report ${field} contains an invalid artifact id.`);
    }
    if (new Set(ids).size !== ids.length || [...ids].sort(compareText).some((id, index) => id !== ids[index])) {
      throw new Error(`Credentialed-sample report ${field} must be unique and sorted.`);
    }
  }
  const expectedDailyArtifacts = payload.providers.length * payload.instrumentIds.length;
  if (payload.artifacts.rawResponseIds.length < expectedDailyArtifacts
    || payload.artifacts.dailyBarsIds.length !== expectedDailyArtifacts
    || payload.artifacts.observationIds.length === 0) {
    throw new Error("Credentialed-sample report artifact manifest is incomplete.");
  }
}

function buildAuditArtifact(
  payload: CredentialedSampleAuditPayload,
  decisionDate: string,
): VersionedDataArtifact<CredentialedSampleAuditPayload> {
  assertCredentialedSampleAuditPayload(payload);
  return buildVersionedDataArtifact({
    artifactKind: "provider_capability_evidence",
    payload,
    source: "quant-pilot",
    dataset: "credentialed-sample-audit",
    sourceVersion: payload.schemaVersion,
    adapterVersion: payload.runnerVersion,
    observedAt: `${payload.range.end}T00:00:00Z`,
    availableAt: decisionDate,
    retrievedAt: decisionDate,
    request: {
      sampleDefinitionFingerprint: payload.sampleDefinitionFingerprint,
      artifacts: payload.artifacts,
    },
    recordId: payload.sampleDefinitionFingerprint,
  });
}

export async function loadCredentialedSampleConfig(path: string): Promise<CredentialedSampleConfig> {
  return validateCredentialedSampleConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function captureCredentialedSample(
  configPath: string,
  options: CredentialedSampleRunOptions = {},
): Promise<VersionedDataArtifact<CredentialedSampleAuditPayload>> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const config = await loadCredentialedSampleConfig(resolve(cwd, configPath));
  // Runtime authorization and credential validation intentionally occur before
  // artifact directory creation, provider construction, or network access.
  assertLiveAuthorization(config, options);
  assertLiveCredentials(config, options);
  const artifactRoot = await resolveArtifactRoot(config, cwd);
  const store = new FileArtifactStore(artifactRoot);
  await store.prepare();
  const rawArtifacts: VersionedDataArtifact<CapturedProviderHttpResponse>[] = [];
  const dailyArtifacts: VersionedDataArtifact<CapturedDailyBarsPayload>[] = [];
  const observations: ComparableObservation[] = [];

  for (const providerConfig of [...config.providers].sort((left, right) => compareText(left.providerId, right.providerId))) {
    const runtime = await buildProviderRuntime(config, providerConfig, options, cwd);
    for (const instrument of [...config.instruments].sort((left, right) => compareText(left.stableId, right.stableId))) {
      const mapping = instrument.mappings.find((item) => item.providerId === providerConfig.providerId)!;
      const result = await runtime.provider.captureDailyBars({
        code: instrument.stableId,
        symbol: mapping.providerSymbol,
        start: config.range.start,
        end: config.range.end,
      });
      const metadata: ProviderSampleArtifactMetadata = {
        ...runtime.metadata,
        credentialEnvVar: providerConfig.credentialEnvVar,
        source: providerConfig.source,
        stableId: instrument.stableId,
        providerSymbol: mapping.providerSymbol,
        currency: instrument.currency,
        range: config.range,
      };
      const capturedRaw = result.responses.map((response) => buildRawProviderResponseArtifact(response, metadata));
      for (const artifact of capturedRaw) await store.put(artifact);
      rawArtifacts.push(...capturedRaw);
      const dailyArtifact = buildCapturedDailyBarsArtifact(result.bars, capturedRaw, metadata);
      await store.put(dailyArtifact);
      dailyArtifacts.push(dailyArtifact);
      const builtObservations = buildDailyBarComparableObservations(dailyArtifact);
      for (const observation of builtObservations) await store.put(observation.artifact);
      observations.push(...builtObservations);
    }
    runtime.assertConsumed?.();
  }

  const decisionDate = dailyArtifacts.map((artifact) => artifact.provenance.availableAt).sort().at(-1)!;
  const reconciliation = reconcileComparableObservations(
    observations,
    decisionDate,
    CREDENTIALED_SAMPLE_RECONCILIATION_POLICY,
  );
  const payload = buildReport(config, rawArtifacts, dailyArtifacts, observations, reconciliation);
  const auditArtifact = buildAuditArtifact(payload, decisionDate);
  await store.put(auditArtifact);
  return auditArtifact;
}

function observationFromArtifact(
  artifact: VersionedDataArtifact<ComparableObservationEvidence>,
): ComparableObservation {
  return { ...artifact.payload, artifact };
}

export async function replayCredentialedSample(
  configPath: string,
  auditArtifactId: string,
  options: Pick<CredentialedSampleRunOptions, "cwd"> = {},
): Promise<VersionedDataArtifact<CredentialedSampleAuditPayload>> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const config = await loadCredentialedSampleConfig(resolve(cwd, configPath));
  const artifactRoot = await resolveArtifactRoot(config, cwd);
  const store = new FileArtifactStore(artifactRoot);
  const auditArtifact = await store.read<CredentialedSampleAuditPayload>(auditArtifactId);
  if (auditArtifact.provenance.artifactKind !== "provider_capability_evidence") {
    throw new Error("Replay artifact must use artifactKind=provider_capability_evidence.");
  }
  assertCredentialedSampleAuditPayload(auditArtifact.payload);
  if (auditArtifact.payload.sampleDefinitionFingerprint !== sampleDefinitionFingerprint(config)) {
    throw new Error("Replay config does not match the retained sample definition.");
  }

  const rawArtifacts = await Promise.all(auditArtifact.payload.artifacts.rawResponseIds.map(async (id) => {
    const artifact = await store.read<CapturedProviderHttpResponse>(id);
    assertRawProviderResponseArtifact(artifact);
    parseCapturedJson(artifact.payload);
    return artifact;
  }));
  const dailyArtifacts = await Promise.all(auditArtifact.payload.artifacts.dailyBarsIds.map(async (id) => {
    const artifact = await store.read<CapturedDailyBarsPayload>(id);
    assertCapturedDailyBarsArtifact(artifact);
    return artifact;
  }));
  const expectedRawIds = new Set(rawArtifacts.map((artifact) => artifact.provenance.artifactId));
  const referencedRawIds = new Set<string>();
  const expectedPairs = new Map<string, {
    provider: CredentialedSampleProviderConfig;
    symbol: string;
    currency: "JPY";
  }>(
    config.instruments.flatMap((instrument) => instrument.mappings.map((mapping) => {
    const provider = config.providers.find((item) => item.providerId === mapping.providerId)!;
    return [`${mapping.providerId}:${instrument.stableId}`, {
      provider,
      symbol: mapping.providerSymbol,
      currency: instrument.currency,
    }] as const;
    })),
  );
  const seenPairs = new Set<string>();
  for (const artifact of dailyArtifacts) {
    const pair = `${artifact.payload.providerId}:${artifact.payload.stableId}`;
    const expectedPair = expectedPairs.get(pair);
    if (expectedPair === undefined || seenPairs.has(pair)) {
      throw new Error(`Replay contains an unexpected or duplicate provider/instrument pair: ${pair}.`);
    }
    seenPairs.add(pair);
    if (artifact.provenance.source !== expectedPair.provider.source || artifact.payload.providerSymbol !== expectedPair.symbol) {
      throw new Error(`Replay provider/instrument metadata does not match config: ${pair}.`);
    }
    for (const rawId of artifact.payload.rawArtifactIds) {
      if (!expectedRawIds.has(rawId)) throw new Error("Daily-bars artifact references raw lineage outside the replay manifest.");
      const rawArtifact = rawArtifacts.find((item) => item.provenance.artifactId === rawId)!;
      if (rawArtifact.provenance.source !== artifact.provenance.source) {
        throw new Error("Daily-bars artifact references raw lineage from a different source.");
      }
      referencedRawIds.add(rawId);
    }
    const lineageArtifacts = artifact.payload.rawArtifactIds.map((rawId) => (
      rawArtifacts.find((item) => item.provenance.artifactId === rawId)!
    ));
    const captures = lineageArtifacts.map((rawArtifact) => rawArtifact.payload);
    const replayRequest = {
      code: artifact.payload.stableId,
      symbol: artifact.payload.providerSymbol,
      start: config.range.start,
      end: config.range.end,
    };
    const replayedBars = artifact.payload.providerId === "jquants_v2"
      ? parseJQuantsCapturedDailyBars(captures, replayRequest)
      : parseEodhdCapturedDailyBars(captures, replayRequest);
    const expectedDailyArtifact = buildCapturedDailyBarsArtifact(
      replayedBars,
      lineageArtifacts,
      {
        ...providerArtifactContract(artifact.payload.providerId),
        credentialEnvVar: expectedPair.provider.credentialEnvVar,
        source: expectedPair.provider.source,
        stableId: artifact.payload.stableId,
        providerSymbol: expectedPair.symbol,
        currency: expectedPair.currency,
        range: config.range,
      },
    );
    if (canonicalJson(expectedDailyArtifact) !== canonicalJson(artifact)) {
      throw new Error(`Normalized daily-bars artifact does not match retained raw responses and config: ${pair}.`);
    }
  }
  if (seenPairs.size !== expectedPairs.size) throw new Error("Replay is missing a configured provider/instrument pair.");
  if (referencedRawIds.size !== expectedRawIds.size) throw new Error("Replay manifest contains unreferenced raw artifacts.");
  const rebuiltObservations = dailyArtifacts.flatMap((artifact) => buildDailyBarComparableObservations(artifact));
  const rebuiltById = new Map(rebuiltObservations.map((observation) => [observation.artifact.provenance.artifactId, observation]));
  const retainedObservations = await Promise.all(auditArtifact.payload.artifacts.observationIds.map(async (id) => {
    const retained = await store.read<ComparableObservationEvidence>(id);
    const expected = rebuiltById.get(id);
    if (expected === undefined || canonicalJson(retained) !== canonicalJson(expected.artifact)) {
      throw new Error(`Retained reconciliation observation does not match replayed daily bars: ${id}.`);
    }
    return observationFromArtifact(retained);
  }));
  if (retainedObservations.length !== rebuiltObservations.length) {
    throw new Error("Replay manifest does not contain the complete rebuilt observation set.");
  }
  if (rebuiltById.size !== rebuiltObservations.length) {
    throw new Error("Rebuilt reconciliation observations contain duplicate artifact identifiers.");
  }
  const derivedDecisionDate = dailyArtifacts
    .map((artifact) => artifact.provenance.availableAt)
    .sort()
    .at(-1)!;
  if (auditArtifact.payload.reconciliation.decisionDate !== derivedDecisionDate) {
    throw new Error("Retained reconciliation decisionDate does not match the latest evidence availability.");
  }
  const reconciliation = reconcileComparableObservations(
    retainedObservations,
    derivedDecisionDate,
    auditArtifact.payload.reconciliation.policy,
  );
  const expectedPayload = buildReport(config, rawArtifacts, dailyArtifacts, retainedObservations, reconciliation);
  if (canonicalJson(expectedPayload) !== canonicalJson(auditArtifact.payload)) {
    throw new Error("Replayed credentialed-sample report does not match the retained audit artifact.");
  }
  const expectedArtifact = buildAuditArtifact(expectedPayload, derivedDecisionDate);
  if (canonicalJson(expectedArtifact) !== canonicalJson(auditArtifact)) {
    throw new Error("Replayed credentialed-sample audit artifact is not deterministic.");
  }
  return auditArtifact;
}

export function credentialedSampleExitCode(
  payload: CredentialedSampleAuditPayload,
  requireLiveEvidence: boolean,
  requireProduction: boolean,
): 0 | 1 {
  assertCredentialedSampleAuditPayload(payload);
  if (requireProduction) return 1;
  if (requireLiveEvidence && payload.mode !== "live") return 1;
  return 0;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const configPath = arg("config") ?? "research/provider-samples/fixture.config.json";
  const replayId = arg("replay-artifact");
  const artifact = replayId === undefined
    ? await captureCredentialedSample(configPath, {
      liveAuthorization: {
        credentialUse: hasFlag("authorize-credential-use"),
        cost: hasFlag("authorize-cost"),
        rawRetention: hasFlag("authorize-raw-retention"),
        licenseRetention: hasFlag("confirm-license-retention"),
      },
    })
    : await replayCredentialedSample(configPath, replayId);
  console.log(JSON.stringify(JSON.parse(canonicalJson(artifact)), null, 2));
  process.exitCode = credentialedSampleExitCode(
    artifact.payload,
    hasFlag("require-live-evidence"),
    hasFlag("require-production"),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
