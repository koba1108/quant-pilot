import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { DailyBar } from "../src/data/models.ts";
import {
  buildPointInTimeFxRateBook,
  convertCurrencyAmountAtExactRate,
  convertNormalizedReturnSeriesToJpy,
  jpyNormalizedReturnSeriesToDailyBars,
  POINT_IN_TIME_JPY_FX_CONTRACT,
  POINT_IN_TIME_JPY_FX_CONTRACT_ID,
  type FxRateCoverage,
  type FxRateObservation,
} from "../src/data/fx-normalization.ts";
import {
  APPROVED_RESEARCH_TOTAL_RETURN_POLICY,
  normalizeReturnSeries,
  type NormalizedReturnSeries,
  type ReturnEventCoverage,
} from "../src/data/return-normalization.ts";
import {
  buildDistributionLedger,
  scorePositiveEtfForecast,
  type DistributionLedgerEvent,
} from "../src/portfolio/distribution-ledger.ts";

interface FxFixture {
  coverage: FxRateCoverage;
  observations: FxRateObservation[];
}

interface DistributionFixture {
  events: DistributionLedgerEvent[];
}

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/fx-normalization/rates.json", import.meta.url), "utf8"),
) as FxFixture;
const distributionFixture = JSON.parse(
  await readFile(new URL("./fixtures/distribution-ledger/events.json", import.meta.url), "utf8"),
) as DistributionFixture;

const localBars: DailyBar[] = [
  { code: "USD-ETF", tradingDate: "2025-01-02", close: 100, adjustedClose: 100, volume: 10, tradingValue: 1_000 },
  { code: "USD-ETF", tradingDate: "2025-01-03", close: 102, adjustedClose: 102, volume: 11, tradingValue: 1_122 },
  { code: "USD-ETF", tradingDate: "2025-01-06", close: 101, adjustedClose: 101, volume: 12, tradingValue: 1_212 },
  { code: "USD-ETF", tradingDate: "2025-01-07", close: 104, adjustedClose: 104, volume: 13, tradingValue: 1_352 },
  { code: "USD-ETF", tradingDate: "2025-01-08", close: 105, adjustedClose: 105, volume: 14, tradingValue: 1_470 },
];

function eventCoverage(): ReturnEventCoverage {
  return {
    code: "USD-ETF",
    startDate: "2025-01-02",
    endDate: "2025-01-31",
    corporateActions: "complete",
    distributions: "complete",
    provenance: structuredClone(fixture.coverage.provenance),
  };
}

function localSeries(decisionDate = "2025-01-07"): NormalizedReturnSeries {
  return normalizeReturnSeries({
    code: "USD-ETF",
    currency: "USD",
    decisionDate,
    bars: structuredClone(localBars),
    events: [],
    coverage: eventCoverage(),
    basis: "price_return",
  });
}

function rateBook(
  decisionDate = "2025-01-07",
  observations: FxRateObservation[] = structuredClone(fixture.observations),
) {
  return buildPointInTimeFxRateBook({
    decisionDate,
    sourceCurrency: "USD",
    targetCurrency: "JPY",
    observations,
    coverage: structuredClone(fixture.coverage),
  });
}

test("the JPY FX contract fixes quote direction and forbids implicit date filling", () => {
  assert.equal(POINT_IN_TIME_JPY_FX_CONTRACT_ID, "point-in-time-jpy-fx-d006-v1");
  assert.deepEqual(POINT_IN_TIME_JPY_FX_CONTRACT, {
    targetCurrency: "JPY",
    quoteConvention: "target_currency_per_source_currency",
    dateAlignment: "exact_date",
    missingRatePolicy: "fail_closed",
    referenceRateUse: "valuation_only",
  });
  assert.equal(Object.isFrozen(POINT_IN_TIME_JPY_FX_CONTRACT), true);
});

test("unhedged JPY return compounds local return and FX return", () => {
  const converted = convertNormalizedReturnSeriesToJpy({
    series: localSeries(),
    fxRateBook: rateBook(),
  });
  const bars = jpyNormalizedReturnSeriesToDailyBars(converted);

  assert.equal(converted.currency, "JPY");
  assert.equal(converted.sourceCurrency, "USD");
  assert.equal(converted.points[0]!.indexValue, 100);
  assert.ok(Math.abs(converted.points[1]!.indexValue - 103.02) < 1e-12);
  assert.ok(Math.abs(converted.points.at(-1)!.indexValue - 105.38666666666667) < 1e-10);
  const last = converted.points.at(-1)!;
  assert.ok(Math.abs(
    last.dailyReturn! - ((1 + last.localDailyReturn!) * (1 + last.fxDailyReturn!) - 1),
  ) < 1e-12);
  assert.equal(last.fxObservationId, "usd-jpy-2025-01-07");
  assert.equal(last.tradingValueJpy, 1_352 * 152);
  assert.equal(bars.at(-1)!.tradingValue, last.tradingValueJpy);
  assert.equal(bars.at(-1)!.volume, 13);
});

test("a local-currency Total Return series includes distributions before JPY conversion", () => {
  const totalReturn = normalizeReturnSeries({
    code: "USD-ETF",
    currency: "USD",
    decisionDate: "2025-01-03",
    bars: [
      { code: "USD-ETF", tradingDate: "2025-01-02", close: 100, adjustedClose: 100 },
      { code: "USD-ETF", tradingDate: "2025-01-03", close: 99, adjustedClose: 99 },
    ],
    events: [{
      type: "cash_distribution",
      eventId: "usd-distribution",
      code: "USD-ETF",
      exDate: "2025-01-03",
      amountPerUnit: 1,
      currency: "USD",
      availableAt: "2025-01-02T00:00:00Z",
      provenance: structuredClone(fixture.coverage.provenance),
    }],
    coverage: eventCoverage(),
    basis: "total_return",
    totalReturnPolicy: APPROVED_RESEARCH_TOTAL_RETURN_POLICY,
  });
  const converted = convertNormalizedReturnSeriesToJpy({
    series: totalReturn,
    fxRateBook: rateBook("2025-01-03"),
  });

  assert.equal(totalReturn.points.at(-1)!.indexValue, 100);
  assert.equal(converted.basis, "total_return");
  assert.ok(Math.abs(converted.points.at(-1)!.indexValue - 100 * 151 / 150) < 1e-12);
});

test("FX revisions become visible only after their availability time", () => {
  const beforeRevision = rateBook("2025-01-03");
  const afterRevision = rateBook("2025-01-07");

  assert.equal(
    beforeRevision.observations.find((rate) => rate.rateDate === "2025-01-03")!.observationId,
    "usd-jpy-2025-01-03",
  );
  assert.equal(
    afterRevision.observations.find((rate) => rate.rateDate === "2025-01-03")!.observationId,
    "usd-jpy-2025-01-03-revision-1",
  );
  assert.equal(afterRevision.diagnostics.unavailableObservationsExcluded, 1);
  assert.equal(afterRevision.diagnostics.selectedRevisionDates, 1);
});

test("future FX observations and revisions cannot change a prior snapshot", () => {
  const baseline = rateBook();
  const changed = structuredClone(fixture.observations);
  const futureDate = changed.find((rate) => rate.observationId === "usd-jpy-2025-01-08")!;
  const unavailableRevision = changed.find(
    (rate) => rate.observationId === "usd-jpy-2025-01-03-revision-2",
  )!;
  futureDate.targetCurrencyPerSourceUnit = 999_999;
  unavailableRevision.targetCurrencyPerSourceUnit = 888_888;

  assert.deepEqual(rateBook("2025-01-07", changed), baseline);
});

test("FX input ordering does not change the selected Point-in-Time book", () => {
  assert.deepEqual(
    rateBook(),
    rateBook("2025-01-07", structuredClone(fixture.observations).reverse()),
  );
});

test("missing exact-date FX fails instead of carrying a prior rate", () => {
  const missing = structuredClone(fixture.observations).filter(
    (rate) => rate.observationId !== "usd-jpy-2025-01-06",
  );

  assert.throws(
    () => convertNormalizedReturnSeriesToJpy({
      series: localSeries(),
      fxRateBook: rateBook("2025-01-07", missing),
    }),
    /Missing exact-date FX rate.*implicit forward-fill, backfill/,
  );
});

test("inverse or cross-rate interpretation is never implicit", () => {
  const inverted = structuredClone(fixture.observations);
  inverted[0]!.sourceCurrency = "JPY";
  inverted[0]!.targetCurrency = "USD";

  assert.throws(
    () => rateBook("2025-01-07", inverted),
    /inverse or cross-rate conversion is never implicit/,
  );
});

test("FX revisions require an explicit unambiguous supersession chain", () => {
  const ambiguous = structuredClone(fixture.observations);
  const revision = ambiguous.find(
    (rate) => rate.observationId === "usd-jpy-2025-01-03-revision-1",
  )!;
  revision.supersedesObservationId = undefined;

  assert.throws(
    () => rateBook("2025-01-07", ambiguous),
    /must explicitly supersede/,
  );
});

test("coverage and observation timestamps fail closed", () => {
  const unavailableCoverage = structuredClone(fixture.coverage);
  unavailableCoverage.status = "unavailable";
  assert.throws(
    () => buildPointInTimeFxRateBook({
      decisionDate: "2025-01-07",
      sourceCurrency: "USD",
      targetCurrency: "JPY",
      observations: structuredClone(fixture.observations),
      coverage: unavailableCoverage,
    }),
    /Complete FX coverage/,
  );

  const impossibleTimestamp = structuredClone(fixture.observations);
  impossibleTimestamp[0]!.observedAt = "2025-01-02T09:00:00Z";
  impossibleTimestamp[0]!.availableAt = "2025-01-02T08:00:00Z";
  assert.throws(
    () => rateBook("2025-01-07", impossibleTimestamp),
    /cannot be available before it was observed/,
  );
});

test("amount conversion records the exact rate and provenance", () => {
  const converted = convertCurrencyAmountAtExactRate(rateBook(), -2, "2025-01-07");

  assert.equal(converted.sourceAmount, -2);
  assert.equal(converted.targetAmount, -304);
  assert.equal(converted.sourceCurrency, "USD");
  assert.equal(converted.targetCurrency, "JPY");
  assert.equal(converted.fxObservationId, "usd-jpy-2025-01-07");
  assert.equal(converted.fxProvenance.recordId, "usd-jpy-2025-01-07");
});

test("conversion revalidates a rate book that was mutated after construction", () => {
  const mutated = rateBook();
  mutated.observations[0]!.targetCurrencyPerSourceUnit = -1;

  assert.throws(
    () => convertCurrencyAmountAtExactRate(mutated, 1, "2025-01-02"),
    /rate must be positive/,
  );
});

test("foreign distributions enter JPY forecast scoring at each recognition-date rate", () => {
  const events = structuredClone(distributionFixture.events);
  for (const event of events) {
    if (event.type === "distribution_entitlement" || event.type === "distribution_payment") {
      event.currency = "USD";
    }
  }
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events });
  const score = scorePositiveEtfForecast({
    code: "ETF",
    currency: "JPY",
    horizonStartExclusive: "2024-12-31",
    horizonEndInclusive: "2025-01-31",
    startingEquity: 100_000,
    pricePnl: -1_700,
    transactionCosts: 50,
    fxConversionCosts: 20,
    distributionLedger: ledger,
    fxRateBooks: [rateBook("2025-01-31")],
  });

  assert.equal(score.distributionIncome, 10 * 149 + 2 * 153);
  assert.equal(score.netPnl, 26);
  assert.equal(score.outcome, "hit");
  assert.deepEqual(score.appliedFxObservationIds, [
    "usd-jpy-2025-01-06",
    "usd-jpy-2025-01-08",
  ]);
});

test("foreign distribution scoring fails when a recognition-date rate is absent", () => {
  const events = structuredClone(distributionFixture.events);
  for (const event of events) {
    if (event.type === "distribution_entitlement" || event.type === "distribution_payment") {
      event.currency = "USD";
    }
  }
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events });
  const missingRevisionDate = structuredClone(fixture.observations).filter(
    (rate) => rate.rateDate !== "2025-01-08",
  );

  assert.throws(
    () => scorePositiveEtfForecast({
      code: "ETF",
      currency: "JPY",
      horizonStartExclusive: "2024-12-31",
      horizonEndInclusive: "2025-01-31",
      startingEquity: 100_000,
      pricePnl: 0,
      transactionCosts: 0,
      fxConversionCosts: 0,
      distributionLedger: ledger,
      fxRateBooks: [rateBook("2025-01-31", missingRevisionDate)],
    }),
    /Missing exact-date FX rate USD\/JPY for 2025-01-08/,
  );
});
