import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { DailyBar } from "../src/data/models.ts";
import {
  APPROVED_RESEARCH_TOTAL_RETURN_POLICY,
  APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID,
  normalizedReturnSeriesToDailyBars,
  normalizeReturnSeries,
  type NormalizeReturnSeriesRequest,
  type ReturnEvent,
  type ReturnEventCoverage,
} from "../src/data/return-normalization.ts";

interface ReturnFixture {
  bars: DailyBar[];
  events: ReturnEvent[];
  coverage: ReturnEventCoverage;
}

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/return-normalization/events.json", import.meta.url), "utf8"),
) as ReturnFixture;

function request(
  basis: NormalizeReturnSeriesRequest["basis"],
  overrides: Partial<NormalizeReturnSeriesRequest> = {},
): NormalizeReturnSeriesRequest {
  return {
    code: "ETF",
    currency: "JPY",
    decisionDate: "2025-01-07",
    bars: structuredClone(fixture.bars),
    events: structuredClone(fixture.events),
    coverage: structuredClone(fixture.coverage),
    basis,
    ...(basis === "total_return"
      ? {
          totalReturnPolicy: {
            distributionRecognition: "ex_date",
            reinvestment: "same_day_close",
          } as const,
        }
      : {}),
    ...overrides,
  };
}

test("Price Return removes split discontinuity and excludes distributions", () => {
  const result = normalizeReturnSeries(request("price_return"));

  assert.equal(result.basis, "price_return");
  assert.ok(Math.abs(result.points[1]!.dailyReturn!) < 1e-12);
  assert.ok(Math.abs(result.points.at(-1)!.indexValue - 100) < 1e-12);
  assert.equal(result.diagnostics.appliedSplitEvents, 1);
  assert.equal(result.diagnostics.appliedDistributionEvents, 0);
  assert.equal(result.diagnostics.ignoredDistributionEvents, 1);
  assert.equal(result.diagnostics.futureBarsExcluded, 1);
  assert.equal(result.diagnostics.futureEventsExcluded, 1);
});

test("Price Return normalizes a reverse split through the same unit-ratio contract", () => {
  const result = normalizeReturnSeries(request("price_return", {
    decisionDate: "2025-01-03",
    bars: [
      { code: "ETF", tradingDate: "2025-01-02", close: 100, adjustedClose: 100 },
      { code: "ETF", tradingDate: "2025-01-03", close: 200, adjustedClose: 200 },
    ],
    events: [{
      type: "split",
      eventId: "reverse-split",
      code: "ETF",
      effectiveDate: "2025-01-03",
      newUnitsPerOldUnit: .5,
      availableAt: "2025-01-02T00:00:00Z",
      provenance: structuredClone(fixture.coverage.provenance),
    }],
    coverage: {
      ...structuredClone(fixture.coverage),
      endDate: "2025-01-03",
    },
  }));

  assert.ok(Math.abs(result.points.at(-1)!.indexValue - 100) < 1e-12);
});

test("Total Return applies an explicit ex-date close-reinvestment policy", () => {
  const result = normalizeReturnSeries(request("total_return"));
  const adaptedBars = normalizedReturnSeriesToDailyBars(result);

  assert.equal(result.basis, "total_return");
  assert.equal(result.policy?.distributionRecognition, "ex_date");
  assert.equal(result.diagnostics.appliedSplitEvents, 1);
  assert.equal(result.diagnostics.appliedDistributionEvents, 1);
  assert.deepEqual(result.appliedEvents.map((event) => event.eventId), ["split-2-for-1", "distribution-1"]);
  assert.equal(result.appliedEvents[1]!.provenance.recordId, "distribution-1");
  assert.ok(Math.abs(result.points.at(-1)!.indexValue - 102.04081632653062) < 1e-10);
  assert.equal(adaptedBars.at(-1)!.adjustedClose, result.points.at(-1)!.indexValue);
  assert.equal(adaptedBars.at(-1)!.volume, 2100);
  assert.equal(adaptedBars.at(-1)!.tradingValue, 105000);
});

test("the approved research Total Return policy remains explicit and versionable", () => {
  assert.equal(APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID, "research-total-return-d018-v1");
  assert.deepEqual(APPROVED_RESEARCH_TOTAL_RETURN_POLICY, {
    distributionRecognition: "ex_date",
    reinvestment: "same_day_close",
  });
  assert.equal(Object.isFrozen(APPROVED_RESEARCH_TOTAL_RETURN_POLICY), true);
});

test("ex-date and pay-date policies remain explicit and produce different paths", () => {
  const exDate = normalizeReturnSeries(request("total_return"));
  const payDate = normalizeReturnSeries(request("total_return", {
    totalReturnPolicy: {
      distributionRecognition: "pay_date",
      reinvestment: "same_day_close",
    },
  }));

  assert.notDeepEqual(
    payDate.points.map((point) => point.dailyReturn),
    exDate.points.map((point) => point.dailyReturn),
  );
  assert.ok(Math.abs(payDate.points.at(-1)!.indexValue - 102) < 1e-12);
});

test("Total Return has no implicit distribution policy", () => {
  assert.throws(
    () => normalizeReturnSeries(request("total_return", { totalReturnPolicy: undefined })),
    /requires an explicit totalReturnPolicy/,
  );
});

test("Total Return fails closed when distribution coverage is unavailable", () => {
  assert.throws(
    () => normalizeReturnSeries(request("total_return", {
      coverage: {
        ...structuredClone(fixture.coverage),
        distributions: "unavailable",
      },
    })),
    /Complete distribution coverage/,
  );
});

test("Price Return fails closed when Corporate Action coverage is unavailable", () => {
  assert.throws(
    () => normalizeReturnSeries(request("price_return", {
      coverage: {
        ...structuredClone(fixture.coverage),
        corporateActions: "unavailable",
      },
    })),
    /Complete Corporate Action coverage/,
  );
});

test("return-event coverage must itself be available by the decision date", () => {
  assert.throws(
    () => normalizeReturnSeries(request("price_return", {
      coverage: {
        ...structuredClone(fixture.coverage),
        availableAt: "2025-01-08T00:00:00Z",
      },
    })),
    /coverage was not available by decisionDate/,
  );
});

test("future bars and events cannot change a prior decision-date series", () => {
  const baseline = normalizeReturnSeries(request("total_return"));
  const bars = structuredClone(fixture.bars);
  bars.at(-1)!.close = 1;
  const events = structuredClone(fixture.events);
  const futureDistribution = events.find((event) => event.eventId === "future-distribution");
  assert.equal(futureDistribution?.type, "cash_distribution");
  if (futureDistribution?.type === "cash_distribution") {
    futureDistribution.amountPerUnit = 999_999;
  }

  const changedFuture = normalizeReturnSeries(request("total_return", { bars, events }));
  assert.deepEqual(changedFuture.points, baseline.points);
});

test("event input ordering does not change normalized output", () => {
  const baseline = normalizeReturnSeries(request("total_return"));
  const reversed = normalizeReturnSeries(request("total_return", {
    events: structuredClone(fixture.events).reverse(),
  }));

  assert.deepEqual(reversed.points, baseline.points);
  assert.deepEqual(reversed.appliedEvents, baseline.appliedEvents);
});

test("events unavailable on their recognition date fail point-in-time validation", () => {
  const events = structuredClone(fixture.events);
  const distribution = events.find((event) => event.eventId === "distribution-1")!;
  distribution.availableAt = "2025-01-07T00:00:00Z";

  assert.throws(
    () => normalizeReturnSeries(request("total_return", { events })),
    /not available by its recognition date/,
  );
});

test("same-day normalization fails when the recognition-date bar is missing", () => {
  const bars = structuredClone(fixture.bars).filter((bar) => bar.tradingDate !== "2025-01-06");

  assert.throws(
    () => normalizeReturnSeries(request("total_return", { bars })),
    /recognition date 2025-01-06 has no bar/,
  );
});

test("foreign-currency distributions require the later FX normalization layer", () => {
  const events = structuredClone(fixture.events);
  const distribution = events.find((event) => event.eventId === "distribution-1");
  assert.equal(distribution?.type, "cash_distribution");
  if (distribution?.type === "cash_distribution") {
    distribution.currency = "USD";
  }

  assert.throws(
    () => normalizeReturnSeries(request("total_return", { events })),
    /Point-in-Time FX normalization is required first/,
  );
});

test("unsupported Corporate Actions fail instead of being approximated", () => {
  const events: ReturnEvent[] = [
    ...structuredClone(fixture.events),
    {
      type: "unsupported_corporate_action",
      eventId: "merger-1",
      code: "ETF",
      effectiveDate: "2025-01-06",
      actionType: "merger",
      availableAt: "2025-01-05T00:00:00Z",
      provenance: structuredClone(fixture.coverage.provenance),
    },
  ];

  assert.throws(
    () => normalizeReturnSeries(request("price_return", { events })),
    /Unsupported Corporate Action merger/,
  );
});

test("split and distribution on one recognition date require explicit ordering", () => {
  const events = structuredClone(fixture.events);
  const distribution = events.find((event) => event.eventId === "distribution-1");
  assert.equal(distribution?.type, "cash_distribution");
  if (distribution?.type === "cash_distribution") {
    distribution.exDate = "2025-01-03";
    distribution.availableAt = "2025-01-02T00:00:00Z";
  }

  assert.throws(
    () => normalizeReturnSeries(request("total_return", { events })),
    /ordering must be modeled explicitly/,
  );
});
