import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  assertPointInTimeReturnResolutionIntegrity,
  resolvePointInTimeReturn,
  validatePointInTimeReturnSourceAsset,
  type PointInTimeBarObservation,
  type PointInTimeReturnAsset,
} from "../src/data/point-in-time-return-source.ts";
import type { DataProvenance } from "../src/data/return-normalization.ts";

const provenance: DataProvenance = {
  source: "synthetic",
  dataset: "pit-bars",
  retrievedAt: "2025-02-01T00:00:00Z",
  sourceVersion: "v1",
};

function bar(
  date: string,
  close: number,
  observationId = `bar-${date}`,
  availableAt = `${date}T01:00:00Z`,
): PointInTimeBarObservation {
  return {
    code: "ETF",
    tradingDate: date,
    close,
    adjustedClose: close,
    volume: 100,
    tradingValue: close * 100,
    observationId,
    observedAt: `${date}T00:00:00Z`,
    availableAt,
    provenance: structuredClone(provenance),
  };
}

function coverage(availableAt = "2025-01-01T00:00:00Z") {
  return {
    code: "ETF",
    startDate: "2025-01-02",
    endDate: "2025-01-08",
    corporateActions: "complete" as const,
    distributions: "complete" as const,
    availableAt,
    provenance: structuredClone(provenance),
  };
}

function jpyAsset(overrides: Partial<PointInTimeReturnAsset> = {}): PointInTimeReturnAsset {
  return {
    code: "ETF",
    currency: "JPY",
    basis: "price_return",
    barObservations: [
      bar("2025-01-02", 100),
      bar("2025-01-03", 50, "bar-2025-01-03-old"),
      {
        ...bar("2025-01-03", 60, "bar-2025-01-03-revision", "2025-01-05T01:00:00Z"),
        supersedesObservationId: "bar-2025-01-03-old",
      },
      bar("2025-01-06", 55),
      bar("2025-01-07", 500),
    ],
    events: [],
    coverage: coverage(),
    ...overrides,
  };
}

function fxObservation(
  date: string,
  rate: number,
  observationId = `fx-${date}`,
  availableAt = `${date}T02:00:00Z`,
  supersedesObservationId?: string,
) {
  return {
    observationId,
    rateDate: date,
    sourceCurrency: "USD",
    targetCurrency: "JPY",
    quoteConvention: "target_currency_per_source_currency" as const,
    targetCurrencyPerSourceUnit: rate,
    observedAt: `${date}T01:00:00Z`,
    availableAt,
    supersedesObservationId,
    provenance: structuredClone(provenance),
  };
}

function usdAsset(): PointInTimeReturnAsset {
  return {
    code: "ETF",
    currency: "USD",
    basis: "price_return",
    barObservations: [bar("2025-01-02", 100), bar("2025-01-03", 102), bar("2025-01-06", 101)],
    events: [],
    coverage: coverage("2025-01-01T00:00:00Z"),
    fxObservations: [
      fxObservation("2025-01-02", 150),
      fxObservation("2025-01-03", 151),
      fxObservation("2025-01-06", 149),
    ],
    fxCoverage: {
      sourceCurrency: "USD",
      targetCurrency: "JPY",
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      status: "complete",
      availableAt: "2025-01-01T00:00:00Z",
      provenance: structuredClone(provenance),
    },
  };
}

test("bar revisions select the latest available observation without changing prior snapshots", () => {
  const asset = jpyAsset();
  const before = resolvePointInTimeReturn(asset, "2025-01-04");
  const after = resolvePointInTimeReturn(asset, "2025-01-06");
  const pinnedForward = resolvePointInTimeReturn(asset, "2025-01-06", before);

  assert.deepEqual(before.appliedBarObservationIds, ["bar-2025-01-02", "bar-2025-01-03-old"]);
  assert.deepEqual(after.appliedBarObservationIds, ["bar-2025-01-02", "bar-2025-01-03-revision", "bar-2025-01-06"]);
  assert.equal(before.diagnostics.revisedBarDatesUsed, 0);
  assert.equal(after.diagnostics.revisedBarDatesUsed, 1);
  assert.equal(before.bars[1]!.close, 50);
  assert.equal(after.bars[1]!.close, 60);
  assert.deepEqual(
    pinnedForward.appliedBarObservationIds,
    ["bar-2025-01-02", "bar-2025-01-03-old", "bar-2025-01-06"],
  );
  assert.deepEqual(pinnedForward.bars.slice(0, before.bars.length), before.bars);
  assert.equal(pinnedForward.pinnedPrefixFingerprint, before.fingerprint);

  const changedFuture = jpyAsset();
  changedFuture.barObservations[4]!.close = 999_999;
  const unchanged = resolvePointInTimeReturn(changedFuture, "2025-01-04");
  assert.deepEqual(unchanged.bars, before.bars);
  assert.deepEqual(unchanged.appliedBarObservationIds, before.appliedBarObservationIds);
});

test("normalized output records policy metadata and detects post-resolution mutation", () => {
  const asset = jpyAsset({
    basis: "total_return",
    totalReturnPolicyId: "research-total-return-d018-v1",
    totalReturnPolicy: { distributionRecognition: "ex_date", reinvestment: "same_day_close" },
    events: [{
      type: "cash_distribution",
      eventId: "distribution-1",
      code: "ETF",
      exDate: "2025-01-03",
      amountPerUnit: 1,
      currency: "JPY",
      availableAt: "2025-01-02T00:00:00Z",
      provenance: structuredClone(provenance),
    }, {
      type: "cash_distribution",
      eventId: "future-distribution",
      code: "ETF",
      exDate: "2025-01-06",
      amountPerUnit: 999_999,
      currency: "JPY",
      availableAt: "2025-01-02T00:00:00Z",
      provenance: structuredClone(provenance),
    }],
  });
  const resolution = resolvePointInTimeReturn(asset, "2025-01-04");
  assert.equal(resolution.normalization.returnNormalizationVersion, "return-normalization-v1");
  assert.equal(resolution.normalization.totalReturnPolicyId, "research-total-return-d018-v1");
  assert.deepEqual(resolution.appliedEventIds, ["distribution-1"]);
  assert.match(resolution.inputFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(resolution.fingerprint, /^sha256:[0-9a-f]{64}$/);

  const changedFuture = structuredClone(asset);
  const future = changedFuture.events[1];
  assert.equal(future?.type, "cash_distribution");
  if (future?.type === "cash_distribution") future.amountPerUnit = 1;
  const unchanged = resolvePointInTimeReturn(changedFuture, "2025-01-04");
  assert.deepEqual(unchanged.bars, resolution.bars);
  assert.deepEqual(unchanged.appliedEventIds, resolution.appliedEventIds);

  resolution.bars[0]!.close += 1;
  assert.throws(() => assertPointInTimeReturnResolutionIntegrity(resolution), /fingerprint is invalid/);
});

test("non-JPY resolution compounds exact-date FX and exposes FX observation IDs", () => {
  const resolution = resolvePointInTimeReturn(usdAsset(), "2025-01-06");
  assert.equal(resolution.currency, "JPY");
  assert.equal(resolution.sourceCurrency, "USD");
  assert.equal(resolution.normalization.fxContractId, "point-in-time-jpy-fx-d006-v1");
  assert.deepEqual(resolution.appliedFxObservationIds, ["fx-2025-01-02", "fx-2025-01-03", "fx-2025-01-06"]);
  assert.ok(Math.abs(resolution.bars.at(-1)!.close - 100.32666666666667) < 1e-10);
  assert.equal(resolution.bars.at(-1)!.tradingValue, 101 * 100 * 149);
});

test("FX corrections become visible only after availability and future changes do not alter prior bars", () => {
  const asset = usdAsset();
  asset.fxObservations = [asset.fxObservations![0]!, fxObservation(
    "2025-01-03",
    151.5,
    "fx-2025-01-03-revision",
    "2025-01-05T03:00:00Z",
    "fx-2025-01-03",
  ), ...asset.fxObservations!.slice(1)];
  const before = resolvePointInTimeReturn(asset, "2025-01-04");
  const after = resolvePointInTimeReturn(asset, "2025-01-06");
  const pinnedForward = resolvePointInTimeReturn(asset, "2025-01-06", before);
  assert.deepEqual(before.appliedFxObservationIds, ["fx-2025-01-02", "fx-2025-01-03"]);
  assert.deepEqual(after.appliedFxObservationIds, ["fx-2025-01-02", "fx-2025-01-03-revision", "fx-2025-01-06"]);
  assert.deepEqual(pinnedForward.appliedFxObservationIds, ["fx-2025-01-02", "fx-2025-01-03", "fx-2025-01-06"]);
  assert.deepEqual(pinnedForward.bars.slice(0, before.bars.length), before.bars);

  const changed = structuredClone(asset);
  changed.fxObservations!.find((observation) => observation.observationId === "fx-2025-01-06")!.targetCurrencyPerSourceUnit = 999_999;
  const unchanged = resolvePointInTimeReturn(changed, "2025-01-04");
  assert.deepEqual(unchanged.bars, before.bars);
});

test("coverage and exact-date FX gaps fail closed", () => {
  assert.throws(
    () => resolvePointInTimeReturn(jpyAsset({ coverage: coverage("2025-01-05T00:00:00Z") }), "2025-01-04"),
    /coverage was not available by decisionDate/,
  );
  assert.throws(
    () => resolvePointInTimeReturn(jpyAsset({ coverage: { ...coverage(), corporateActions: "unavailable" } }), "2025-01-04"),
    /Complete Corporate Action coverage/,
  );
  const missing = usdAsset();
  missing.fxObservations = missing.fxObservations!.filter((observation) => observation.rateDate !== "2025-01-03");
  assert.throws(() => resolvePointInTimeReturn(missing, "2025-01-06"), /Missing exact-date FX rate USD\/JPY for 2025-01-03/);
});

test("ambiguous duplicate economic events and malformed revisions fail closed", () => {
  const event = {
    type: "cash_distribution" as const,
    eventId: "distribution-1",
    code: "ETF",
    exDate: "2025-01-03",
    amountPerUnit: 1,
    currency: "JPY",
    availableAt: "2025-01-02T00:00:00Z",
    provenance: structuredClone(provenance),
  };
  assert.throws(
    () => resolvePointInTimeReturn(jpyAsset({ events: [event, { ...event, eventId: "distribution-1-final", amountPerUnit: 2 }] }), "2025-01-04"),
    /Ambiguous duplicate economic event/,
  );
  const malformed = jpyAsset();
  malformed.barObservations[2]!.supersedesObservationId = "missing";
  assert.throws(() => resolvePointInTimeReturn(malformed, "2025-01-06"), /must explicitly supersede/);
});

test("JSON asset parser rejects unknown fields and structured clones resolve identically", () => {
  const value = structuredClone(jpyAsset()) as unknown as Record<string, unknown>;
  value.unexpected = true;
  assert.throws(() => validatePointInTimeReturnSourceAsset(value), /unknown fields/);
  const parsed = validatePointInTimeReturnSourceAsset(jpyAsset());
  const cloned = validatePointInTimeReturnSourceAsset(structuredClone(parsed));
  assert.deepEqual(resolvePointInTimeReturn(cloned, "2025-01-04"), resolvePointInTimeReturn(parsed, "2025-01-04"));
});
