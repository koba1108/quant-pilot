import { isAbsolute as isAbsolutePath } from "node:path";

export const CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION = "credentialed-sample-v1" as const;

export const CREDENTIALED_SAMPLE_PROVIDER_IDS = ["jquants_v2", "eodhd_eod"] as const;
export type CredentialedSampleProviderId = typeof CREDENTIALED_SAMPLE_PROVIDER_IDS[number];
export type CredentialedSampleMode = "fixture" | "live";
export type CredentialedSampleArtifactRootKind = "relative" | "absolute";

export interface CredentialedSampleDateRange {
  start: string;
  end: string;
}

export interface CredentialedSampleArtifactRoot {
  kind: CredentialedSampleArtifactRootKind;
  path: string;
}

export interface CredentialedSampleProviderConfig {
  providerId: CredentialedSampleProviderId;
  source: string;
  independenceGroup: string;
  credentialEnvVar: string;
  fixtureFile?: string;
}

export interface CredentialedSampleInstrumentMapping {
  providerId: CredentialedSampleProviderId;
  providerSymbol: string;
}

export interface CredentialedSampleInstrumentConfig {
  stableId: string;
  currency: "JPY";
  mappings: readonly CredentialedSampleInstrumentMapping[];
}

export interface CredentialedSampleConfig {
  schemaVersion: typeof CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION;
  mode: CredentialedSampleMode;
  range: CredentialedSampleDateRange;
  artifactRoot: CredentialedSampleArtifactRoot;
  providers: readonly CredentialedSampleProviderConfig[];
  instruments: readonly CredentialedSampleInstrumentConfig[];
  credentialUseAuthorized: boolean;
  costAuthorized: boolean;
  rawRetentionAuthorized: boolean;
  licenseRetentionConfirmed: boolean;
}

const MODES: readonly CredentialedSampleMode[] = ["fixture", "live"];
const ARTIFACT_ROOT_KINDS: readonly CredentialedSampleArtifactRootKind[] = ["relative", "absolute"];
const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const POSIX_OR_WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\]{2})/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const SAFE_RELATIVE_ARTIFACT_ROOTS = ["data/raw/", "data/cache/", "data/generated/", "reports/generated/"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.join(", ")}.`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  if (value.includes("\0")) throw new Error(`${field} must not contain a NUL character.`);
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean.`);
  return value;
}

function requiredEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${field} must be one of ${values.join(", ")}; received ${String(value)}.`);
  }
  return value as T;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function validateDateRange(value: unknown): CredentialedSampleDateRange {
  if (!isRecord(value)) throw new Error("range must be an object.");
  assertOnlyKeys(value, ["start", "end"], "range");
  if (!isIsoDate(value.start)) throw new Error("range.start must be an ISO date (YYYY-MM-DD).");
  if (!isIsoDate(value.end)) throw new Error("range.end must be an ISO date (YYYY-MM-DD).");
  if (value.start > value.end) throw new Error("range.start must not be after range.end.");
  return { start: value.start, end: value.end };
}

function validateArtifactRoot(value: unknown): CredentialedSampleArtifactRoot {
  if (!isRecord(value)) throw new Error("artifactRoot must be an object with an explicit kind.");
  assertOnlyKeys(value, ["kind", "path"], "artifactRoot");
  const kind = requiredEnum(value.kind, ARTIFACT_ROOT_KINDS, "artifactRoot.kind");
  const path = requiredString(value.path, "artifactRoot.path");
  const looksAbsolute = isAbsolutePath(path) || POSIX_OR_WINDOWS_ABSOLUTE.test(path);
  const normalizedSegments = path.replaceAll("\\", "/").split("/");
  if (normalizedSegments.some((segment) => segment === "..")) {
    throw new Error("artifactRoot.path must not contain parent-directory traversal.");
  }
  if (path === "." || path === "./" || path === ".." || path === "../") {
    throw new Error("artifactRoot.path must identify a dedicated artifact directory.");
  }
  if (kind === "relative" && looksAbsolute) {
    throw new Error("artifactRoot.path is absolute but artifactRoot.kind is relative.");
  }
  if (kind === "absolute" && !looksAbsolute) {
    throw new Error("artifactRoot.path must be absolute when artifactRoot.kind is absolute.");
  }
  // A URL or shell expression is not a filesystem path. Rejecting these here
  // prevents a later consumer from interpreting a config value as a remote or
  // command destination. Environment-variable expansion is deliberately not
  // performed by this parser.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !POSIX_OR_WINDOWS_ABSOLUTE.test(path)) {
    throw new Error("artifactRoot.path must be a filesystem path, not a URL or URI.");
  }
  if (kind === "relative") {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!SAFE_RELATIVE_ARTIFACT_ROOTS.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error("artifactRoot.path must be inside an ignored runtime-data directory.");
    }
  }
  return { kind, path };
}

function validateFixtureFile(value: unknown, field: string): string {
  const path = requiredString(value, field);
  if (isAbsolutePath(path) || POSIX_OR_WINDOWS_ABSOLUTE.test(path)) {
    throw new Error(`${field} must be a repository-relative JSON path.`);
  }
  const segments = path.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..") || !path.endsWith(".json")) {
    throw new Error(`${field} must be a traversal-free repository-relative JSON path.`);
  }
  return path;
}

function validateProvider(value: unknown, index: number): CredentialedSampleProviderConfig {
  const field = `providers[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["providerId", "source", "independenceGroup", "credentialEnvVar", "fixtureFile"], field);
  const providerId = requiredEnum(value.providerId, CREDENTIALED_SAMPLE_PROVIDER_IDS, `${field}.providerId`);
  const source = requiredString(value.source, `${field}.source`);
  const independenceGroup = requiredString(value.independenceGroup, `${field}.independenceGroup`);
  if (!SOURCE_ID_PATTERN.test(source)) throw new Error(`${field}.source must be a lowercase stable identifier.`);
  if (!SOURCE_ID_PATTERN.test(independenceGroup)) {
    throw new Error(`${field}.independenceGroup must be a lowercase stable identifier.`);
  }
  const credentialEnvVar = requiredString(value.credentialEnvVar, `${field}.credentialEnvVar`);
  if (!ENV_VAR_PATTERN.test(credentialEnvVar)) {
    throw new Error(`${field}.credentialEnvVar must be an environment variable name, not a secret value.`);
  }
  const expectedCredentialEnvVar = providerId === "jquants_v2" ? "JQUANTS_API_KEY" : "EODHD_API_TOKEN";
  if (credentialEnvVar !== expectedCredentialEnvVar) {
    throw new Error(`${field}.credentialEnvVar must be ${expectedCredentialEnvVar} for ${providerId}.`);
  }
  const fixtureFile = value.fixtureFile === undefined ? undefined : validateFixtureFile(value.fixtureFile, `${field}.fixtureFile`);
  return { providerId, source, independenceGroup, credentialEnvVar, fixtureFile };
}

function assertUnique(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size > 0) throw new Error(`${field} contains duplicates: ${[...duplicates].sort().join(", ")}.`);
}

function validateProviders(value: unknown): CredentialedSampleProviderConfig[] {
  if (!Array.isArray(value) || value.length !== CREDENTIALED_SAMPLE_PROVIDER_IDS.length) {
    throw new Error("providers must contain exactly the J-Quants and EODHD comparison sources.");
  }
  const providers = value.map((item, index) => validateProvider(item, index));
  assertUnique(providers.map((item) => item.providerId), "providers.providerId");
  assertUnique(providers.map((item) => item.source), "providers.source");
  assertUnique(providers.map((item) => item.independenceGroup), "providers.independenceGroup");
  assertUnique(providers.map((item) => item.credentialEnvVar), "providers.credentialEnvVar");
  const configuredIds = providers.map((item) => item.providerId).sort();
  if (configuredIds.some((id, index) => id !== [...CREDENTIALED_SAMPLE_PROVIDER_IDS].sort()[index])) {
    throw new Error("providers must contain exactly the J-Quants and EODHD comparison sources.");
  }
  return providers;
}

function validateInstrumentMapping(
  value: unknown,
  instrumentIndex: number,
  mappingIndex: number,
): CredentialedSampleInstrumentMapping {
  const field = `instruments[${instrumentIndex}].mappings[${mappingIndex}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["providerId", "providerSymbol"], field);
  return {
    providerId: requiredEnum(value.providerId, CREDENTIALED_SAMPLE_PROVIDER_IDS, `${field}.providerId`),
    providerSymbol: requiredString(value.providerSymbol, `${field}.providerSymbol`),
  };
}

function validateInstruments(value: unknown, providers: readonly CredentialedSampleProviderConfig[]): CredentialedSampleInstrumentConfig[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("instruments must be a non-empty array.");
  const providerIds = providers.map((provider) => provider.providerId);
  const instruments = value.map((item, instrumentIndex) => {
    const field = `instruments[${instrumentIndex}]`;
    if (!isRecord(item)) throw new Error(`${field} must be an object.`);
    assertOnlyKeys(item, ["stableId", "currency", "mappings"], field);
    const stableId = requiredString(item.stableId, `${field}.stableId`);
    if (!STABLE_ID_PATTERN.test(stableId)) throw new Error(`${field}.stableId has invalid characters.`);
    if (!Array.isArray(item.mappings) || item.mappings.length === 0) throw new Error(`${field}.mappings must be a non-empty array.`);
    const mappings = item.mappings.map((mapping, mappingIndex) => validateInstrumentMapping(mapping, instrumentIndex, mappingIndex));
    assertUnique(mappings.map((mapping) => mapping.providerId), `${field}.mappings.providerId`);
    const mappingProviderIds = mappings.map((mapping) => mapping.providerId).sort();
    const expectedProviderIds = [...providerIds].sort();
    if (mappingProviderIds.length !== expectedProviderIds.length || mappingProviderIds.some((id, index) => id !== expectedProviderIds[index])) {
      throw new Error(`${field}.mappings must provide exactly one providerSymbol for every configured provider.`);
    }
    if (item.currency !== "JPY") throw new Error(`${field}.currency must be JPY for the JPX ETF sample.`);
    return { stableId, currency: "JPY" as const, mappings };
  });
  assertUnique(instruments.map((instrument) => instrument.stableId), "instruments.stableId");
  for (const providerId of providerIds) {
    assertUnique(instruments.map((instrument) => (
      instrument.mappings.find((mapping) => mapping.providerId === providerId)!.providerSymbol.toUpperCase()
    )), `instruments.mappings.${providerId}.providerSymbol`);
  }
  return instruments;
}

/**
 * Parse and validate the credentialed-sample configuration boundary.
 *
 * This function only validates configuration. It never reads credentials,
 * contacts a provider, selects an O-001 winner, or certifies production data.
 */
export function validateCredentialedSampleConfig(value: unknown): CredentialedSampleConfig {
  if (!isRecord(value)) throw new Error("Credentialed sample config must be a JSON object.");
  assertOnlyKeys(value, [
    "schemaVersion", "mode", "range", "artifactRoot", "providers", "instruments",
    "credentialUseAuthorized", "costAuthorized", "rawRetentionAuthorized", "licenseRetentionConfirmed",
  ], "Credentialed sample config");
  if (value.schemaVersion !== CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION}.`);
  }
  const mode = requiredEnum(value.mode, MODES, "mode");
  const range = validateDateRange(value.range);
  const artifactRoot = validateArtifactRoot(value.artifactRoot);
  const providers = validateProviders(value.providers);
  const instruments = validateInstruments(value.instruments, providers);
  const credentialUseAuthorized = requiredBoolean(value.credentialUseAuthorized, "credentialUseAuthorized");
  const costAuthorized = requiredBoolean(value.costAuthorized, "costAuthorized");
  const rawRetentionAuthorized = requiredBoolean(value.rawRetentionAuthorized, "rawRetentionAuthorized");
  const licenseRetentionConfirmed = requiredBoolean(value.licenseRetentionConfirmed, "licenseRetentionConfirmed");
  for (const provider of providers) {
    if (mode === "fixture" && provider.fixtureFile === undefined) {
      throw new Error(`fixture mode requires providers.${provider.providerId}.fixtureFile.`);
    }
    if (mode === "live" && provider.fixtureFile !== undefined) {
      throw new Error(`live mode must not configure providers.${provider.providerId}.fixtureFile.`);
    }
  }
  if (mode === "fixture" && (
    credentialUseAuthorized || costAuthorized || rawRetentionAuthorized || licenseRetentionConfirmed
  )) {
    throw new Error("fixture mode requires every authorization record to remain false.");
  }
  if (mode === "live" && !credentialUseAuthorized) {
    throw new Error("live mode requires credentialUseAuthorized=true.");
  }
  if (mode === "live" && !costAuthorized) {
    throw new Error("live mode requires costAuthorized=true.");
  }
  if (mode === "live" && !rawRetentionAuthorized) {
    throw new Error("live mode requires rawRetentionAuthorized=true.");
  }
  if (mode === "live" && !licenseRetentionConfirmed) {
    throw new Error("live mode requires licenseRetentionConfirmed=true.");
  }
  if (mode === "live" && (instruments.length < 5 || instruments.length > 10)) {
    throw new Error("live mode requires a representative sample of 5 to 10 instruments.");
  }
  return {
    schemaVersion: CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION,
    mode,
    range,
    artifactRoot,
    providers,
    instruments,
    credentialUseAuthorized,
    costAuthorized,
    rawRetentionAuthorized,
    licenseRetentionConfirmed,
  };
}

export const parseCredentialedSampleConfig = validateCredentialedSampleConfig;
