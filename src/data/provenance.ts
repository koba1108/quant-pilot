import { createHash } from "node:crypto";

export const DATA_PROVENANCE_VERSION = "data-provenance-v1" as const;

export type DataArtifactKind =
  | "daily_bars"
  | "quote_quality"
  | "corporate_actions"
  | "distributions"
  | "fx_rates"
  | "universe"
  | "normalized_returns"
  | "reconciliation_observation"
  | "exchange_calendar"
  | "provider_document"
  | "provider_capability_evidence";

const DATA_ARTIFACT_KINDS: readonly DataArtifactKind[] = [
  "daily_bars",
  "quote_quality",
  "corporate_actions",
  "distributions",
  "fx_rates",
  "universe",
  "normalized_returns",
  "reconciliation_observation",
  "exchange_calendar",
  "provider_document",
  "provider_capability_evidence",
];

export interface SourceProvenance {
  source: string;
  dataset: string;
  retrievedAt: string;
  sourceVersion?: string;
  recordId?: string;
}

export interface DataArtifactProvenance extends SourceProvenance {
  contractVersion: typeof DATA_PROVENANCE_VERSION;
  artifactKind: DataArtifactKind;
  sourceVersion: string;
  artifactId: string;
  contentHash: string;
  adapterVersion: string;
  observedAt: string;
  availableAt: string;
  requestHash: string;
  supersedesArtifactId?: string;
}

export interface VersionedDataArtifact<T> {
  payload: T;
  provenance: DataArtifactProvenance;
}

export interface DataLineage {
  transform: string;
  transformVersion: string;
  policyId?: string;
  inputArtifactIds: readonly string[];
  outputHash: string;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} must be non-empty.`);
}

export function isIsoDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return false;
  const [, date, hourText, minuteText, secondText, zone] = match;
  try {
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return false;
  } catch {
    return false;
  }
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
    if (offsetHour! > 23 || offsetMinute! > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function canonicalize(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Canonical data contains a non-finite number at ${path}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Canonical data contains a non-plain object at ${path}.`);
    }
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      output[key] = canonicalize(record[key], `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`Canonical data contains unsupported ${typeof value} at ${path}.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, "$"));
}

export function sha256Canonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function assertSourceProvenance(provenance: SourceProvenance, field = "provenance"): void {
  assertNonEmpty(provenance.source, `${field}.source`);
  assertNonEmpty(provenance.dataset, `${field}.dataset`);
  if (!isIsoDateTime(provenance.retrievedAt)) {
    throw new Error(`${field}.retrievedAt must be an ISO timestamp with timezone.`);
  }
  if (provenance.sourceVersion !== undefined) {
    assertNonEmpty(provenance.sourceVersion, `${field}.sourceVersion`);
  }
  if (provenance.recordId !== undefined) assertNonEmpty(provenance.recordId, `${field}.recordId`);
}

export function assertDataArtifactProvenance(provenance: DataArtifactProvenance): void {
  assertSourceProvenance(provenance);
  if (provenance.contractVersion !== DATA_PROVENANCE_VERSION) {
    throw new Error(`Unsupported provenance contractVersion: ${provenance.contractVersion}.`);
  }
  if (!DATA_ARTIFACT_KINDS.includes(provenance.artifactKind)) {
    throw new Error(`Unsupported provenance artifactKind: ${String(provenance.artifactKind)}.`);
  }
  if (typeof provenance.sourceVersion !== "string" || provenance.sourceVersion.trim() === "") {
    throw new Error("provenance.sourceVersion must be a non-empty string.");
  }
  for (const [field, value] of [
    ["artifactId", provenance.artifactId],
    ["contentHash", provenance.contentHash],
    ["adapterVersion", provenance.adapterVersion],
    ["requestHash", provenance.requestHash],
  ] as const) {
    assertNonEmpty(value, `provenance.${field}`);
  }
  for (const field of ["artifactId", "contentHash", "requestHash"] as const) {
    if (!/^sha256:[0-9a-f]{64}$/.test(provenance[field])) {
      throw new Error(`provenance.${field} must be a canonical SHA-256 identifier.`);
    }
  }
  if (!isIsoDateTime(provenance.observedAt)) {
    throw new Error("provenance.observedAt must be an ISO timestamp with timezone.");
  }
  if (!isIsoDateTime(provenance.availableAt)) {
    throw new Error("provenance.availableAt must be an ISO timestamp with timezone.");
  }
  if (Date.parse(provenance.observedAt) > Date.parse(provenance.availableAt)) {
    throw new Error("provenance.observedAt must not be after availableAt.");
  }
  if (Date.parse(provenance.availableAt) > Date.parse(provenance.retrievedAt)) {
    throw new Error("provenance.availableAt must not be after retrievedAt.");
  }
  if (provenance.supersedesArtifactId !== undefined) {
    assertNonEmpty(provenance.supersedesArtifactId, "provenance.supersedesArtifactId");
    if (!/^sha256:[0-9a-f]{64}$/.test(provenance.supersedesArtifactId)) {
      throw new Error("provenance.supersedesArtifactId must be a canonical SHA-256 identifier.");
    }
    if (provenance.supersedesArtifactId === provenance.artifactId) {
      throw new Error("A data artifact cannot supersede itself.");
    }
  }
  if (provenance.artifactId !== expectedArtifactId(provenance)) {
    throw new Error("provenance.artifactId does not match its canonical metadata.");
  }
}

function expectedArtifactId(provenance: DataArtifactProvenance): string {
  return sha256Canonical({
    artifactKind: provenance.artifactKind,
    contentHash: provenance.contentHash,
    source: provenance.source,
    dataset: provenance.dataset,
    sourceVersion: provenance.sourceVersion,
    adapterVersion: provenance.adapterVersion,
    observedAt: provenance.observedAt,
    availableAt: provenance.availableAt,
    requestHash: provenance.requestHash,
    recordId: provenance.recordId,
    supersedesArtifactId: provenance.supersedesArtifactId,
  });
}

export function assertVersionedDataArtifact<T>(artifact: VersionedDataArtifact<T>): void {
  assertDataArtifactProvenance(artifact.provenance);
  const contentHash = sha256Canonical(artifact.payload);
  if (artifact.provenance.contentHash !== contentHash) {
    throw new Error("Data artifact contentHash does not match its payload.");
  }
  const artifactId = expectedArtifactId(artifact.provenance);
  if (artifact.provenance.artifactId !== artifactId) {
    throw new Error("Data artifact artifactId does not match its canonical metadata.");
  }
}

export interface BuildDataArtifactInput<T> {
  artifactKind: DataArtifactKind;
  payload: T;
  source: string;
  dataset: string;
  sourceVersion: string;
  adapterVersion: string;
  observedAt: string;
  availableAt: string;
  retrievedAt: string;
  request: unknown;
  recordId?: string;
  supersedesArtifactId?: string;
}

export function buildVersionedDataArtifact<T>(input: BuildDataArtifactInput<T>): VersionedDataArtifact<T> {
  const contentHash = sha256Canonical(input.payload);
  const requestHash = sha256Canonical(input.request);
  const provenance: DataArtifactProvenance = {
    contractVersion: DATA_PROVENANCE_VERSION,
    artifactKind: input.artifactKind,
    artifactId: "sha256:" + "0".repeat(64),
    contentHash,
    source: input.source,
    dataset: input.dataset,
    sourceVersion: input.sourceVersion,
    adapterVersion: input.adapterVersion,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
    retrievedAt: input.retrievedAt,
    requestHash,
    recordId: input.recordId,
    supersedesArtifactId: input.supersedesArtifactId,
  };
  provenance.artifactId = expectedArtifactId(provenance);
  const artifact = { payload: input.payload, provenance };
  assertVersionedDataArtifact(artifact);
  return artifact;
}
