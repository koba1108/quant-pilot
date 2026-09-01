import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildVersionedDataArtifact, sha256Canonical } from "../src/data/provenance.ts";
import {
  assertReconciliationReportIntegrity,
  reconcileComparableObservations,
  type ComparableObservation,
  type ReconciliationPolicy,
  type ReconciliationReport,
} from "../src/data/reconciliation.ts";

const policy: ReconciliationPolicy = {
  version: "synthetic-reconciliation-v1",
  mode: "required",
  minSources: 2,
  tolerances: {
    close: { warningRelative: 0.001, blockingRelative: 0.01 },
  },
};

function observation(source: string, value: number, availableAt = "2025-01-03T20:00:00Z"): ComparableObservation {
  return observationWithKey(
    source,
    value,
    { code: "A", date: "2025-01-03", field: "close", basis: "unadjusted_price", currency: "JPY" },
    availableAt,
  );
}

function observationWithKey(
  source: string,
  value: number,
  key: ComparableObservation["key"],
  availableAt = "2025-01-03T20:00:00Z",
  parentAvailableAt = availableAt,
): ComparableObservation {
  const recordId = `${source}-record`;
  const parentArtifact = buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload: [{ key, value }],
    source,
    dataset: "synthetic-bars",
    sourceVersion: "v1",
    adapterVersion: "fixture-adapter-v1",
    observedAt: "2025-01-03T16:00:00Z",
    availableAt: parentAvailableAt,
    retrievedAt: "2026-01-01T00:00:00Z",
    request: { code: key.code, date: key.date },
    recordId: `${source}-parent`,
  });
  const evidence = {
    key,
    value,
    source,
    availableAt,
    recordId,
    parentArtifactId: parentArtifact.provenance.artifactId,
    parentProvenance: parentArtifact.provenance,
  };
  return {
    ...evidence,
    artifact: buildVersionedDataArtifact({
      artifactKind: "reconciliation_observation",
      payload: evidence,
      source,
      dataset: "synthetic-bars",
      sourceVersion: "v1",
      adapterVersion: "fixture-adapter-v1",
      observedAt: "2025-01-03T16:00:00Z",
      availableAt,
      retrievedAt: "2026-01-01T00:00:00Z",
      request: { code: "A", date: key.date, field: key.field },
      recordId,
    }),
  };
}

test("cross-source reconciliation is deterministic and never selects a winner", () => {
  const inputs = [observation("source-b", 100.05), observation("source-a", 100)];
  const first = reconcileComparableObservations(inputs, "2025-01-03", policy);
  const reordered = reconcileComparableObservations([...inputs].reverse(), "2025-01-03", policy);
  assert.deepEqual(reordered, first);
  assert.equal(first.status, "reconciled");
  assert.equal(first.groups[0]!.status, "matched");
  assert.deepEqual(first.groups[0]!.values.map((value) => value.source), ["source-a", "source-b"]);
  assert.equal(first.parentArtifactIds.length, 2);
  assert.equal("selectedValue" in first.groups[0]!, false);
});

test("warning and material differences are reported against explicit policy", () => {
  const warning = reconcileComparableObservations(
    [observation("source-a", 100), observation("source-b", 100.5)],
    "2025-01-03",
    policy,
  );
  assert.equal(warning.status, "advisory");
  assert.equal(warning.groups[0]!.status, "warning");

  const blocked = reconcileComparableObservations(
    [observation("source-a", 100), observation("source-b", 102)],
    "2025-01-03",
    policy,
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.groups[0]!.status, "blocked");
  assert.ok(blocked.issues.some((item) => item.checkId === "reconciliation.material_conflict"));

  const { fingerprint: _fingerprint, ...blockedBody } = blocked;
  const forgedBody = {
    ...blockedBody,
    status: "reconciled" as const,
    groups: blockedBody.groups.map((group) => ({
      ...group,
      status: "matched" as const,
      maxAbsoluteDifference: 0,
      maxRelativeDifference: 0,
    })),
    issues: [],
  };
  const forged = { ...forgedBody, fingerprint: sha256Canonical(forgedBody) } as ReconciliationReport;
  assert.throws(
    () => assertReconciliationReportIntegrity(forged),
    /group result is inconsistent with its values and policy/,
  );
});

test("missing sources, semantic mismatches, duplicates, and future observations fail visibly", () => {
  const single = reconcileComparableObservations([observation("source-a", 100)], "2025-01-03", policy);
  assert.equal(single.status, "blocked");
  assert.equal(single.groups[0]!.status, "insufficient_sources");

  const adjusted = observationWithKey(
    "source-b",
    100,
    { code: "A", date: "2025-01-03", field: "close", basis: "provider_adjusted", currency: "JPY" },
  );
  const mismatch = reconcileComparableObservations([observation("source-a", 100), adjusted], "2025-01-03", policy);
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.groups.length, 2);
  assert.ok(mismatch.groups.every((group) => group.status === "insufficient_sources"));

  const duplicate = reconcileComparableObservations(
    [observation("source-a", 100), observation("source-a", 100), observation("source-b", 100)],
    "2025-01-03",
    policy,
  );
  assert.equal(duplicate.status, "blocked");
  assert.ok(duplicate.issues.some((item) => item.checkId === "reconciliation.duplicate_source_observation"));

  const baseline = reconcileComparableObservations(
    [observation("source-a", 100), observation("source-b", 100)],
    "2025-01-03",
    policy,
  );
  const withFuture = reconcileComparableObservations(
    [observation("source-a", 100), observation("source-b", 100), observation("source-c", 999, "2025-01-04T00:00:00Z")],
    "2025-01-03",
    policy,
  );
  assert.equal(withFuture.status, "reconciled");
  assert.deepEqual(withFuture.groups, baseline.groups);
  assert.deepEqual(withFuture.excludedObservations, { futureAvailability: 1, futureSemanticDate: 0 });
  assert.equal(withFuture.inputArtifactIds.length, 3);
});

test("future semantic dates are excluded and empty required reconciliation blocks", () => {
  const futureDate = observationWithKey(
    "source-a",
    100,
    { code: "A", date: "2025-01-04", field: "close", basis: "unadjusted_price", currency: "JPY" },
  );
  const excluded = reconcileComparableObservations([futureDate], "2025-01-03", policy);
  assert.equal(excluded.status, "blocked");
  assert.deepEqual(excluded.groups, []);
  assert.deepEqual(excluded.excludedObservations, { futureAvailability: 0, futureSemanticDate: 1 });
  assert.ok(excluded.issues.some((item) => item.checkId === "reconciliation.no_usable_observations"));

  const empty = reconcileComparableObservations([], "2025-01-03", policy);
  assert.equal(empty.status, "blocked");
  assert.ok(empty.issues.some((item) => item.checkId === "reconciliation.no_usable_observations"));
});

test("reconciliation rejects a value mutated after evidence artifact creation", () => {
  const stale = observation("source-a", 100);
  stale.value = 999;
  assert.throws(
    () => reconcileComparableObservations([stale], "2025-01-03", policy),
    /evidence payload does not match/,
  );
});

test("required policies need a blocking threshold and observation availability must match evidence", () => {
  assert.throws(() => reconcileComparableObservations([], "2025-01-03", {
    ...policy,
    tolerances: { close: {} },
  }), /must define at least one warning or blocking threshold/);

  const base = observation("source-a", 100);
  const mismatched = {
    ...base,
    artifact: buildVersionedDataArtifact({
      artifactKind: "reconciliation_observation",
      payload: {
        key: base.key,
        value: base.value,
        source: base.source,
        availableAt: base.availableAt,
        recordId: base.recordId,
        parentArtifactId: base.parentArtifactId,
        parentProvenance: base.parentProvenance,
      },
      source: base.source,
      dataset: "synthetic-bars",
      sourceVersion: "v1",
      adapterVersion: "fixture-adapter-v1",
      observedAt: "2025-01-03T16:00:00Z",
      availableAt: "2025-01-04T00:00:00Z",
      retrievedAt: "2026-01-01T00:00:00Z",
      request: { code: "A" },
      recordId: base.recordId,
    }),
  };
  assert.throws(
    () => reconcileComparableObservations([mismatched], "2025-01-03", policy),
    /availableAt does not match provenance/,
  );

  assert.throws(() => reconcileComparableObservations([], "2025-01-03", {
    ...policy,
    mode: "typo" as never,
  }), /mode must be advisory or required/);

  const missingBasis = observationWithKey(
    "source-a",
    100,
    { code: "A", date: "2025-01-03", field: "close", currency: "JPY" },
  );
  assert.throws(
    () => reconcileComparableObservations([missingBasis], "2025-01-03", policy),
    /basis is required/,
  );

  const earlierThanParent = observationWithKey(
    "source-a",
    100,
    { code: "A", date: "2025-01-03", field: "close", basis: "unadjusted_price", currency: "JPY" },
    "2025-01-03T19:00:00Z",
    "2025-01-03T20:00:00Z",
  );
  assert.throws(
    () => reconcileComparableObservations([earlierThanParent], "2025-01-03", policy),
    /cannot be available before its parent artifact/,
  );

  const invalidValues: readonly [ComparableObservation["key"], number, RegExp][] = [
    [{ code: "A", date: "2025-01-03", field: "close", basis: "unadjusted_price", currency: "JPY" }, 0, /close must be positive/],
    [{ code: "A", date: "2025-01-03", field: "fxRate", currency: "USD\/JPY", quoteConvention: "JPY_per_USD" }, -1, /fxRate must be positive/],
    [{ code: "A", date: "2025-01-03", field: "splitRatio", eventKey: "split-1" }, 0, /splitRatio must be positive/],
    [{ code: "A", date: "2025-01-03", field: "distributionAmount", currency: "JPY", eventKey: "distribution-1" }, 0, /distributionAmount must be positive/],
    [{ code: "A", date: "2025-01-03", field: "volume", unit: "shares" }, -1, /volume must be non-negative/],
    [{ code: "A", date: "2025-01-03", field: "tradingValue", currency: "JPY" }, -1, /tradingValue must be non-negative/],
    [{ code: "A", date: "2025-01-03", field: "spreadBps", unit: "bps" }, -1, /spreadBps must be non-negative/],
    [{ code: "A", date: "2025-01-03", field: "depthJpy", currency: "JPY" }, -1, /depthJpy must be non-negative/],
  ];
  for (const [key, value, expected] of invalidValues) {
    assert.throws(
      () => reconcileComparableObservations([observationWithKey("source-a", value, key)], "2025-01-03", policy),
      expected,
    );
  }
});
