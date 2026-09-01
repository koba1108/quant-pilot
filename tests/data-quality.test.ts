import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  assertDataQualityUsable,
  buildDailyBarDataQualityReport,
  type DataQualityPolicy,
} from "../src/data/data-quality.ts";
import {
  assertDataArtifactProvenance,
  buildVersionedDataArtifact,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../src/data/provenance.ts";
import {
  reconcileComparableObservations,
  type ComparableObservation,
} from "../src/data/reconciliation.ts";
import type { DailyBar } from "../src/data/models.ts";

const bars: DailyBar[] = [
  { code: "A", tradingDate: "2025-01-01", close: 100, adjustedClose: 100, volume: 10, tradingValue: 1000 },
  { code: "A", tradingDate: "2025-01-02", close: 101, adjustedClose: 101, volume: 11, tradingValue: 1111 },
  { code: "A", tradingDate: "2025-01-03", close: 102, adjustedClose: 102, volume: 12, tradingValue: 1224 },
];

const policy: DataQualityPolicy = {
  version: "synthetic-quality-v1",
  requiredHistoryBars: 3,
  requireProvenance: true,
  requireVolume: false,
  requireTradingValue: false,
  requireQuoteQuality: false,
  reconciliationMode: "advisory",
};

function artifact(availableAt = "2025-01-03T20:00:00Z", source = "synthetic-source") {
  return buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload: bars,
    source,
    dataset: "synthetic-bars",
    sourceVersion: "v1",
    adapterVersion: "fixture-adapter-v1",
    observedAt: "2025-01-03T16:00:00Z",
    availableAt,
    retrievedAt: "2026-01-01T00:00:00Z",
    request: { code: "A", start: "2025-01-01", end: "2025-01-03" },
  });
}

function comparableObservation(
  parent: VersionedDataArtifact<DailyBar[]>,
  source: string,
  value: number,
  code = "A",
  field: "close" | "adjustedClose" = "close",
  basis: "unadjusted_price" | "provider_adjusted" = "unadjusted_price",
): ComparableObservation {
  const recordId = `${source}-${field}-2025-01-03`;
  const evidence = {
    key: {
      code,
      date: "2025-01-03",
      field,
      basis,
      currency: "JPY",
    },
    value,
    source,
    availableAt: "2025-01-03T20:00:00Z",
    recordId,
    parentArtifactId: parent.provenance.artifactId,
    parentProvenance: parent.provenance,
  };
  return {
    ...evidence,
    artifact: buildVersionedDataArtifact({
      artifactKind: "reconciliation_observation",
      payload: evidence,
      source,
      dataset: "synthetic-bars-observation",
      sourceVersion: "v1",
      adapterVersion: "fixture-adapter-v1",
      observedAt: "2025-01-03T16:00:00Z",
      availableAt: evidence.availableAt,
      retrievedAt: "2026-01-01T00:00:00Z",
      request: { code, date: evidence.key.date, field: evidence.key.field },
      recordId,
    }),
  };
}

test("complete versioned daily bars remain research-only until normalization and reconciliation are proven", () => {
  const input = {
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted" as const,
    provenance: artifact().provenance,
  };
  const first = buildDailyBarDataQualityReport(input, policy);
  const second = buildDailyBarDataQualityReport(input, policy);
  assert.deepEqual(second, first);
  assert.equal(first.disposition, "research_only");
  assert.match(first.dataContentHash, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => assertDataQualityUsable(first, "forward"), /requires a passing/);
});

test("missing optional values remain visible and raw return basis stays research-only", () => {
  const incomplete = bars.map((bar) => ({ ...bar, volume: undefined, tradingValue: undefined }));
  const report = buildDailyBarDataQualityReport({
    code: "A",
    bars: incomplete,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "unadjusted_price",
  }, { ...policy, requireProvenance: false });

  assert.equal(report.disposition, "research_only");
  assert.ok(report.checks.some((check) => check.checkId === "bars.missing_volume" && check.observed === 3));
  assert.ok(report.checks.some((check) => check.checkId === "bars.missing_trading_value" && check.observed === 3));
  assert.throws(() => assertDataQualityUsable(report, "forward"), /requires a passing/);
  assert.doesNotThrow(() => assertDataQualityUsable(report, "research"));
});

test("invalid, duplicate, future, and unavailable inputs fail closed", () => {
  const invalidBars: DailyBar[] = [
    ...bars,
    { ...bars[0]!, close: Number.NaN },
    { ...bars[0]!, code: "B", tradingDate: "2025-01-04" },
  ];
  const invalid = buildDailyBarDataQualityReport({
    code: "A",
    bars: invalidBars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "unadjusted_price",
  }, { ...policy, requireProvenance: false });
  assert.equal(invalid.disposition, "blocked");
  assert.ok(invalid.checks.some((check) => check.checkId === "bars.duplicate_date"));
  assert.ok(invalid.checks.some((check) => check.checkId === "bars.invalid_close"));
  assert.ok(invalid.checks.some((check) => check.checkId === "bars.future_date"));
  assert.ok(invalid.checks.some((check) => check.checkId === "bars.wrong_code"));

  const unavailable = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    provenance: artifact("2025-01-04T00:00:00Z").provenance,
  }, policy);
  assert.equal(unavailable.disposition, "blocked");
  assert.ok(unavailable.checks.some((check) => check.checkId === "provenance.future_availability"));
});

test("quality fingerprint does not depend on daily-bar input ordering", () => {
  const baseInput = {
    code: "A",
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted" as const,
  };
  const first = buildDailyBarDataQualityReport({ ...baseInput, bars }, { ...policy, requireProvenance: false });
  const reordered = buildDailyBarDataQualityReport(
    { ...baseInput, bars: [...bars].reverse() },
    { ...policy, requireProvenance: false },
  );
  assert.deepEqual(reordered, first);
});

test("quality report rejects mutated bars reused with stale provenance", () => {
  const versioned = artifact();
  const mutated = bars.map((bar, index) => index === 1 ? { ...bar, close: 999 } : bar);
  const report = buildDailyBarDataQualityReport({
    code: "A",
    bars: mutated,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    provenance: versioned.provenance,
  }, policy);

  assert.equal(report.disposition, "blocked");
  assert.ok(report.checks.some((check) => check.checkId === "provenance.invalid"
    && check.message.includes("contentHash")));
});

test("artifact timestamps reject calendar rollover instead of relying on Date.parse normalization", () => {
  assert.throws(() => buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload: bars,
    source: "synthetic-source",
    dataset: "synthetic-bars",
    sourceVersion: "v1",
    adapterVersion: "fixture-adapter-v1",
    observedAt: "2025-02-30T16:00:00Z",
    availableAt: "2025-03-01T20:00:00Z",
    retrievedAt: "2026-01-01T00:00:00Z",
    request: { code: "A" },
  }), /observedAt must be an ISO timestamp/);
});

test("runtime basis, report integrity, and required reconciliation fail closed", () => {
  assert.throws(() => buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "total_return" as never,
  }, { ...policy, requireProvenance: false }), /Unsupported daily-bar returnBasis/);

  assert.throws(() => buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-02",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
  }, { ...policy, requireProvenance: false }), /requestedEnd must not be after decisionDate/);

  const valid = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
  }, { ...policy, requireProvenance: false });
  const tampered = { ...valid, disposition: "pass" as const };
  assert.throws(() => assertDataQualityUsable(tampered, "forward"), /fingerprint is invalid/);

  const emptyAdvisory = reconcileComparableObservations([], "2025-01-03", {
    version: "required-source-comparison-v1",
    mode: "advisory",
    minSources: 2,
    tolerances: { close: { warningRelative: .001, blockingRelative: .01 } },
  });
  const required = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    reconciliationReport: emptyAdvisory,
  }, {
    ...policy,
    requireProvenance: false,
    reconciliationMode: "required",
    reconciliationPolicyVersion: "required-source-comparison-v1",
    reconciliationPolicyFingerprint: emptyAdvisory.policyFingerprint,
  });
  assert.equal(required.disposition, "blocked");
  assert.ok(required.checks.some((check) => check.checkId === "reconciliation.invalid_evidence"));

  assert.throws(() => buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
  }, { ...policy, requireProvenance: false, reconciliationMode: "typo" as never }), /must be advisory or required/);

  const { fingerprint: _fingerprint, ...validBody } = valid;
  const forgedBody = {
    ...validBody,
    returnBasis: "total_return" as never,
    disposition: "pass" as const,
    failClosed: false,
    counts: { info: 0, warning: 0, error: 0, critical: 0 },
    checks: [],
  };
  const forged = { ...forgedBody, fingerprint: sha256Canonical(forgedBody) };
  assert.throws(() => assertDataQualityUsable(forged, "forward"), /Unsupported data-quality report returnBasis/);
  assert.throws(() => assertDataQualityUsable(valid, "typo" as never), /use mode must be research or forward/);
});

test("required reconciliation binds matched price evidence to the input artifact and requested scope", () => {
  const parentA = artifact("2025-01-03T20:00:00Z", "source-a");
  const parentB = artifact("2025-01-03T20:00:00Z", "source-b");
  const reconciliationPolicy = {
    version: "required-source-comparison-v1",
    mode: "required" as const,
    minSources: 2,
    tolerances: { close: { warningRelative: .001, blockingRelative: .01 } },
  };
  const matched = reconcileComparableObservations([
    comparableObservation(parentA, "source-a", 102),
    comparableObservation(parentB, "source-b", 102.01),
  ], "2025-01-03", reconciliationPolicy);
  const accepted = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "unadjusted_price",
    provenance: parentA.provenance,
    reconciliationReport: matched,
  }, {
    ...policy,
    reconciliationMode: "required",
    reconciliationPolicyVersion: reconciliationPolicy.version,
    reconciliationPolicyFingerprint: sha256Canonical(reconciliationPolicy),
  });
  assert.equal(accepted.disposition, "research_only");
  assert.equal(accepted.checks.some((check) => check.checkId.startsWith("reconciliation.")), false);

  const wrongBasis = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    provenance: parentA.provenance,
    reconciliationReport: matched,
  }, {
    ...policy,
    reconciliationMode: "required",
    reconciliationPolicyVersion: reconciliationPolicy.version,
    reconciliationPolicyFingerprint: sha256Canonical(reconciliationPolicy),
  });
  assert.equal(wrongBasis.disposition, "blocked");
  assert.ok(wrongBasis.checks.some((check) => check.checkId === "reconciliation.required_not_satisfied"));

  const wrongCode = reconcileComparableObservations([
    comparableObservation(parentA, "source-a", 102, "B"),
    comparableObservation(parentB, "source-b", 102.01, "B"),
  ], "2025-01-03", reconciliationPolicy);
  const rejected = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    provenance: parentA.provenance,
    reconciliationReport: wrongCode,
  }, {
    ...policy,
    reconciliationMode: "required",
    reconciliationPolicyVersion: reconciliationPolicy.version,
    reconciliationPolicyFingerprint: sha256Canonical(reconciliationPolicy),
  });
  assert.equal(rejected.disposition, "blocked");
  assert.ok(rejected.checks.some((check) => check.checkId === "reconciliation.required_not_satisfied"));

  const parentC = artifact("2025-01-03T20:00:00Z", "source-c");
  const parentD = artifact("2025-01-03T20:00:00Z", "source-d");
  const globallyCoveredOnly = reconcileComparableObservations([
    comparableObservation(parentB, "source-b", 102),
    comparableObservation(parentC, "source-c", 102.01),
    comparableObservation(parentA, "source-a", 50, "B"),
    comparableObservation(parentD, "source-d", 50.001, "B"),
  ], "2025-01-03", reconciliationPolicy);
  assert.equal(globallyCoveredOnly.status, "reconciled");
  const wrongParentGroup = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "unadjusted_price",
    provenance: parentA.provenance,
    reconciliationReport: globallyCoveredOnly,
  }, {
    ...policy,
    reconciliationMode: "required",
    reconciliationPolicyVersion: reconciliationPolicy.version,
    reconciliationPolicyFingerprint: sha256Canonical(reconciliationPolicy),
  });
  assert.equal(wrongParentGroup.disposition, "blocked");
  assert.ok(wrongParentGroup.checks.some((check) => check.checkId === "reconciliation.required_not_satisfied"));
});

test("required quote quality needs a non-empty typed evidence payload", () => {
  const quoteQualityArtifact = buildVersionedDataArtifact({
    artifactKind: "quote_quality",
    payload: {
      schemaVersion: "quote-quality-evidence-v1" as const,
      code: "A",
      coverageStart: "2025-01-01",
      coverageEnd: "2025-01-03",
      observations: [],
    },
    source: "synthetic-source",
    dataset: "synthetic-quotes",
    sourceVersion: "v1",
    adapterVersion: "fixture-adapter-v1",
    observedAt: "2025-01-03T16:00:00Z",
    availableAt: "2025-01-03T20:00:00Z",
    retrievedAt: "2026-01-01T00:00:00Z",
    request: { code: "A" },
  });
  const report = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    quoteQualityArtifact,
  }, { ...policy, requireProvenance: false, requireQuoteQuality: true });
  assert.equal(report.disposition, "blocked");
  assert.ok(report.checks.some((check) => check.checkId === "quote_quality.invalid"));

  const staleQuoteQuality = buildVersionedDataArtifact({
    artifactKind: "quote_quality",
    payload: {
      schemaVersion: "quote-quality-evidence-v1" as const,
      code: "A",
      coverageStart: "2020-01-01",
      coverageEnd: "2020-01-31",
      observations: [{ date: "2020-01-15", spreadBps: 10 }],
    },
    source: "synthetic-source",
    dataset: "synthetic-quotes",
    sourceVersion: "v1",
    adapterVersion: "fixture-adapter-v1",
    observedAt: "2025-01-03T16:00:00Z",
    availableAt: "2025-01-03T20:00:00Z",
    retrievedAt: "2026-01-01T00:00:00Z",
    request: { code: "A" },
  });
  const staleReport = buildDailyBarDataQualityReport({
    code: "A",
    bars,
    decisionDate: "2025-01-03",
    requestedStart: "2025-01-01",
    requestedEnd: "2025-01-03",
    returnBasis: "provider_adjusted",
    quoteQualityArtifact: staleQuoteQuality,
  }, { ...policy, requireProvenance: false, requireQuoteQuality: true });
  assert.equal(staleReport.disposition, "blocked");
  assert.ok(staleReport.checks.some((check) => check.checkId === "quote_quality.invalid"
    && check.message.includes("coverage")));
});

test("artifact provenance requires sourceVersion and canonical supersession IDs at runtime", () => {
  const valid = artifact().provenance;
  const missingVersion = { ...valid } as Record<string, unknown>;
  delete missingVersion.sourceVersion;
  assert.throws(
    () => assertDataArtifactProvenance(missingVersion as never),
    /sourceVersion must be a non-empty string/,
  );
  assert.throws(
    () => assertDataArtifactProvenance({ ...valid, artifactKind: "arbitrary_kind" } as never),
    /Unsupported provenance artifactKind/,
  );
  assert.throws(() => buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload: bars,
    source: "synthetic-source",
    dataset: "synthetic-bars",
    sourceVersion: "v2",
    adapterVersion: "fixture-adapter-v1",
    observedAt: "2025-01-03T16:00:00Z",
    availableAt: "2025-01-03T20:00:00Z",
    retrievedAt: "2026-01-01T00:00:00Z",
    request: { code: "A" },
    supersedesArtifactId: "not-a-hash",
  }), /supersedesArtifactId must be a canonical SHA-256/);
});
