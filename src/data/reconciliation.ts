import type { DataQualityIssue, DataQualitySeverity } from "./data-quality.ts";
import {
  assertDataArtifactProvenance,
  assertVersionedDataArtifact,
  canonicalJson,
  isIsoDateTime,
  sha256Canonical,
  type DataArtifactKind,
  type DataArtifactProvenance,
  type VersionedDataArtifact,
} from "./provenance.ts";
import { compareText } from "../determinism.ts";

export const RECONCILIATION_SCHEMA_VERSION = "cross-source-reconciliation-v1" as const;

export type ComparableField =
  | "close"
  | "adjustedClose"
  | "volume"
  | "tradingValue"
  | "spreadBps"
  | "depthJpy"
  | "distributionAmount"
  | "splitRatio"
  | "fxRate";

export interface ComparableObservationKey {
  code: string;
  date: string;
  field: ComparableField;
  basis?: string;
  currency?: string;
  unit?: string;
  quoteConvention?: string;
  eventKey?: string;
}

export interface ComparableObservation {
  key: ComparableObservationKey;
  value: number;
  source: string;
  availableAt: string;
  recordId: string;
  parentArtifactId: string;
  parentProvenance: DataArtifactProvenance;
  artifact: VersionedDataArtifact<ComparableObservationEvidence>;
}

export interface ComparableObservationEvidence {
  key: ComparableObservationKey;
  value: number;
  source: string;
  availableAt: string;
  recordId: string;
  parentArtifactId: string;
  parentProvenance: DataArtifactProvenance;
}

export interface ReconciliationTolerance {
  warningAbsolute?: number;
  warningRelative?: number;
  blockingAbsolute?: number;
  blockingRelative?: number;
}

export interface ReconciliationPolicy {
  version: string;
  mode: "advisory" | "required";
  minSources: number;
  tolerances: Partial<Record<ComparableField, ReconciliationTolerance>>;
}

export interface ReconciliationValue {
  source: string;
  value: number;
  availableAt: string;
  recordId: string;
  artifactId: string;
  parentArtifactId: string;
  parentProvenance: DataArtifactProvenance;
  artifact: VersionedDataArtifact<ComparableObservationEvidence>;
}

export interface ReconciliationGroupResult {
  key: ComparableObservationKey;
  status: "matched" | "warning" | "blocked" | "insufficient_sources" | "policy_missing";
  values: readonly ReconciliationValue[];
  maxAbsoluteDifference: number;
  maxRelativeDifference: number;
}

export interface ReconciliationReport {
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  policy: ReconciliationPolicy;
  policyVersion: string;
  policyFingerprint: string;
  mode: ReconciliationPolicy["mode"];
  minSources: number;
  decisionDate: string;
  status: "reconciled" | "advisory" | "blocked";
  groups: readonly ReconciliationGroupResult[];
  issues: readonly DataQualityIssue[];
  inputArtifactIds: readonly string[];
  parentArtifactIds: readonly string[];
  excludedObservations: {
    futureAvailability: number;
    futureSemanticDate: number;
  };
  fingerprint: string;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function cutoff(value: string): number {
  if (isIsoDate(value)) return Date.parse(`${value}T23:59:59.999Z`);
  if (!isIsoDateTime(value)) throw new Error(`Invalid reconciliation decisionDate: ${value}.`);
  return Date.parse(value);
}

function validateNonNegative(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new Error(`${field} must be a finite non-negative number.`);
  }
}

const COMPARABLE_FIELDS: readonly ComparableField[] = [
  "close", "adjustedClose", "volume", "tradingValue", "spreadBps", "depthJpy",
  "distributionAmount", "splitRatio", "fxRate",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireKeyDimension(value: string | undefined, field: string, recordId: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Reconciliation ${field} is required for ${recordId}.`);
  }
}

function validateComparableKey(key: ComparableObservationKey, recordId: string): void {
  requireKeyDimension(key.code, "code", recordId);
  if (!isIsoDate(key.date)) throw new Error(`Invalid reconciliation date for ${recordId}.`);
  if (!COMPARABLE_FIELDS.includes(key.field)) {
    throw new Error(`Unsupported reconciliation field for ${recordId}: ${String(key.field)}.`);
  }
  switch (key.field) {
    case "close":
    case "adjustedClose":
      requireKeyDimension(key.basis, "basis", recordId);
      requireKeyDimension(key.currency, "currency", recordId);
      break;
    case "volume":
      requireKeyDimension(key.unit, "unit", recordId);
      break;
    case "tradingValue":
    case "depthJpy":
      requireKeyDimension(key.currency, "currency", recordId);
      break;
    case "spreadBps":
      requireKeyDimension(key.unit, "unit", recordId);
      break;
    case "distributionAmount":
      requireKeyDimension(key.currency, "currency", recordId);
      requireKeyDimension(key.eventKey, "eventKey", recordId);
      break;
    case "splitRatio":
      requireKeyDimension(key.eventKey, "eventKey", recordId);
      break;
    case "fxRate":
      requireKeyDimension(key.currency, "currency pair", recordId);
      requireKeyDimension(key.quoteConvention, "quoteConvention", recordId);
      break;
  }
}

function validateComparableValue(field: ComparableField, value: number, recordId: string): void {
  if (!Number.isFinite(value)) throw new Error(`Non-finite reconciliation value for ${recordId}.`);
  switch (field) {
    case "close":
    case "adjustedClose":
    case "distributionAmount":
    case "splitRatio":
    case "fxRate":
      if (value <= 0) throw new Error(`Reconciliation ${field} must be positive for ${recordId}.`);
      break;
    case "volume":
    case "tradingValue":
    case "spreadBps":
    case "depthJpy":
      if (value < 0) throw new Error(`Reconciliation ${field} must be non-negative for ${recordId}.`);
      break;
  }
}

function expectedParentArtifactKind(field: ComparableField): DataArtifactKind {
  switch (field) {
    case "close":
    case "adjustedClose":
    case "volume":
    case "tradingValue":
      return "daily_bars";
    case "spreadBps":
    case "depthJpy":
      return "quote_quality";
    case "distributionAmount":
      return "distributions";
    case "splitRatio":
      return "corporate_actions";
    case "fxRate":
      return "fx_rates";
  }
}

function validateParentProvenance(
  key: ComparableObservationKey,
  parentArtifactId: string,
  parentProvenance: DataArtifactProvenance,
  observationAvailableAt: string,
  recordId: string,
): void {
  assertDataArtifactProvenance(parentProvenance);
  if (parentProvenance.artifactId !== parentArtifactId) {
    throw new Error(`Reconciliation parent provenance does not match parentArtifactId for ${recordId}.`);
  }
  const expectedKind = expectedParentArtifactKind(key.field);
  if (parentProvenance.artifactKind !== expectedKind) {
    throw new Error(`Reconciliation ${key.field} requires parent artifactKind=${expectedKind} for ${recordId}.`);
  }
  if (Date.parse(observationAvailableAt) < Date.parse(parentProvenance.availableAt)) {
    throw new Error(`Reconciliation observation cannot be available before its parent artifact for ${recordId}.`);
  }
}

function validatePolicy(policy: ReconciliationPolicy): void {
  if (typeof policy.version !== "string" || policy.version.trim() === "") {
    throw new Error("Reconciliation policy version must be non-empty.");
  }
  if (policy.mode !== "advisory" && policy.mode !== "required") {
    throw new Error(`Reconciliation mode must be advisory or required; received ${String(policy.mode)}.`);
  }
  if (!Number.isInteger(policy.minSources) || policy.minSources < 2) {
    throw new Error("Reconciliation minSources must be an integer of at least two.");
  }
  if (!isRecord(policy.tolerances)) throw new Error("Reconciliation tolerances must be an object.");
  for (const [field, tolerance] of Object.entries(policy.tolerances)) {
    if (tolerance === undefined) continue;
    if (!COMPARABLE_FIELDS.includes(field as ComparableField)) {
      throw new Error(`Unsupported reconciliation tolerance field: ${field}.`);
    }
    if (!isRecord(tolerance)) throw new Error(`reconciliation tolerance ${field} must be an object.`);
    const unknown = Object.keys(tolerance).filter((key) => ![
      "warningAbsolute", "warningRelative", "blockingAbsolute", "blockingRelative",
    ].includes(key));
    if (unknown.length > 0) throw new Error(`reconciliation tolerance ${field} contains unknown fields: ${unknown.join(", ")}.`);
    for (const [name, value] of Object.entries(tolerance)) {
      validateNonNegative(value, `reconciliation tolerance ${field}.${name}`);
    }
    const typedTolerance = tolerance as ReconciliationTolerance;
    const hasWarning = typedTolerance.warningAbsolute !== undefined || typedTolerance.warningRelative !== undefined;
    const hasBlocking = typedTolerance.blockingAbsolute !== undefined || typedTolerance.blockingRelative !== undefined;
    if (!hasWarning && !hasBlocking) {
      throw new Error(`reconciliation tolerance ${field} must define at least one warning or blocking threshold.`);
    }
    if (policy.mode === "required" && !hasBlocking) {
      throw new Error(`required reconciliation tolerance ${field} must define a blocking threshold.`);
    }
    if (typedTolerance.warningAbsolute !== undefined && typedTolerance.blockingAbsolute !== undefined
      && typedTolerance.warningAbsolute > typedTolerance.blockingAbsolute) {
      throw new Error(`reconciliation tolerance ${field}.warningAbsolute must not exceed blockingAbsolute.`);
    }
    if (typedTolerance.warningRelative !== undefined && typedTolerance.blockingRelative !== undefined
      && typedTolerance.warningRelative > typedTolerance.blockingRelative) {
      throw new Error(`reconciliation tolerance ${field}.warningRelative must not exceed blockingRelative.`);
    }
  }
}

function evidence(observations: readonly ComparableObservation[]) {
  return observations.map((observation) => ({
    artifactId: observation.artifact.provenance.artifactId,
    source: observation.artifact.provenance.source,
    dataset: observation.artifact.provenance.dataset,
    recordIds: [observation.recordId],
  })).sort((left, right) => compareText(left.artifactId, right.artifactId)
    || compareText(left.recordIds[0]!, right.recordIds[0]!));
}

function runIssue(checkId: string, severity: DataQualitySeverity, message: string): DataQualityIssue {
  return {
    checkId,
    severity,
    blocking: severity === "error" || severity === "critical",
    scope: "run",
    message,
    evidence: [],
  };
}

function issue(
  checkId: string,
  severity: DataQualitySeverity,
  message: string,
  key: ComparableObservationKey,
  observations: readonly ComparableObservation[],
): DataQualityIssue {
  return {
    checkId,
    severity,
    blocking: severity === "error" || severity === "critical",
    scope: "record",
    code: key.code,
    tradingDate: key.date,
    field: key.field,
    message,
    evidence: evidence(observations),
  };
}

function exceeds(
  absoluteDifference: number,
  relativeDifference: number,
  tolerance: ReconciliationTolerance,
  kind: "warning" | "blocking",
): boolean {
  const absolute = kind === "warning" ? tolerance.warningAbsolute : tolerance.blockingAbsolute;
  const relative = kind === "warning" ? tolerance.warningRelative : tolerance.blockingRelative;
  return (absolute !== undefined && absoluteDifference > absolute)
    || (relative !== undefined && relativeDifference > relative);
}

function groupKey(key: ComparableObservationKey): string {
  return canonicalJson(key);
}

interface ReconciliationGroupEvaluation {
  status: ReconciliationGroupResult["status"];
  maxAbsoluteDifference: number;
  maxRelativeDifference: number;
  issue?: {
    checkId: string;
    severity: DataQualitySeverity;
    message: string;
  };
}

function evaluateGroupValues(
  values: readonly Pick<ReconciliationValue, "source" | "value">[],
  field: ComparableField,
  policy: ReconciliationPolicy,
): ReconciliationGroupEvaluation {
  const bySource = new Map<string, readonly Pick<ReconciliationValue, "source" | "value">[]>();
  for (const value of values) {
    const sourceValues = bySource.get(value.source) ?? [];
    bySource.set(value.source, [...sourceValues, value]);
  }

  const unique = [...bySource.values()].map((sourceValues) => sourceValues[0]!);
  let maxAbsoluteDifference = 0;
  let maxRelativeDifference = 0;
  for (let leftIndex = 0; leftIndex < unique.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex++) {
      const left = unique[leftIndex]!.value;
      const right = unique[rightIndex]!.value;
      const absoluteDifference = Math.abs(left - right);
      const denominator = Math.max(Math.abs(left), Math.abs(right));
      const relativeDifference = denominator === 0 ? 0 : absoluteDifference / denominator;
      maxAbsoluteDifference = Math.max(maxAbsoluteDifference, absoluteDifference);
      maxRelativeDifference = Math.max(maxRelativeDifference, relativeDifference);
    }
  }

  if ([...bySource.values()].some((sourceValues) => sourceValues.length > 1)) {
    return {
      status: "blocked",
      maxAbsoluteDifference,
      maxRelativeDifference,
      issue: {
        checkId: "reconciliation.duplicate_source_observation",
        severity: "critical",
        message: "One source supplied multiple values for the same semantic key.",
      },
    };
  }
  if (bySource.size < policy.minSources) {
    return {
      status: "insufficient_sources",
      maxAbsoluteDifference,
      maxRelativeDifference,
      issue: {
        checkId: "reconciliation.insufficient_sources",
        severity: policy.mode === "required" ? "error" : "warning",
        message: `The semantic key has ${bySource.size} source(s); ${policy.minSources} are required for comparison.`,
      },
    };
  }

  const tolerance = policy.tolerances[field];
  if (tolerance === undefined) {
    return {
      status: policy.mode === "required" ? "blocked" : "policy_missing",
      maxAbsoluteDifference,
      maxRelativeDifference,
      issue: {
        checkId: "reconciliation.tolerance_missing",
        severity: policy.mode === "required" ? "error" : "warning",
        message: "No versioned tolerance is configured for this comparable field.",
      },
    };
  }
  if (exceeds(maxAbsoluteDifference, maxRelativeDifference, tolerance, "blocking")) {
    return {
      status: "blocked",
      maxAbsoluteDifference,
      maxRelativeDifference,
      issue: {
        checkId: "reconciliation.material_conflict",
        severity: "critical",
        message: "Source values exceed the configured blocking tolerance; no source was selected as a winner.",
      },
    };
  }
  if (exceeds(maxAbsoluteDifference, maxRelativeDifference, tolerance, "warning")) {
    return {
      status: "warning",
      maxAbsoluteDifference,
      maxRelativeDifference,
      issue: {
        checkId: "reconciliation.warning_difference",
        severity: "warning",
        message: "Source values exceed the configured warning tolerance.",
      },
    };
  }
  return { status: "matched", maxAbsoluteDifference, maxRelativeDifference };
}

function issueSemanticSignature(item: DataQualityIssue): string {
  return canonicalJson({
    checkId: item.checkId,
    severity: item.severity,
    blocking: item.blocking,
    scope: item.scope,
    code: item.code,
    tradingDate: item.tradingDate,
    field: item.field,
    message: item.message,
    evidence: item.evidence.map((entry) => ({
      artifactId: entry.artifactId,
      source: entry.source,
      recordIds: entry.recordIds,
    })).sort((left, right) => compareText(left.artifactId, right.artifactId)
      || compareText(left.recordIds?.[0] ?? "", right.recordIds?.[0] ?? "")),
  });
}

export function reconcileComparableObservations(
  observations: readonly ComparableObservation[],
  decisionDate: string,
  policy: ReconciliationPolicy,
): ReconciliationReport {
  validatePolicy(policy);
  const reportPolicy = JSON.parse(canonicalJson(policy)) as ReconciliationPolicy;
  const decisionCutoff = cutoff(decisionDate);
  const decisionCalendarDate = new Date(decisionCutoff).toISOString().slice(0, 10);
  const excludedObservations = { futureAvailability: 0, futureSemanticDate: 0 };
  const allArtifactIds = new Set<string>();
  const allParentArtifactIds = new Set<string>();
  const usable: ComparableObservation[] = [];
  for (const observation of observations) {
    validateComparableKey(observation.key, observation.recordId);
    validateComparableValue(observation.key.field, observation.value, observation.recordId);
    if (!isIsoDateTime(observation.availableAt)) throw new Error(`Invalid availableAt for ${observation.recordId}.`);
    if (observation.source.trim() === "" || observation.recordId.trim() === "") {
      throw new Error("Reconciliation source and recordId must be non-empty.");
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(observation.parentArtifactId)) {
      throw new Error(`Reconciliation parentArtifactId must be canonical for ${observation.recordId}.`);
    }
    validateParentProvenance(
      observation.key,
      observation.parentArtifactId,
      observation.parentProvenance,
      observation.availableAt,
      observation.recordId,
    );
    assertVersionedDataArtifact(observation.artifact);
    if (observation.artifact.provenance.artifactKind !== "reconciliation_observation") {
      throw new Error(`Reconciliation evidence must use artifactKind=reconciliation_observation for ${observation.recordId}.`);
    }
    const observationEvidence: ComparableObservationEvidence = {
      key: observation.key,
      value: observation.value,
      source: observation.source,
      availableAt: observation.availableAt,
      recordId: observation.recordId,
      parentArtifactId: observation.parentArtifactId,
      parentProvenance: observation.parentProvenance,
    };
    if (canonicalJson(observationEvidence) !== canonicalJson(observation.artifact.payload)) {
      throw new Error(`Reconciliation evidence payload does not match observation ${observation.recordId}.`);
    }
    if (observation.availableAt !== observation.artifact.provenance.availableAt) {
      throw new Error(`Reconciliation availableAt does not match provenance for ${observation.recordId}.`);
    }
    if (observation.source !== observation.artifact.provenance.source) {
      throw new Error(`Reconciliation source does not match provenance for ${observation.recordId}.`);
    }
    if (observation.artifact.provenance.recordId !== observation.recordId) {
      throw new Error(`Reconciliation recordId does not match provenance for ${observation.recordId}.`);
    }
    allArtifactIds.add(observation.artifact.provenance.artifactId);
    allParentArtifactIds.add(observation.parentArtifactId);
    if (observation.key.date > decisionCalendarDate) {
      excludedObservations.futureSemanticDate++;
      continue;
    }
    if (Date.parse(observation.availableAt) > decisionCutoff) {
      excludedObservations.futureAvailability++;
      continue;
    }
    usable.push(observation);
  }
  usable.sort((left, right) => compareText(groupKey(left.key), groupKey(right.key))
    || compareText(left.source, right.source)
    || compareText(left.recordId, right.recordId));

  const grouped = new Map<string, ComparableObservation[]>();
  for (const observation of usable) {
    const key = groupKey(observation.key);
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }

  const issues: DataQualityIssue[] = [];
  const groups: ReconciliationGroupResult[] = [];
  if (usable.length === 0 && reportPolicy.mode === "required") {
    issues.push(runIssue(
      "reconciliation.no_usable_observations",
      "error",
      "Required reconciliation has no observations available for a non-future semantic date.",
    ));
  }
  for (const keyString of [...grouped.keys()].sort()) {
    const group = grouped.get(keyString)!;
    const key = group[0]!.key;
    const evaluation = evaluateGroupValues(group, key.field, reportPolicy);
    if (evaluation.issue !== undefined) {
      issues.push(issue(
        evaluation.issue.checkId,
        evaluation.issue.severity,
        evaluation.issue.message,
        key,
        group,
      ));
    }

    groups.push({
      key: JSON.parse(canonicalJson(key)) as ComparableObservationKey,
      status: evaluation.status,
      values: group.map((observation) => ({
        source: observation.source,
        value: observation.value,
        availableAt: observation.availableAt,
        recordId: observation.recordId,
        artifactId: observation.artifact.provenance.artifactId,
        parentArtifactId: observation.parentArtifactId,
        parentProvenance: JSON.parse(canonicalJson(observation.parentProvenance)) as DataArtifactProvenance,
        artifact: JSON.parse(canonicalJson(observation.artifact)) as VersionedDataArtifact<ComparableObservationEvidence>,
      })).sort((left, right) => compareText(left.source, right.source) || compareText(left.recordId, right.recordId)),
      maxAbsoluteDifference: evaluation.maxAbsoluteDifference,
      maxRelativeDifference: evaluation.maxRelativeDifference,
    });
  }

  issues.sort((left, right) => compareText(left.checkId, right.checkId)
    || compareText(left.code ?? "", right.code ?? "")
    || compareText(left.tradingDate ?? "", right.tradingDate ?? "")
    || compareText(left.field ?? "", right.field ?? ""));
  const blocked = issues.some((item) => item.blocking);
  const compared = groups.some((group) => new Set(group.values.map((value) => value.source)).size >= reportPolicy.minSources);
  const advisory = issues.length > 0 || !compared;
  const status: ReconciliationReport["status"] = blocked ? "blocked" : advisory ? "advisory" : "reconciled";
  const inputArtifactIds = [...allArtifactIds].sort(compareText);
  const parentArtifactIds = [...allParentArtifactIds].sort(compareText);
  const reportWithoutFingerprint = {
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    policy: reportPolicy,
    policyVersion: reportPolicy.version,
    policyFingerprint: sha256Canonical(reportPolicy),
    mode: reportPolicy.mode,
    minSources: reportPolicy.minSources,
    decisionDate,
    status,
    groups,
    issues,
    inputArtifactIds,
    parentArtifactIds,
    excludedObservations,
  };
  const report = { ...reportWithoutFingerprint, fingerprint: sha256Canonical(reportWithoutFingerprint) };
  assertReconciliationReportIntegrity(report);
  return report;
}

export function assertReconciliationReportIntegrity(report: ReconciliationReport): void {
  if (report.schemaVersion !== RECONCILIATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported reconciliation schemaVersion: ${String(report.schemaVersion)}.`);
  }
  if (!isRecord(report.policy)) throw new Error("Reconciliation report policy must be an object.");
  validatePolicy(report.policy);
  if (report.policyVersion !== report.policy.version) throw new Error("Reconciliation report policyVersion is inconsistent.");
  if (!/^sha256:[0-9a-f]{64}$/.test(report.policyFingerprint)) {
    throw new Error("Reconciliation report policyFingerprint must be canonical.");
  }
  if (report.mode !== "advisory" && report.mode !== "required") {
    throw new Error(`Reconciliation report mode is invalid: ${String(report.mode)}.`);
  }
  if (!Number.isInteger(report.minSources) || report.minSources < 2) {
    throw new Error("Reconciliation report minSources must be at least two.");
  }
  if (report.mode !== report.policy.mode || report.minSources !== report.policy.minSources
    || report.policyFingerprint !== sha256Canonical(report.policy)) {
    throw new Error("Reconciliation report policy metadata is inconsistent.");
  }
  const reportDecisionCutoff = cutoff(report.decisionDate);
  const reportDecisionDate = new Date(reportDecisionCutoff).toISOString().slice(0, 10);
  const { fingerprint, ...body } = report;
  if (sha256Canonical(body) !== fingerprint) throw new Error("Reconciliation report fingerprint is invalid.");
  for (const [field, identifiers] of [
    ["inputArtifactIds", report.inputArtifactIds],
    ["parentArtifactIds", report.parentArtifactIds],
  ] as const) {
    if (new Set(identifiers).size !== identifiers.length || identifiers.some((id) => !/^sha256:[0-9a-f]{64}$/.test(id))) {
      throw new Error(`Reconciliation report ${field} must contain unique canonical identifiers.`);
    }
    if (canonicalJson(identifiers) !== canonicalJson([...identifiers].sort(compareText))) {
      throw new Error(`Reconciliation report ${field} must be canonically ordered.`);
    }
  }
  if (!Number.isInteger(report.excludedObservations.futureAvailability)
    || report.excludedObservations.futureAvailability < 0
    || !Number.isInteger(report.excludedObservations.futureSemanticDate)
    || report.excludedObservations.futureSemanticDate < 0) {
    throw new Error("Reconciliation report exclusion counts must be non-negative integers.");
  }
  const artifactIds = new Set(report.inputArtifactIds);
  const parentArtifactIds = new Set(report.parentArtifactIds);
  const groupKeys = new Set<string>();
  const expectedIssues: DataQualityIssue[] = [];
  let previousGroupKey: string | undefined;
  for (const group of report.groups) {
    validateComparableKey(group.key, `report group ${group.key.code}/${group.key.date}/${group.key.field}`);
    const key = groupKey(group.key);
    if (groupKeys.has(key)) throw new Error("Reconciliation report contains duplicate semantic groups.");
    if (previousGroupKey !== undefined && compareText(previousGroupKey, key) >= 0) {
      throw new Error("Reconciliation report groups must be canonically ordered.");
    }
    if (group.key.date > reportDecisionDate) {
      throw new Error("Reconciliation report contains a future semantic date.");
    }
    groupKeys.add(key);
    previousGroupKey = key;
    if (!["matched", "warning", "blocked", "insufficient_sources", "policy_missing"].includes(group.status)) {
      throw new Error(`Reconciliation report contains an invalid group status: ${String(group.status)}.`);
    }
    if (!Number.isFinite(group.maxAbsoluteDifference) || group.maxAbsoluteDifference < 0
      || !Number.isFinite(group.maxRelativeDifference) || group.maxRelativeDifference < 0) {
      throw new Error("Reconciliation report group differences must be finite and non-negative.");
    }
    if (group.values.length === 0) throw new Error("Reconciliation report groups must contain values.");
    for (const value of group.values) {
      validateComparableValue(group.key.field, value.value, value.recordId);
      if (value.source.trim() === "" || value.recordId.trim() === "" || !Number.isFinite(value.value)
        || !isIsoDateTime(value.availableAt) || Date.parse(value.availableAt) > reportDecisionCutoff
        || !artifactIds.has(value.artifactId) || !parentArtifactIds.has(value.parentArtifactId)) {
        throw new Error("Reconciliation report contains an invalid group value.");
      }
      validateParentProvenance(
        group.key,
        value.parentArtifactId,
        value.parentProvenance,
        value.availableAt,
        value.recordId,
      );
      assertVersionedDataArtifact(value.artifact);
      const provenance = value.artifact.provenance;
      if (provenance.artifactKind !== "reconciliation_observation"
        || provenance.artifactId !== value.artifactId
        || provenance.source !== value.source
        || provenance.availableAt !== value.availableAt
        || provenance.recordId !== value.recordId
        || canonicalJson(value.artifact.payload) !== canonicalJson({
          key: group.key,
          value: value.value,
          source: value.source,
          availableAt: value.availableAt,
          recordId: value.recordId,
          parentArtifactId: value.parentArtifactId,
          parentProvenance: value.parentProvenance,
        })) {
        throw new Error("Reconciliation report group value does not match its evidence artifact.");
      }
    }
    const sortedValues = [...group.values].sort((left, right) => compareText(left.source, right.source)
      || compareText(left.recordId, right.recordId));
    if (canonicalJson(group.values) !== canonicalJson(sortedValues)) {
      throw new Error("Reconciliation report group values must be canonically ordered.");
    }
    const evaluation = evaluateGroupValues(group.values, group.key.field, report.policy);
    if (group.status !== evaluation.status
      || group.maxAbsoluteDifference !== evaluation.maxAbsoluteDifference
      || group.maxRelativeDifference !== evaluation.maxRelativeDifference) {
      throw new Error("Reconciliation report group result is inconsistent with its values and policy.");
    }
    if (evaluation.issue !== undefined) {
      expectedIssues.push({
        checkId: evaluation.issue.checkId,
        severity: evaluation.issue.severity,
        blocking: evaluation.issue.severity === "error" || evaluation.issue.severity === "critical",
        scope: "record",
        code: group.key.code,
        tradingDate: group.key.date,
        field: group.key.field,
        message: evaluation.issue.message,
        evidence: group.values.map((value) => ({
          artifactId: value.artifactId,
          source: value.source,
          dataset: value.artifact.provenance.dataset,
          recordIds: [value.recordId],
        })).sort((left, right) => compareText(left.artifactId, right.artifactId)
          || compareText(left.recordIds[0]!, right.recordIds[0]!)),
      });
    }
  }
  if (report.groups.length === 0 && report.mode === "required") {
    expectedIssues.push(runIssue(
      "reconciliation.no_usable_observations",
      "error",
      "Required reconciliation has no observations available for a non-future semantic date.",
    ));
  }
  for (const item of report.issues) {
    if (!["info", "warning", "error", "critical"].includes(item.severity)
      || typeof item.checkId !== "string" || item.checkId.trim() === ""
      || typeof item.message !== "string" || item.message.trim() === "") {
      throw new Error("Reconciliation report contains an invalid issue.");
    }
    if (item.blocking !== (item.severity === "error" || item.severity === "critical")) {
      throw new Error("Reconciliation report contains inconsistent issue severity.");
    }
    for (const itemEvidence of item.evidence) {
      if (!artifactIds.has(itemEvidence.artifactId)
        || itemEvidence.source.trim() === ""
        || itemEvidence.dataset.trim() === "") {
        throw new Error("Reconciliation report contains invalid issue evidence.");
      }
    }
  }
  const actualIssueSignatures = report.issues.map(issueSemanticSignature).sort(compareText);
  const expectedIssueSignatures = expectedIssues.map(issueSemanticSignature).sort(compareText);
  if (canonicalJson(actualIssueSignatures) !== canonicalJson(expectedIssueSignatures)) {
    throw new Error("Reconciliation report issues are inconsistent with its values and policy.");
  }
  const blocked = expectedIssues.some((item) => item.blocking);
  const compared = report.groups.some((group) => new Set(group.values.map((value) => value.source)).size >= report.minSources);
  const expectedStatus = blocked ? "blocked" : expectedIssues.length > 0 || !compared ? "advisory" : "reconciled";
  if (report.status !== expectedStatus) throw new Error("Reconciliation report status is inconsistent with its evidence.");
}
