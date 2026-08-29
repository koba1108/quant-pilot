import { compareText } from "../determinism.ts";
import {
  assertVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type DataArtifactKind,
  type VersionedDataArtifact,
} from "./provenance.ts";

export const PROVIDER_EVALUATION_SCHEMA_VERSION = "provider-evaluation-v1" as const;
export const PROVIDER_EVALUATION_REPORT_SCHEMA_VERSION = "provider-evaluation-report-v1" as const;

export const PROVIDER_CAPABILITIES = [
  "daily_prices",
  "adjustment_factors",
  "distributions",
  "corporate_actions",
  "jpy_fx",
  "historical_universe",
  "listing_delisting",
  "quote_quality",
  "exchange_calendar",
  "row_level_availability",
  "revision_history",
  "reproducible_access",
] as const;

/** Capabilities that must be independently sample-verified for an approved policy. */
export const APPROVED_MAJOR_CAPABILITIES = [
  "daily_prices",
  "adjustment_factors",
  "distributions",
  "corporate_actions",
  "jpy_fx",
  "historical_universe",
  "listing_delisting",
  "quote_quality",
  "exchange_calendar",
  "row_level_availability",
] as const satisfies readonly ProviderCapability[];

const CAPABILITY_ARTIFACT_KINDS: Readonly<Record<ProviderCapability, readonly DataArtifactKind[]>> = {
  daily_prices: ["daily_bars"],
  adjustment_factors: ["daily_bars", "corporate_actions"],
  distributions: ["distributions"],
  corporate_actions: ["corporate_actions"],
  jpy_fx: ["fx_rates"],
  historical_universe: ["universe"],
  listing_delisting: ["universe"],
  quote_quality: ["quote_quality"],
  exchange_calendar: ["exchange_calendar"],
  row_level_availability: ["provider_capability_evidence"],
  revision_history: ["provider_capability_evidence"],
  reproducible_access: ["provider_capability_evidence"],
};

export type ProviderCapability = typeof PROVIDER_CAPABILITIES[number];
export type ProviderCapabilityStatus = "verified" | "documented" | "partial" | "unknown" | "unsupported";
export type ProviderAvailabilityModel = "row_level" | "dataset_level" | "ingest_observed" | "none" | "unknown";
export type ProviderAdapterStatus = "not_implemented" | "fixture_contract" | "credentialed_sample" | "production_sample";
export type ProviderEvidenceKind =
  | "official_documentation"
  | "official_terms"
  | "contract_confirmation"
  | "sample_artifact";
export type ProviderLicenseRightStatus = "confirmed" | "restricted" | "unknown" | "prohibited";
export type ProviderEvaluationDisposition = "pass" | "research_only" | "unknown" | "blocked";

export interface ProviderDocumentSnapshot {
  url: string;
  title: string;
  version: string;
  content: string;
}

export interface ProviderEvidence {
  evidenceId: string;
  kind: ProviderEvidenceKind;
  version: string;
  publisher: string;
  title: string;
  url: string;
  checkedAt: string;
  claim: string;
  contentHash?: string;
  artifactId?: string;
  artifact?: VersionedDataArtifact<unknown>;
  snapshot?: VersionedDataArtifact<ProviderDocumentSnapshot>;
}

export interface ProviderCapabilityRecord {
  capability: ProviderCapability;
  status: ProviderCapabilityStatus;
  availabilityModel: ProviderAvailabilityModel;
  adapterStatus: ProviderAdapterStatus;
  evidenceIds: readonly string[];
  artifactIds: readonly string[];
  limitations: readonly string[];
}

export interface ProviderLicenseAssessment {
  overall: "verified" | "restricted" | "unknown" | "incompatible";
  privateResearch: ProviderLicenseRightStatus;
  persistentStorage: ProviderLicenseRightStatus;
  derivedResults: ProviderLicenseRightStatus;
  auditReproduction: ProviderLicenseRightStatus;
  redistribution: ProviderLicenseRightStatus;
  evidenceIds: readonly string[];
  limitations: readonly string[];
}

export interface ProviderCommercialAssessment {
  status: "published" | "quote_required" | "unknown";
  humanApproved: boolean;
  summary: string;
  evidenceIds: readonly string[];
}

export interface ProviderCandidate {
  providerId: string;
  independenceGroup: string;
  displayName: string;
  accessModel: "personal_subscription" | "business_contract" | "institutional_contract";
  capabilities: readonly ProviderCapabilityRecord[];
  license: ProviderLicenseAssessment;
  commercial: ProviderCommercialAssessment;
}

export interface ProviderResponsibility {
  capability: ProviderCapability;
  providerIds: readonly string[];
}

export interface ProviderBundle {
  bundleId: string;
  displayName: string;
  sourceIds: readonly string[];
  responsibilities: readonly ProviderResponsibility[];
}

export interface ProviderMinimumSourceRule {
  capability: ProviderCapability;
  count: number;
}

export interface ProviderEvaluationPolicy {
  version: string;
  status: "proposed" | "approved";
  requiredCapabilities: readonly ProviderCapability[];
  rowLevelRequiredCapabilities: readonly ProviderCapability[];
  minIndependentSources: readonly ProviderMinimumSourceRule[];
  requireOfficialEvidence: boolean;
  requireVersionedArtifacts: boolean;
}

export interface ProviderEvaluationConfig {
  schemaVersion: typeof PROVIDER_EVALUATION_SCHEMA_VERSION;
  evaluatedAt: string;
  selection: "not_selected";
  policy: ProviderEvaluationPolicy;
  evidence: readonly ProviderEvidence[];
  candidates: readonly ProviderCandidate[];
  bundles: readonly ProviderBundle[];
}

export interface ProviderEvaluationIssue {
  checkId: string;
  severity: "warning" | "error" | "critical";
  blocking: boolean;
  scope: "policy" | "bundle" | "provider" | "capability";
  bundleId: string;
  providerId?: string;
  capability?: ProviderCapability;
  message: string;
  evidenceIds: readonly string[];
}

export interface ProviderBundleEvaluation {
  bundleId: string;
  displayName: string;
  sourceIds: readonly string[];
  disposition: ProviderEvaluationDisposition;
  failClosed: boolean;
  canEnableEtfRealistic: boolean;
  issues: readonly ProviderEvaluationIssue[];
  fingerprint: string;
}

export interface ProviderEvaluationReport {
  outputSchemaVersion: typeof PROVIDER_EVALUATION_REPORT_SCHEMA_VERSION;
  evaluatedAt: string;
  policyVersion: string;
  policyStatus: ProviderEvaluationPolicy["status"];
  selection: "not_selected";
  configFingerprint: string;
  disposition: ProviderEvaluationDisposition;
  failClosed: boolean;
  canEnableEtfRealistic: boolean;
  evidenceFingerprints: readonly { evidenceId: string; fingerprint: string }[];
  candidateFingerprints: readonly { providerId: string; fingerprint: string }[];
  bundles: readonly ProviderBundleEvaluation[];
  fingerprint: string;
}

const CAPABILITY_STATUSES: readonly ProviderCapabilityStatus[] = [
  "verified", "documented", "partial", "unknown", "unsupported",
];
const AVAILABILITY_MODELS: readonly ProviderAvailabilityModel[] = [
  "row_level", "dataset_level", "ingest_observed", "none", "unknown",
];
const ADAPTER_STATUSES: readonly ProviderAdapterStatus[] = [
  "not_implemented", "fixture_contract", "credentialed_sample", "production_sample",
];
const EVIDENCE_KINDS: readonly ProviderEvidenceKind[] = [
  "official_documentation", "official_terms", "contract_confirmation", "sample_artifact",
];
const LICENSE_RIGHT_STATUSES: readonly ProviderLicenseRightStatus[] = [
  "confirmed", "restricted", "unknown", "prohibited",
];
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort(compareText);
  if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.join(", ")}.`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
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

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const output = value.map((item, index) => requiredString(item, `${field}[${index}]`));
  const duplicates = output.filter((item, index) => output.indexOf(item) !== index).sort(compareText);
  if (duplicates.length > 0) throw new Error(`${field} contains duplicates: ${[...new Set(duplicates)].join(", ")}.`);
  return output.sort(compareText);
}

function capabilityArray(value: unknown, field: string): ProviderCapability[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const output = value.map((item, index) => requiredEnum(item, PROVIDER_CAPABILITIES, `${field}[${index}]`));
  const duplicates = output.filter((item, index) => output.indexOf(item) !== index).sort(compareText);
  if (duplicates.length > 0) throw new Error(`${field} contains duplicates: ${[...new Set(duplicates)].join(", ")}.`);
  return output.sort(compareText);
}

function assertSha256(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${field} must be a canonical SHA-256 identifier.`);
}

function validateEvidence(value: unknown, evaluatedAt: string, index: number): ProviderEvidence {
  const field = `evidence[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, [
    "evidenceId", "kind", "version", "publisher", "title", "url", "checkedAt", "claim",
    "contentHash", "artifactId", "artifact", "snapshot",
  ], field);
  const checkedAt = value.checkedAt;
  if (!isIsoDate(checkedAt)) throw new Error(`${field}.checkedAt must be an ISO date.`);
  if (checkedAt > evaluatedAt) throw new Error(`${field}.checkedAt cannot be after evaluatedAt.`);
  const url = requiredString(value.url, `${field}.url`);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${field}.url must be an absolute HTTPS URL.`);
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error(`${field}.url must be an absolute HTTPS URL without credentials.`);
  }
  const kind = requiredEnum(value.kind, EVIDENCE_KINDS, `${field}.kind`);
  const evidenceId = requiredString(value.evidenceId, `${field}.evidenceId`);
  const version = requiredString(value.version, `${field}.version`);
  const publisher = requiredString(value.publisher, `${field}.publisher`);
  const title = requiredString(value.title, `${field}.title`);
  const contentHash = value.contentHash === undefined
    ? undefined
    : requiredString(value.contentHash, `${field}.contentHash`);
  if (contentHash !== undefined) assertSha256(contentHash, `${field}.contentHash`);
  const artifactId = value.artifactId === undefined
    ? undefined
    : requiredString(value.artifactId, `${field}.artifactId`);
  if (artifactId !== undefined) assertSha256(artifactId, `${field}.artifactId`);
  const artifact = value.artifact === undefined ? undefined : value.artifact as VersionedDataArtifact<unknown>;
  const snapshot = value.snapshot === undefined
    ? undefined
    : value.snapshot as VersionedDataArtifact<ProviderDocumentSnapshot>;
  if (kind === "sample_artifact") {
    if (artifactId === undefined || contentHash === undefined || artifact === undefined || snapshot !== undefined) {
      throw new Error(`${field} sample_artifact requires artifact, contentHash, and artifactId.`);
    }
    try {
      assertVersionedDataArtifact(artifact);
    } catch (error) {
      throw new Error(`${field}.artifact is not a valid VersionedDataArtifact: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (artifact.provenance.contentHash !== contentHash) {
      throw new Error(`${field}.contentHash does not match artifact provenance.`);
    }
    if (artifact.provenance.artifactId !== artifactId) {
      throw new Error(`${field}.artifactId does not match artifact provenance.`);
    }
  } else {
    if (artifactId !== undefined || artifact !== undefined) {
      throw new Error(`${field}.artifact and artifactId are only valid for sample_artifact evidence.`);
    }
    if ((contentHash === undefined) !== (snapshot === undefined)) {
      throw new Error(`${field} document evidence must provide contentHash and snapshot together.`);
    }
    if (snapshot !== undefined) {
      try {
        assertVersionedDataArtifact(snapshot);
      } catch (error) {
        throw new Error(`${field}.snapshot is not a valid VersionedDataArtifact: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (snapshot.provenance.artifactKind !== "provider_document") {
        throw new Error(`${field}.snapshot must use artifactKind=provider_document.`);
      }
      if (snapshot.provenance.source !== publisher || snapshot.provenance.recordId !== evidenceId) {
        throw new Error(`${field}.snapshot provenance must bind publisher and evidenceId.`);
      }
      if (snapshot.provenance.contentHash !== contentHash) {
        throw new Error(`${field}.contentHash does not match snapshot provenance.`);
      }
      if (!isRecord(snapshot.payload)) throw new Error(`${field}.snapshot payload must be an object.`);
      assertOnlyKeys(snapshot.payload, ["url", "title", "version", "content"], `${field}.snapshot.payload`);
      if (snapshot.payload.url !== url || snapshot.payload.title !== title || snapshot.payload.version !== version) {
        throw new Error(`${field}.snapshot payload does not match evidence URL, title, and version.`);
      }
      requiredString(snapshot.payload.content, `${field}.snapshot.payload.content`);
    }
  }
  return {
    evidenceId,
    kind,
    version,
    publisher,
    title,
    url,
    checkedAt,
    claim: requiredString(value.claim, `${field}.claim`),
    contentHash,
    artifactId,
    artifact,
    snapshot,
  };
}

function validateCapabilityRecord(
  value: unknown,
  field: string,
  evidenceById: ReadonlyMap<string, ProviderEvidence>,
): ProviderCapabilityRecord {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, [
    "capability", "status", "availabilityModel", "adapterStatus", "evidenceIds", "artifactIds", "limitations",
  ], field);
  const capability = requiredEnum(value.capability, PROVIDER_CAPABILITIES, `${field}.capability`);
  const status = requiredEnum(value.status, CAPABILITY_STATUSES, `${field}.status`);
  if (status === "verified") {
    throw new Error(
      `${field} status=verified is not supported by provider-evaluation-v1; `
      + "use a future schema with payload-specific validation and bound reconciliation.",
    );
  }
  const referencedEvidence = stringArray(value.evidenceIds, `${field}.evidenceIds`);
  for (const evidenceId of referencedEvidence) {
    if (!evidenceById.has(evidenceId)) throw new Error(`${field} references unknown evidenceId ${evidenceId}.`);
  }
  const artifactIds = stringArray(value.artifactIds, `${field}.artifactIds`);
  for (const [index, artifactId] of artifactIds.entries()) assertSha256(artifactId, `${field}.artifactIds[${index}]`);
  if ((status === "documented" || status === "partial") && referencedEvidence.length === 0) {
    throw new Error(`${field} status=${status} requires evidence.`);
  }
  const adapterStatus = requiredEnum(value.adapterStatus, ADAPTER_STATUSES, `${field}.adapterStatus`);
  const sampleArtifactIds = new Set(referencedEvidence
    .map((evidenceId) => evidenceById.get(evidenceId)!)
    .filter((evidence) => evidence.kind === "sample_artifact")
    .map((evidence) => evidence.artifactId!));
  if (artifactIds.some((artifactId) => !sampleArtifactIds.has(artifactId))) {
    throw new Error(`${field} artifactIds must be backed by referenced sample_artifact evidence.`);
  }
  if (artifactIds.length > 0) {
    const allowedKinds = CAPABILITY_ARTIFACT_KINDS[capability];
    for (const artifactId of artifactIds) {
      const sample = referencedEvidence
        .map((evidenceId) => evidenceById.get(evidenceId)!)
        .find((evidence) => evidence.kind === "sample_artifact" && evidence.artifactId === artifactId)!;
      if (!allowedKinds.includes(sample.artifact!.provenance.artifactKind)) {
        throw new Error(
          `${field} artifactKind=${sample.artifact!.provenance.artifactKind} cannot evidence ${capability}; expected ${allowedKinds.join(" or ")}.`,
        );
      }
    }
  }
  return {
    capability,
    status,
    availabilityModel: requiredEnum(value.availabilityModel, AVAILABILITY_MODELS, `${field}.availabilityModel`),
    adapterStatus,
    evidenceIds: referencedEvidence,
    artifactIds,
    limitations: stringArray(value.limitations, `${field}.limitations`),
  };
}

function validateLicense(
  value: unknown,
  field: string,
  evidenceById: ReadonlyMap<string, ProviderEvidence>,
): ProviderLicenseAssessment {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, [
    "overall", "privateResearch", "persistentStorage", "derivedResults", "auditReproduction", "redistribution",
    "evidenceIds", "limitations",
  ], field);
  const referencedEvidence = stringArray(value.evidenceIds, `${field}.evidenceIds`);
  for (const evidenceId of referencedEvidence) {
    if (!evidenceById.has(evidenceId)) throw new Error(`${field} references unknown evidenceId ${evidenceId}.`);
  }
  if (referencedEvidence.length === 0) throw new Error(`${field} requires official terms evidence.`);
  if (!referencedEvidence.some((evidenceId) => {
    const kind = evidenceById.get(evidenceId)!.kind;
    return kind === "official_terms" || kind === "contract_confirmation";
  })) {
    throw new Error(`${field} requires official_terms or contract_confirmation evidence.`);
  }
  const overall = requiredEnum(
    value.overall,
    ["verified", "restricted", "unknown", "incompatible"] as const,
    `${field}.overall`,
  );
  if (overall !== "unknown" && !referencedEvidence.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId)!;
    return (evidence.kind === "official_terms" || evidence.kind === "contract_confirmation")
      && evidence.snapshot !== undefined;
  })) {
    throw new Error(`${field} overall=${overall} requires an integrity-checked terms or contract snapshot.`);
  }
  return {
    overall,
    privateResearch: requiredEnum(value.privateResearch, LICENSE_RIGHT_STATUSES, `${field}.privateResearch`),
    persistentStorage: requiredEnum(value.persistentStorage, LICENSE_RIGHT_STATUSES, `${field}.persistentStorage`),
    derivedResults: requiredEnum(value.derivedResults, LICENSE_RIGHT_STATUSES, `${field}.derivedResults`),
    auditReproduction: requiredEnum(value.auditReproduction, LICENSE_RIGHT_STATUSES, `${field}.auditReproduction`),
    redistribution: requiredEnum(value.redistribution, LICENSE_RIGHT_STATUSES, `${field}.redistribution`),
    evidenceIds: referencedEvidence,
    limitations: stringArray(value.limitations, `${field}.limitations`),
  };
}

function validateCommercial(
  value: unknown,
  field: string,
  evidenceById: ReadonlyMap<string, ProviderEvidence>,
): ProviderCommercialAssessment {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["status", "humanApproved", "summary", "evidenceIds"], field);
  const referencedEvidence = stringArray(value.evidenceIds, `${field}.evidenceIds`);
  for (const evidenceId of referencedEvidence) {
    if (!evidenceById.has(evidenceId)) throw new Error(`${field} references unknown evidenceId ${evidenceId}.`);
  }
  const status = requiredEnum(value.status, ["published", "quote_required", "unknown"] as const, `${field}.status`);
  const humanApproved = requiredBoolean(value.humanApproved, `${field}.humanApproved`);
  if (status === "unknown" && humanApproved) {
    throw new Error(`${field} cannot be human-approved while commercial terms remain unknown.`);
  }
  if ((status !== "unknown" || humanApproved) && referencedEvidence.length === 0) {
    throw new Error(`${field} requires pricing or contract evidence when commercial terms are known or approved.`);
  }
  if (humanApproved && !referencedEvidence.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId)!;
    return (evidence.kind === "official_documentation"
      || evidence.kind === "official_terms"
      || evidence.kind === "contract_confirmation")
      && evidence.snapshot !== undefined;
  })) {
    throw new Error(`${field} human approval requires an integrity-checked pricing or contract snapshot.`);
  }
  return {
    status,
    humanApproved,
    summary: requiredString(value.summary, `${field}.summary`),
    evidenceIds: referencedEvidence,
  };
}

function validateCandidate(
  value: unknown,
  index: number,
  evidenceById: ReadonlyMap<string, ProviderEvidence>,
): ProviderCandidate {
  const field = `candidates[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, [
    "providerId", "independenceGroup", "displayName", "accessModel", "capabilities", "license", "commercial",
  ], field);
  if (!Array.isArray(value.capabilities)) throw new Error(`${field}.capabilities must be an array.`);
  const capabilities = value.capabilities.map((record, capabilityIndex) =>
    validateCapabilityRecord(record, `${field}.capabilities[${capabilityIndex}]`, evidenceById));
  const capabilityIds = capabilities.map((record) => record.capability);
  const duplicates = capabilityIds.filter((item, itemIndex) => capabilityIds.indexOf(item) !== itemIndex).sort(compareText);
  if (duplicates.length > 0) throw new Error(`${field}.capabilities contains duplicates: ${[...new Set(duplicates)].join(", ")}.`);
  return {
    providerId: requiredString(value.providerId, `${field}.providerId`),
    independenceGroup: requiredString(value.independenceGroup, `${field}.independenceGroup`),
    displayName: requiredString(value.displayName, `${field}.displayName`),
    accessModel: requiredEnum(
      value.accessModel,
      ["personal_subscription", "business_contract", "institutional_contract"] as const,
      `${field}.accessModel`,
    ),
    capabilities: capabilities.sort((left, right) => compareText(left.capability, right.capability)),
    license: validateLicense(value.license, `${field}.license`, evidenceById),
    commercial: validateCommercial(value.commercial, `${field}.commercial`, evidenceById),
  };
}

function validatePolicy(value: unknown): ProviderEvaluationPolicy {
  if (!isRecord(value)) throw new Error("policy must be an object.");
  assertOnlyKeys(value, [
    "version", "status", "requiredCapabilities", "rowLevelRequiredCapabilities", "minIndependentSources",
    "requireOfficialEvidence", "requireVersionedArtifacts",
  ], "policy");
  const requiredCapabilities = capabilityArray(value.requiredCapabilities, "policy.requiredCapabilities");
  if (requiredCapabilities.length === 0) throw new Error("policy.requiredCapabilities must not be empty.");
  const requiredSet = new Set(requiredCapabilities);
  const rowLevelRequiredCapabilities = capabilityArray(
    value.rowLevelRequiredCapabilities,
    "policy.rowLevelRequiredCapabilities",
  );
  for (const capability of rowLevelRequiredCapabilities) {
    if (!requiredSet.has(capability)) throw new Error(`policy row-level capability ${capability} is not required.`);
  }
  if (!Array.isArray(value.minIndependentSources)) throw new Error("policy.minIndependentSources must be an array.");
  const minIndependentSources = value.minIndependentSources.map((rule, index): ProviderMinimumSourceRule => {
    const field = `policy.minIndependentSources[${index}]`;
    if (!isRecord(rule)) throw new Error(`${field} must be an object.`);
    assertOnlyKeys(rule, ["capability", "count"], field);
    const capability = requiredEnum(rule.capability, PROVIDER_CAPABILITIES, `${field}.capability`);
    if (!requiredSet.has(capability)) throw new Error(`${field}.capability must also be required.`);
    if (!Number.isInteger(rule.count) || (rule.count as number) < 1) {
      throw new Error(`${field}.count must be a positive integer.`);
    }
    return { capability, count: rule.count as number };
  }).sort((left, right) => compareText(left.capability, right.capability));
  const duplicateRules = minIndependentSources
    .map((rule) => rule.capability)
    .filter((capability, index, all) => all.indexOf(capability) !== index);
  if (duplicateRules.length > 0) throw new Error(`policy.minIndependentSources contains duplicate capabilities.`);
  if (value.status === "approved") {
    const missingApprovedCapabilities = PROVIDER_CAPABILITIES.filter((capability) => !requiredSet.has(capability));
    if (missingApprovedCapabilities.length > 0) {
      throw new Error(`approved policy must require every provider capability; missing ${missingApprovedCapabilities.join(", ")}.`);
    }
    if (value.requireOfficialEvidence !== true || value.requireVersionedArtifacts !== true) {
      throw new Error("approved policy must require official evidence and versioned artifacts.");
    }
    const rowLevelSet = new Set(rowLevelRequiredCapabilities);
    const minimumByCapability = new Map(minIndependentSources.map((rule) => [rule.capability, rule.count]));
    const weakMajorCapabilities = APPROVED_MAJOR_CAPABILITIES.filter((capability) =>
      !rowLevelSet.has(capability) || (minimumByCapability.get(capability) ?? 0) < 2);
    if (weakMajorCapabilities.length > 0) {
      throw new Error(`approved policy must require row-level availability and two independent sources for major capabilities: ${weakMajorCapabilities.join(", ")}.`);
    }
  }
  return {
    version: requiredString(value.version, "policy.version"),
    status: requiredEnum(value.status, ["proposed", "approved"] as const, "policy.status"),
    requiredCapabilities,
    rowLevelRequiredCapabilities,
    minIndependentSources,
    requireOfficialEvidence: requiredBoolean(value.requireOfficialEvidence, "policy.requireOfficialEvidence"),
    requireVersionedArtifacts: requiredBoolean(value.requireVersionedArtifacts, "policy.requireVersionedArtifacts"),
  };
}

function validateBundle(value: unknown, index: number, providerIds: ReadonlySet<string>): ProviderBundle {
  const field = `bundles[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["bundleId", "displayName", "sourceIds", "responsibilities"], field);
  const sourceIds = stringArray(value.sourceIds, `${field}.sourceIds`);
  if (sourceIds.length === 0) throw new Error(`${field}.sourceIds must not be empty.`);
  for (const providerId of sourceIds) {
    if (!providerIds.has(providerId)) throw new Error(`${field} references unknown providerId ${providerId}.`);
  }
  if (!Array.isArray(value.responsibilities)) throw new Error(`${field}.responsibilities must be an array.`);
  const responsibilities = value.responsibilities.map((responsibility, responsibilityIndex): ProviderResponsibility => {
    const responsibilityField = `${field}.responsibilities[${responsibilityIndex}]`;
    if (!isRecord(responsibility)) throw new Error(`${responsibilityField} must be an object.`);
    assertOnlyKeys(responsibility, ["capability", "providerIds"], responsibilityField);
    const assigned = stringArray(responsibility.providerIds, `${responsibilityField}.providerIds`);
    if (assigned.length === 0) throw new Error(`${responsibilityField}.providerIds must not be empty.`);
    for (const providerId of assigned) {
      if (!sourceIds.includes(providerId)) throw new Error(`${responsibilityField} assigns provider outside bundle: ${providerId}.`);
    }
    return {
      capability: requiredEnum(responsibility.capability, PROVIDER_CAPABILITIES, `${responsibilityField}.capability`),
      providerIds: assigned,
    };
  }).sort((left, right) => compareText(left.capability, right.capability));
  const duplicateResponsibilities = responsibilities
    .map((responsibility) => responsibility.capability)
    .filter((capability, responsibilityIndex, all) => all.indexOf(capability) !== responsibilityIndex);
  if (duplicateResponsibilities.length > 0) throw new Error(`${field}.responsibilities contains duplicate capabilities.`);
  return {
    bundleId: requiredString(value.bundleId, `${field}.bundleId`),
    displayName: requiredString(value.displayName, `${field}.displayName`),
    sourceIds,
    responsibilities,
  };
}

export function validateProviderEvaluationConfig(value: unknown): ProviderEvaluationConfig {
  if (!isRecord(value)) throw new Error("Provider evaluation config must be an object.");
  assertOnlyKeys(value, ["schemaVersion", "evaluatedAt", "selection", "policy", "evidence", "candidates", "bundles"], "config");
  if (value.schemaVersion !== PROVIDER_EVALUATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported provider evaluation schemaVersion: ${String(value.schemaVersion)}.`);
  }
  if (!isIsoDate(value.evaluatedAt)) throw new Error("evaluatedAt must be an ISO date.");
  if (value.selection !== "not_selected") throw new Error("selection must remain not_selected until human approval.");
  if (!Array.isArray(value.evidence)) throw new Error("evidence must be an array.");
  const evidence = value.evidence.map((item, index) => validateEvidence(item, value.evaluatedAt as string, index));
  const evidenceIds = evidence.map((item) => item.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error("evidence contains duplicate evidenceId values.");
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  if (!Array.isArray(value.candidates)) throw new Error("candidates must be an array.");
  const candidates = value.candidates.map((candidate, index) => validateCandidate(candidate, index, evidenceById));
  const providerIds = candidates.map((candidate) => candidate.providerId);
  if (new Set(providerIds).size !== providerIds.length) throw new Error("candidates contains duplicate providerId values.");
  if (!Array.isArray(value.bundles)) throw new Error("bundles must be an array.");
  const bundles = value.bundles.map((bundle, index) => validateBundle(bundle, index, new Set(providerIds)));
  const bundleIds = bundles.map((bundle) => bundle.bundleId);
  if (new Set(bundleIds).size !== bundleIds.length) throw new Error("bundles contains duplicate bundleId values.");
  return {
    schemaVersion: PROVIDER_EVALUATION_SCHEMA_VERSION,
    evaluatedAt: value.evaluatedAt as string,
    selection: "not_selected",
    policy: validatePolicy(value.policy),
    evidence: evidence.sort((left, right) => compareText(left.evidenceId, right.evidenceId)),
    candidates: candidates.sort((left, right) => compareText(left.providerId, right.providerId)),
    bundles: bundles.sort((left, right) => compareText(left.bundleId, right.bundleId)),
  };
}

function issue(
  bundleId: string,
  checkId: string,
  severity: ProviderEvaluationIssue["severity"],
  scope: ProviderEvaluationIssue["scope"],
  message: string,
  details: {
    providerId?: string;
    capability?: ProviderCapability;
    evidenceIds?: readonly string[];
  } = {},
): ProviderEvaluationIssue {
  return {
    checkId,
    severity,
    blocking: severity === "error" || severity === "critical",
    scope,
    bundleId,
    providerId: details.providerId,
    capability: details.capability,
    message,
    evidenceIds: [...(details.evidenceIds ?? [])].sort(compareText),
  };
}

function sortIssues(issues: ProviderEvaluationIssue[]): ProviderEvaluationIssue[] {
  return issues.sort((left, right) => compareText(left.checkId, right.checkId)
    || compareText(left.providerId ?? "", right.providerId ?? "")
    || compareText(left.capability ?? "", right.capability ?? "")
    || compareText(left.message, right.message));
}

function evaluateBundle(
  bundle: ProviderBundle,
  config: ProviderEvaluationConfig,
  candidateById: ReadonlyMap<string, ProviderCandidate>,
  evidenceById: ReadonlyMap<string, ProviderEvidence>,
): ProviderBundleEvaluation {
  const issues: ProviderEvaluationIssue[] = [];
  const responsibilityByCapability = new Map(bundle.responsibilities.map((item) => [item.capability, item]));
  const rowLevelRequired = new Set(config.policy.rowLevelRequiredCapabilities);
  const minimumSources = new Map(config.policy.minIndependentSources.map((rule) => [rule.capability, rule.count]));

  // v1 evaluates provider metadata only. A real reconciliation report is not
  // part of this contract, so a metadata-only result can never be production
  // evidence even when every other check passes.
  issues.push(issue(
    bundle.bundleId,
    "evaluation.schema_research_only",
    "warning",
    "bundle",
    "Provider evaluation v1 does not bind a real reconciliation report; result is research-only.",
  ));

  if (config.policy.status !== "approved") {
    issues.push(issue(
      bundle.bundleId,
      "policy.not_approved",
      "warning",
      "policy",
      "The provider-readiness policy is proposed, not an approved O-001 production gate.",
    ));
  }

  for (const capability of config.policy.requiredCapabilities) {
    const responsibility = responsibilityByCapability.get(capability);
    if (responsibility === undefined) {
      issues.push(issue(
        bundle.bundleId,
        "capability.unassigned",
        "error",
        "capability",
        `No provider is explicitly responsible for required capability ${capability}.`,
        { capability },
      ));
      continue;
    }
    const assignedIndependenceGroups = new Set<string>();
    for (const providerId of responsibility.providerIds) {
      const candidate = candidateById.get(providerId)!;
      if (assignedIndependenceGroups.has(candidate.independenceGroup)) {
        issues.push(issue(
          bundle.bundleId,
          "reconciliation.independence_group_reused",
          "error",
          "capability",
          `${candidate.displayName} shares independenceGroup=${candidate.independenceGroup} with another assigned source for ${capability}.`,
          { providerId, capability },
        ));
      }
      assignedIndependenceGroups.add(candidate.independenceGroup);
      const record = candidate.capabilities.find((item) => item.capability === capability);
      if (record === undefined || record.status === "unknown") {
        issues.push(issue(
          bundle.bundleId,
          "capability.unknown",
          "error",
          "capability",
          `${candidate.displayName} has no confirmed evidence for ${capability}.`,
          { providerId, capability, evidenceIds: record?.evidenceIds },
        ));
        continue;
      }
      if (record.status === "unsupported") {
        issues.push(issue(
          bundle.bundleId,
          "capability.unsupported",
          "critical",
          "capability",
          `${candidate.displayName} explicitly cannot supply ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
        continue;
      }
      if (record.status === "partial") {
        issues.push(issue(
          bundle.bundleId,
          "capability.partial",
          "error",
          "capability",
          `${candidate.displayName} documents only partial coverage for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      if (record.status === "documented") {
        issues.push(issue(
          bundle.bundleId,
          "capability.not_sample_verified",
          "warning",
          "capability",
          `${candidate.displayName} documents ${capability}, but no payload-specific reconciliation has verified it.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      const referencedEvidence = record.evidenceIds
        .map((evidenceId) => evidenceById.get(evidenceId)!);
      const officialEvidence = referencedEvidence
        .some((evidence) => evidence.kind === "official_documentation" || evidence.kind === "official_terms");
      const officialEvidenceWithFingerprint = referencedEvidence.some((evidence) =>
        (evidence.kind === "official_documentation" || evidence.kind === "official_terms")
        && evidence.version.trim() !== ""
        && evidence.contentHash !== undefined
        && evidence.snapshot !== undefined);
      if (config.policy.requireOfficialEvidence && !officialEvidence) {
        issues.push(issue(
          bundle.bundleId,
          "evidence.official_missing",
          "error",
          "capability",
          `${candidate.displayName} lacks official evidence for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      if (config.policy.requireOfficialEvidence && !officialEvidenceWithFingerprint) {
        issues.push(issue(
          bundle.bundleId,
          "evidence.official_fingerprint_missing",
          "error",
          "capability",
          `${candidate.displayName} lacks versioned, content-hashed official evidence for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      if (rowLevelRequired.has(capability) && record.availabilityModel !== "row_level") {
        issues.push(issue(
          bundle.bundleId,
          "availability.row_level_missing",
          "error",
          "capability",
          `${candidate.displayName} does not prove row-level availability for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      if (record.adapterStatus !== "production_sample") {
        issues.push(issue(
          bundle.bundleId,
          "adapter.production_sample_missing",
          "error",
          "capability",
          `${candidate.displayName} has no credentialed production sample for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      if (config.policy.requireVersionedArtifacts && record.artifactIds.length === 0) {
        issues.push(issue(
          bundle.bundleId,
          "artifact.versioned_sample_missing",
          "error",
          "capability",
          `${candidate.displayName} has no versioned sample artifact for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      if (config.policy.requireVersionedArtifacts && record.artifactIds.some((artifactId) =>
        !referencedEvidence.some((evidence) => evidence.kind === "sample_artifact" && evidence.artifactId === artifactId))) {
        issues.push(issue(
          bundle.bundleId,
          "artifact.sample_binding_missing",
          "error",
          "capability",
          `${candidate.displayName} has an artifact reference not bound to a sample_artifact evidence record for ${capability}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
      const artifactsBoundToProvider = record.artifactIds.every((artifactId) =>
        referencedEvidence.some((evidence) => evidence.kind === "sample_artifact"
          && evidence.artifactId === artifactId
          && evidence.artifact?.provenance.source === providerId));
      if (config.policy.requireVersionedArtifacts && !artifactsBoundToProvider) {
        issues.push(issue(
          bundle.bundleId,
          "artifact.provider_binding_mismatch",
          "error",
          "capability",
          `${candidate.displayName} has a sample artifact whose provenance source does not match providerId ${providerId}.`,
          { providerId, capability, evidenceIds: record.evidenceIds },
        ));
      }
    }
    const minimum = minimumSources.get(capability) ?? 1;
    // provider-evaluation-v1 validates metadata and artifact envelopes only.
    // It deliberately cannot count any source as payload-verified until a
    // future schema binds capability-specific validators and reconciliation.
    const verifiedSources = 0;
    if (verifiedSources < minimum) {
      issues.push(issue(
        bundle.bundleId,
        "reconciliation.independent_sources_missing",
        "error",
        "capability",
        `${capability} requires ${minimum} independently sample-verified source(s); found ${verifiedSources}.`,
        { capability },
      ));
    }
  }

  const requiredRights = ["privateResearch", "persistentStorage", "derivedResults", "auditReproduction"] as const;
  for (const providerId of bundle.sourceIds) {
    const candidate = candidateById.get(providerId)!;
    if (candidate.license.overall === "incompatible") {
      issues.push(issue(
        bundle.bundleId,
        "license.incompatible",
        "critical",
        "provider",
        `${candidate.displayName} has an incompatible license assessment.`,
        { providerId, evidenceIds: candidate.license.evidenceIds },
      ));
    }
    if (candidate.license.overall === "unknown") {
      issues.push(issue(
        bundle.bundleId,
        "license.overall.unknown",
        "error",
        "provider",
        `${candidate.displayName} has an unknown overall license disposition.`,
        { providerId, evidenceIds: candidate.license.evidenceIds },
      ));
    } else if (candidate.license.overall === "restricted") {
      issues.push(issue(
        bundle.bundleId,
        "license.overall.restricted",
        "warning",
        "provider",
        `${candidate.displayName} has a restricted overall license disposition.`,
        { providerId, evidenceIds: candidate.license.evidenceIds },
      ));
    }
    for (const right of requiredRights) {
      const status = candidate.license[right];
      if (status === "prohibited") {
        issues.push(issue(
          bundle.bundleId,
          `license.${right}.prohibited`,
          "critical",
          "provider",
          `${candidate.displayName} prohibits required right ${right}.`,
          { providerId, evidenceIds: candidate.license.evidenceIds },
        ));
      } else if (status !== "confirmed") {
        issues.push(issue(
          bundle.bundleId,
          `license.${right}.unconfirmed`,
          "error",
          "provider",
          `${candidate.displayName} has not confirmed required right ${right}; current status is ${status}.`,
          { providerId, evidenceIds: candidate.license.evidenceIds },
        ));
      }
    }
    if (!candidate.commercial.humanApproved) {
      issues.push(issue(
        bundle.bundleId,
        "commercial.not_approved",
        "error",
        "provider",
        `${candidate.displayName} cost and contract terms have not received human approval.`,
        { providerId, evidenceIds: candidate.commercial.evidenceIds },
      ));
    }
  }

  const sortedIssues = sortIssues(issues);
  const hasCritical = sortedIssues.some((item) => item.severity === "critical");
  const hasError = sortedIssues.some((item) => item.severity === "error");
  const hasResearchBoundary = sortedIssues.some((item) => item.severity === "warning");
  const disposition: ProviderEvaluationDisposition = hasCritical
    ? "blocked"
    : hasError
    ? "unknown"
    : hasResearchBoundary
    ? "research_only"
    : "pass";
  const withoutFingerprint = {
    bundleId: bundle.bundleId,
    displayName: bundle.displayName,
    sourceIds: [...bundle.sourceIds].sort(compareText),
    disposition,
    // A bundle may satisfy the proposed evidence contract, but O-001 still
    // requires an explicit human selection. This schema intentionally has no
    // selected state, so evaluation alone can never open the production gate.
    failClosed: true,
    canEnableEtfRealistic: false,
    issues: sortedIssues,
  };
  return { ...withoutFingerprint, fingerprint: sha256Canonical(withoutFingerprint) };
}

function overallDisposition(bundles: readonly ProviderBundleEvaluation[]): ProviderEvaluationDisposition {
  const rank: Record<ProviderEvaluationDisposition, number> = {
    pass: 0,
    research_only: 1,
    unknown: 2,
    blocked: 3,
  };
  return bundles.reduce<ProviderEvaluationDisposition>(
    (worst, bundle) => rank[bundle.disposition] > rank[worst] ? bundle.disposition : worst,
    bundles.length === 0 ? "blocked" : "pass",
  );
}

export function evaluateProviderConfig(input: ProviderEvaluationConfig): ProviderEvaluationReport {
  const config = validateProviderEvaluationConfig(input);
  const candidateById = new Map(config.candidates.map((candidate) => [candidate.providerId, candidate]));
  const evidenceById = new Map(config.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const bundles = config.bundles.map((bundle) => evaluateBundle(bundle, config, candidateById, evidenceById));
  const disposition = overallDisposition(bundles);
  const withoutFingerprint = {
    outputSchemaVersion: PROVIDER_EVALUATION_REPORT_SCHEMA_VERSION,
    evaluatedAt: config.evaluatedAt,
    policyVersion: config.policy.version,
    policyStatus: config.policy.status,
    selection: "not_selected" as const,
    configFingerprint: sha256Canonical(config),
    disposition,
    failClosed: true,
    canEnableEtfRealistic: false,
    evidenceFingerprints: config.evidence.map((evidence) => ({
      evidenceId: evidence.evidenceId,
      fingerprint: sha256Canonical(evidence),
    })),
    candidateFingerprints: config.candidates.map((candidate) => ({
      providerId: candidate.providerId,
      fingerprint: sha256Canonical(candidate),
    })),
    bundles,
  };
  return { ...withoutFingerprint, fingerprint: sha256Canonical(withoutFingerprint) };
}

export function assertProviderEvaluationReportIntegrity(
  report: ProviderEvaluationReport,
  config: ProviderEvaluationConfig,
): void {
  if (report.outputSchemaVersion !== PROVIDER_EVALUATION_REPORT_SCHEMA_VERSION) {
    throw new Error(`Unsupported provider evaluation report schema: ${String(report.outputSchemaVersion)}.`);
  }
  if (report.selection !== "not_selected") throw new Error("Provider evaluation report cannot select a provider automatically.");
  if (!report.failClosed || report.canEnableEtfRealistic) {
    throw new Error("An unselected provider evaluation must remain fail-closed for ETF-realistic evidence.");
  }
  const { fingerprint, ...withoutFingerprint } = report;
  if (fingerprint !== sha256Canonical(withoutFingerprint)) {
    throw new Error("Provider evaluation report fingerprint does not match its contents.");
  }
  for (const bundle of report.bundles) {
    const { fingerprint: bundleFingerprint, ...bundleWithoutFingerprint } = bundle;
    if (bundleFingerprint !== sha256Canonical(bundleWithoutFingerprint)) {
      throw new Error(`Provider bundle ${bundle.bundleId} fingerprint does not match its contents.`);
    }
  }
  const expected = evaluateProviderConfig(config);
  if (canonicalJson(report) !== canonicalJson(expected)) {
    throw new Error("Provider evaluation report does not match a fresh evaluation of its config.");
  }
}

export function cloneProviderEvaluationConfig(config: ProviderEvaluationConfig): ProviderEvaluationConfig {
  return JSON.parse(canonicalJson(config)) as ProviderEvaluationConfig;
}
