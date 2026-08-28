import type { DailyBar } from "./models.ts";
import {
  assertDataArtifactProvenance,
  assertVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type DataArtifactProvenance,
  type VersionedDataArtifact,
} from "./provenance.ts";
import { assertReconciliationReportIntegrity, type ReconciliationReport } from "./reconciliation.ts";
import { compareText } from "../determinism.ts";

export const DATA_QUALITY_SCHEMA_VERSION = "data-quality-report-v1" as const;
export const DATA_QUALITY_CONTRACT_VERSION = "data-quality-contract-v1" as const;

export type DataQualitySeverity = "info" | "warning" | "error" | "critical";
export type DataQualityDisposition = "pass" | "research_only" | "blocked";
export type QualityReturnBasis = "unadjusted_price" | "provider_adjusted";

export interface DataQualityEvidence {
  artifactId: string;
  source: string;
  dataset: string;
  recordIds?: readonly string[];
}

export interface DataQualityIssue {
  checkId: string;
  severity: DataQualitySeverity;
  blocking: boolean;
  scope: "record" | "asset" | "run";
  code?: string;
  tradingDate?: string;
  field?: string;
  message: string;
  observed?: string | number | boolean | null;
  expected?: string | number | boolean | null;
  evidence: readonly DataQualityEvidence[];
}

export interface DataQualityPolicy {
  version: string;
  requiredHistoryBars: number;
  requireProvenance: boolean;
  requireVolume: boolean;
  requireTradingValue: boolean;
  requireQuoteQuality: boolean;
  reconciliationMode: "advisory" | "required";
  reconciliationPolicyVersion?: string;
  reconciliationPolicyFingerprint?: string;
}

export interface QuoteQualityEvidencePayload {
  schemaVersion: "quote-quality-evidence-v1";
  code: string;
  coverageStart: string;
  coverageEnd: string;
  observations: readonly {
    date: string;
    spreadBps?: number;
    depthJpy?: number;
  }[];
}

export interface DailyBarDataQualityInput {
  code: string;
  bars: readonly DailyBar[];
  decisionDate: string;
  requestedStart: string;
  requestedEnd: string;
  returnBasis: QualityReturnBasis;
  provenance?: DataArtifactProvenance;
  quoteQualityArtifact?: VersionedDataArtifact<QuoteQualityEvidencePayload>;
  reconciliationReport?: ReconciliationReport;
}

export interface DataQualityReport {
  schemaVersion: typeof DATA_QUALITY_SCHEMA_VERSION;
  contractVersion: typeof DATA_QUALITY_CONTRACT_VERSION;
  policyVersion: string;
  code: string;
  decisionDate: string;
  requestedStart: string;
  requestedEnd: string;
  returnBasis: QualityReturnBasis;
  dataContentHash: string;
  disposition: DataQualityDisposition;
  failClosed: boolean;
  counts: Record<DataQualitySeverity, number>;
  inputs: readonly DataArtifactProvenance[];
  reconciliationFingerprint?: string;
  checks: readonly DataQualityIssue[];
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

function decisionCutoff(value: string): number {
  if (!isIsoDate(value)) throw new Error(`Invalid data-quality decisionDate: ${value}.`);
  return Date.parse(`${value}T23:59:59.999Z`);
}

function stableObserved(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return String(value);
}

function issue(
  checkId: string,
  severity: DataQualitySeverity,
  message: string,
  details: Partial<Omit<DataQualityIssue, "checkId" | "severity" | "blocking" | "message" | "evidence">> = {},
  evidence: readonly DataQualityEvidence[] = [],
): DataQualityIssue {
  return {
    checkId,
    severity,
    blocking: severity === "error" || severity === "critical",
    scope: details.scope ?? "asset",
    code: details.code,
    tradingDate: details.tradingDate,
    field: details.field,
    message,
    observed: details.observed,
    expected: details.expected,
    evidence,
  };
}

function sortIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  return issues.sort((left, right) => compareText(left.checkId, right.checkId)
    || compareText(left.code ?? "", right.code ?? "")
    || compareText(left.tradingDate ?? "", right.tradingDate ?? "")
    || compareText(left.field ?? "", right.field ?? "")
    || compareText(left.message, right.message));
}

function validatePolicy(policy: DataQualityPolicy): void {
  if (typeof policy.version !== "string" || policy.version.trim() === "") {
    throw new Error("Data-quality policy version must be non-empty.");
  }
  if (!Number.isInteger(policy.requiredHistoryBars) || policy.requiredHistoryBars < 0) {
    throw new Error("Data-quality requiredHistoryBars must be a non-negative integer.");
  }
  for (const field of ["requireProvenance", "requireVolume", "requireTradingValue", "requireQuoteQuality"] as const) {
    if (typeof policy[field] !== "boolean") throw new Error(`Data-quality ${field} must be boolean.`);
  }
  if (policy.reconciliationMode !== "advisory" && policy.reconciliationMode !== "required") {
    throw new Error(`Data-quality reconciliationMode must be advisory or required; received ${String(policy.reconciliationMode)}.`);
  }
  if (policy.reconciliationMode === "required"
    && (typeof policy.reconciliationPolicyVersion !== "string" || policy.reconciliationPolicyVersion.trim() === "")) {
    throw new Error("Required reconciliation must name reconciliationPolicyVersion.");
  }
  if (policy.reconciliationMode === "required"
    && (typeof policy.reconciliationPolicyFingerprint !== "string"
      || !/^sha256:[0-9a-f]{64}$/.test(policy.reconciliationPolicyFingerprint))) {
    throw new Error("Required reconciliation must name a canonical reconciliationPolicyFingerprint.");
  }
}

function dispositionForCounts(counts: Record<DataQualitySeverity, number>): DataQualityDisposition {
  return counts.critical > 0 || counts.error > 0
    ? "blocked"
    : counts.warning > 0
    ? "research_only"
    : "pass";
}

export function buildDailyBarDataQualityReport(
  input: DailyBarDataQualityInput,
  policy: DataQualityPolicy,
): DataQualityReport {
  validatePolicy(policy);
  if (input.code.trim() === "") throw new Error("Data-quality code must be non-empty.");
  if (input.returnBasis !== "unadjusted_price" && input.returnBasis !== "provider_adjusted") {
    throw new Error(`Unsupported daily-bar returnBasis: ${String(input.returnBasis)}.`);
  }
  if (!isIsoDate(input.requestedStart) || !isIsoDate(input.requestedEnd) || input.requestedStart > input.requestedEnd) {
    throw new Error("Data-quality requestedStart/requestedEnd must be valid ordered ISO dates.");
  }
  if (input.requestedEnd > input.decisionDate) {
    throw new Error("Data-quality requestedEnd must not be after decisionDate.");
  }
  const cutoff = decisionCutoff(input.decisionDate);
  const sortedBars = [...input.bars].sort((left, right) => compareText(left.tradingDate, right.tradingDate));
  const dataContentHash = sha256Canonical(sortedBars.map((bar) => ({
    ...bar,
    close: stableObserved(bar.close),
    adjustedClose: stableObserved(bar.adjustedClose),
    volume: bar.volume === undefined ? undefined : stableObserved(bar.volume),
    tradingValue: bar.tradingValue === undefined ? undefined : stableObserved(bar.tradingValue),
  })));
  const inputs = [
    ...(input.provenance === undefined ? [] : [input.provenance]),
    ...(input.quoteQualityArtifact === undefined ? [] : [input.quoteQualityArtifact.provenance]),
  ];
  const evidence: DataQualityEvidence[] = inputs.map((provenance) => ({
    artifactId: provenance.artifactId,
    source: provenance.source,
    dataset: provenance.dataset,
    recordIds: provenance.recordId === undefined ? undefined : [provenance.recordId],
  }));
  const checks: DataQualityIssue[] = [];

  if (input.provenance === undefined) {
    checks.push(issue(
      "provenance.missing",
      policy.requireProvenance ? "error" : "warning",
      "No versioned source provenance was supplied; the input cannot be independently reproduced.",
      { code: input.code },
    ));
  } else {
    try {
      if (input.provenance.artifactKind !== "daily_bars") {
        throw new Error("Daily-bar provenance must have artifactKind=daily_bars.");
      }
      assertVersionedDataArtifact({ payload: sortedBars, provenance: input.provenance });
      if (Date.parse(input.provenance.availableAt) > cutoff) {
        checks.push(issue(
          "provenance.future_availability",
          "critical",
          "The data artifact was not available by the decision date.",
          { code: input.code, observed: input.provenance.availableAt, expected: input.decisionDate },
          evidence,
        ));
      }
    } catch (error) {
      checks.push(issue(
        "provenance.invalid",
        "critical",
        error instanceof Error ? error.message : "Invalid data provenance.",
        { code: input.code },
        evidence,
      ));
    }
  }

  if (input.quoteQualityArtifact !== undefined) {
    try {
      if (input.quoteQualityArtifact.provenance.artifactKind !== "quote_quality") {
        throw new Error("Quote-quality evidence must have artifactKind=quote_quality.");
      }
      assertVersionedDataArtifact(input.quoteQualityArtifact);
      const quotePayload = input.quoteQualityArtifact.payload;
      if (quotePayload.schemaVersion !== "quote-quality-evidence-v1"
        || quotePayload.code !== input.code
        || !Array.isArray(quotePayload.observations)
        || quotePayload.observations.length === 0) {
        throw new Error("Quote-quality evidence must contain non-empty observations for the requested code.");
      }
      if (!isIsoDate(quotePayload.coverageStart) || !isIsoDate(quotePayload.coverageEnd)
        || quotePayload.coverageStart > quotePayload.coverageEnd
        || quotePayload.coverageStart > input.requestedStart
        || quotePayload.coverageEnd < input.requestedEnd
        || quotePayload.coverageEnd > input.decisionDate) {
        throw new Error("Quote-quality evidence coverage must span the requested range and end by the decision date.");
      }
      let observationWithinRequestedRange = false;
      for (const observation of quotePayload.observations) {
        if (!isIsoDate(observation.date)
          || observation.date < quotePayload.coverageStart
          || observation.date > quotePayload.coverageEnd
          || observation.date > input.decisionDate) {
          throw new Error("Quote-quality evidence contains an invalid or future observation date.");
        }
        if (observation.date >= input.requestedStart && observation.date <= input.requestedEnd) {
          observationWithinRequestedRange = true;
        }
        if (observation.spreadBps === undefined && observation.depthJpy === undefined) {
          throw new Error("Quote-quality evidence must contain spreadBps or depthJpy.");
        }
        for (const value of [observation.spreadBps, observation.depthJpy]) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            throw new Error("Quote-quality evidence contains an invalid numeric value.");
          }
        }
      }
      if (!observationWithinRequestedRange) {
        throw new Error("Quote-quality evidence has no observation inside the requested range.");
      }
      if (Date.parse(input.quoteQualityArtifact.provenance.availableAt) > cutoff) {
        throw new Error("Quote-quality evidence was not available by the decision date.");
      }
    } catch (error) {
      checks.push(issue(
        "quote_quality.invalid",
        "critical",
        error instanceof Error ? error.message : "Invalid quote-quality artifact.",
        { code: input.code },
        evidence,
      ));
    }
  }

  if (input.bars.length === 0) {
    checks.push(issue("bars.empty", "critical", "No daily bars were supplied.", { code: input.code }, evidence));
  }
  if (input.bars.length < policy.requiredHistoryBars) {
    checks.push(issue(
      "bars.insufficient_history",
      "error",
      "The series does not meet the explicitly configured history requirement.",
      { code: input.code, observed: input.bars.length, expected: policy.requiredHistoryBars },
      evidence,
    ));
  }

  const seenDates = new Set<string>();
  let missingVolume = 0;
  let missingTradingValue = 0;
  for (const bar of sortedBars) {
    if (bar.code !== input.code) {
      checks.push(issue(
        "bars.wrong_code",
        "critical",
        "A daily bar belongs to a different code.",
        { scope: "record", code: input.code, tradingDate: bar.tradingDate, observed: bar.code, expected: input.code },
        evidence,
      ));
    }
    if (!isIsoDate(bar.tradingDate)) {
      checks.push(issue(
        "bars.invalid_date",
        "critical",
        "A daily bar has an invalid trading date.",
        { scope: "record", code: input.code, observed: bar.tradingDate },
        evidence,
      ));
    } else {
      if (seenDates.has(bar.tradingDate)) {
        checks.push(issue(
          "bars.duplicate_date",
          "critical",
          "Multiple daily bars share the same trading date.",
          { scope: "record", code: input.code, tradingDate: bar.tradingDate },
          evidence,
        ));
      }
      seenDates.add(bar.tradingDate);
      if (bar.tradingDate < input.requestedStart || bar.tradingDate > input.requestedEnd) {
        checks.push(issue(
          "bars.outside_request",
          "critical",
          "A used daily bar falls outside the requested range.",
          { scope: "record", code: input.code, tradingDate: bar.tradingDate },
          evidence,
        ));
      }
      if (Date.parse(`${bar.tradingDate}T23:59:59.999Z`) > cutoff) {
        checks.push(issue(
          "bars.future_date",
          "critical",
          "A used daily bar is after the decision date.",
          { scope: "record", code: input.code, tradingDate: bar.tradingDate, expected: input.decisionDate },
          evidence,
        ));
      }
    }
    for (const [field, value] of [["close", bar.close], ["adjustedClose", bar.adjustedClose]] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        checks.push(issue(
          `bars.invalid_${field}`,
          "critical",
          `A daily bar has an invalid ${field}.`,
          { scope: "record", code: input.code, tradingDate: bar.tradingDate, field, observed: stableObserved(value) },
          evidence,
        ));
      }
    }
    if (bar.volume === undefined) missingVolume++;
    else if (!Number.isFinite(bar.volume) || bar.volume < 0) {
      checks.push(issue(
        "bars.invalid_volume",
        "critical",
        "A daily bar has invalid volume.",
        { scope: "record", code: input.code, tradingDate: bar.tradingDate, field: "volume", observed: stableObserved(bar.volume) },
        evidence,
      ));
    }
    if (bar.tradingValue === undefined) missingTradingValue++;
    else if (!Number.isFinite(bar.tradingValue) || bar.tradingValue < 0) {
      checks.push(issue(
        "bars.invalid_trading_value",
        "critical",
        "A daily bar has invalid trading value.",
        { scope: "record", code: input.code, tradingDate: bar.tradingDate, field: "tradingValue", observed: stableObserved(bar.tradingValue) },
        evidence,
      ));
    }
  }

  if (missingVolume > 0) {
    checks.push(issue(
      "bars.missing_volume",
      policy.requireVolume ? "error" : "warning",
      "Volume is unavailable for part of the series and was not replaced with zero.",
      { code: input.code, observed: missingVolume, expected: 0 },
      evidence,
    ));
  }
  if (missingTradingValue > 0) {
    checks.push(issue(
      "bars.missing_trading_value",
      policy.requireTradingValue ? "error" : "warning",
      "Trading value is unavailable for part of the series and was not replaced with zero.",
      { code: input.code, observed: missingTradingValue, expected: 0 },
      evidence,
    ));
  }
  if (policy.requireQuoteQuality && input.quoteQualityArtifact === undefined) {
    checks.push(issue(
      "quote_quality.missing",
      "error",
      "The configured policy requires quote-quality observations.",
      { code: input.code },
      evidence,
    ));
  }

  if (input.returnBasis === "unadjusted_price") {
    checks.push(issue(
      "return_basis.unadjusted_price",
      "warning",
      "Corporate Actions and distributions are not normalized; results are research plumbing only.",
      { code: input.code },
      evidence,
    ));
  } else if (input.returnBasis === "provider_adjusted") {
    checks.push(issue(
      "return_basis.provider_adjusted",
      "warning",
      "Provider adjustment semantics and Point-in-Time safety are unverified.",
      { code: input.code },
      evidence,
    ));
  }

  let reconciliationFingerprint: string | undefined;
  if (input.reconciliationReport === undefined) {
    checks.push(issue(
      "reconciliation.not_performed",
      policy.reconciliationMode === "required" ? "error" : "warning",
      "No cross-source reconciliation was performed.",
      { code: input.code },
      evidence,
    ));
  } else {
    const report = input.reconciliationReport;
    reconciliationFingerprint = report.fingerprint;
    let integrityError: string | undefined;
    try {
      assertReconciliationReportIntegrity(report);
    } catch (error) {
      integrityError = error instanceof Error ? error.message : "Invalid reconciliation report.";
    }
    const coversInput = input.provenance !== undefined
      && report.parentArtifactIds.includes(input.provenance.artifactId);
    const expectedPriceField = input.returnBasis === "unadjusted_price" ? "close" : "adjustedClose";
    const hasRelevantMatchedPriceGroup = report.groups.some((group) => group.key.code === input.code
      && group.key.date >= input.requestedStart
      && group.key.date <= input.requestedEnd
      && group.key.date <= input.decisionDate
      && group.key.field === expectedPriceField
      && group.key.basis === input.returnBasis
      && group.values.length >= report.minSources
      && group.status === "matched"
      && input.provenance !== undefined
      && group.values.some((value) => value.parentArtifactId === input.provenance!.artifactId));
    if (integrityError !== undefined || report.decisionDate !== input.decisionDate || !coversInput) {
      checks.push(issue(
        "reconciliation.invalid_evidence",
        "critical",
        integrityError ?? "The reconciliation report decision date or parent-artifact lineage does not match this quality report.",
        { code: input.code },
        evidence,
      ));
    } else if (policy.reconciliationMode === "required"
      && (report.status !== "reconciled"
        || report.mode !== "required"
        || report.policyVersion !== policy.reconciliationPolicyVersion
        || report.policyFingerprint !== policy.reconciliationPolicyFingerprint
        || !hasRelevantMatchedPriceGroup)) {
      checks.push(issue(
        "reconciliation.required_not_satisfied",
        "error",
        "Required reconciliation lacks a matching policy version and at least one successfully compared group.",
        { code: input.code },
        evidence,
      ));
    } else if (report.status === "blocked") {
      checks.push(issue(
        "reconciliation.blocked",
        "critical",
        "Cross-source reconciliation found a blocking conflict.",
        { code: input.code },
        evidence,
      ));
    } else if (report.status === "advisory") {
      checks.push(issue(
        "reconciliation.advisory",
        "warning",
        "Cross-source evidence is advisory and does not establish final data quality.",
        { code: input.code },
        evidence,
      ));
    }
  }

  sortIssues(checks);
  const counts: Record<DataQualitySeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const check of checks) counts[check.severity]++;
  const disposition = dispositionForCounts(counts);
  const reportWithoutFingerprint = {
    schemaVersion: DATA_QUALITY_SCHEMA_VERSION,
    contractVersion: DATA_QUALITY_CONTRACT_VERSION,
    policyVersion: policy.version,
    code: input.code,
    decisionDate: input.decisionDate,
    requestedStart: input.requestedStart,
    requestedEnd: input.requestedEnd,
    returnBasis: input.returnBasis,
    dataContentHash,
    disposition,
    failClosed: disposition === "blocked",
    counts,
    inputs: [...inputs].sort((left, right) => compareText(left.artifactId, right.artifactId)),
    reconciliationFingerprint,
    checks,
  };
  return { ...reportWithoutFingerprint, fingerprint: sha256Canonical(reportWithoutFingerprint) };
}

export function assertDataQualityUsable(report: DataQualityReport, mode: "research" | "forward"): void {
  if (mode !== "research" && mode !== "forward") {
    throw new Error(`Data-quality use mode must be research or forward; received ${String(mode)}.`);
  }
  if (report.schemaVersion !== DATA_QUALITY_SCHEMA_VERSION || report.contractVersion !== DATA_QUALITY_CONTRACT_VERSION) {
    throw new Error("Unsupported data-quality report schema or contract version.");
  }
  const { fingerprint, ...reportBody } = report;
  if (sha256Canonical(reportBody) !== fingerprint) {
    throw new Error(`Data-quality report fingerprint is invalid for ${report.code}.`);
  }
  if (report.returnBasis !== "unadjusted_price" && report.returnBasis !== "provider_adjusted") {
    throw new Error(`Unsupported data-quality report returnBasis for ${report.code}: ${String(report.returnBasis)}.`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(report.dataContentHash)) {
    throw new Error(`Data-quality report dataContentHash is invalid for ${report.code}.`);
  }
  if (!isIsoDate(report.decisionDate) || !isIsoDate(report.requestedStart) || !isIsoDate(report.requestedEnd)
    || report.requestedStart > report.requestedEnd || report.requestedEnd > report.decisionDate) {
    throw new Error(`Data-quality report date scope is invalid for ${report.code}.`);
  }
  for (const provenance of report.inputs) assertDataArtifactProvenance(provenance);
  const counts: Record<DataQualitySeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const check of report.checks) {
    counts[check.severity]++;
    if (check.blocking !== (check.severity === "error" || check.severity === "critical")) {
      throw new Error(`Data-quality report contains inconsistent blocking severity for ${report.code}.`);
    }
  }
  if (canonicalJson(counts) !== canonicalJson(report.counts)
    || dispositionForCounts(counts) !== report.disposition
    || report.failClosed !== (report.disposition === "blocked")) {
    throw new Error(`Data-quality report contains inconsistent counts or disposition for ${report.code}.`);
  }
  const expectedBasisCheck = report.returnBasis === "unadjusted_price"
    ? "return_basis.unadjusted_price"
    : "return_basis.provider_adjusted";
  if (!report.checks.some((check) => check.checkId === expectedBasisCheck
    && check.severity === "warning" && check.blocking === false)) {
    throw new Error(`Data-quality report lacks the required basis limitation for ${report.code}.`);
  }
  if (report.disposition === "blocked") {
    throw new Error(`Data quality is blocked for ${report.code}; report ${report.fingerprint}.`);
  }
  if (mode === "forward" && report.disposition !== "pass") {
    throw new Error(`Forward use requires a passing data-quality report for ${report.code}.`);
  }
}
