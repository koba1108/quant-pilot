import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePointInTimeUniverse,
  resolvePointInTimeUniverseWithDiagnostics,
  type PointInTimeEligibilityObservation,
} from "../src/data/universe.ts";
import type { UniverseMember } from "../src/data/models.ts";
import { oneWayCostRate, turnoverCost } from "../src/portfolio/costs.ts";

test("point-in-time excludes future and delisted", () => {
  const members: UniverseMember[] = [
    { code: "A", assetGroup: "x", subgroup: "x", role: "core", listingDate: "2020-01-01" },
    { code: "B", assetGroup: "x", subgroup: "x", role: "core", listingDate: "2027-01-01" },
    { code: "C", assetGroup: "x", subgroup: "x", role: "core", listingDate: "2020-01-01", delistingDate: "2026-01-01" },
  ];
  const result = resolvePointInTimeUniverse(members, "2026-08-25", { A: 1000, B: 0, C: 1000 }, { A: 100_000_000, B: 0, C: 100_000_000 }, { A: 20, B: 20, C: 20 });
  assert.deepEqual(result.map((x) => x.code), ["A"]);
});

test("theme has stricter history", () => {
  const member: UniverseMember = { code: "T", assetGroup: "theme", subgroup: "x", role: "satellite", listingDate: "2024-01-01", theme: true };
  const result = resolvePointInTimeUniverse([member], "2026-08-25", { T: 300 }, { T: 100_000_000 }, { T: 20 });
  assert.deepEqual(result, []);
});

test("delistingDate is the final eligible date in the legacy universe contract", () => {
  const member: UniverseMember = {
    code: "D",
    assetGroup: "x",
    subgroup: "x",
    role: "core",
    listingDate: "2020-01-01",
    delistingDate: "2025-01-15",
  };
  const inputs = { D: 1000 };
  const values = { D: 100_000_000 };
  const spreads = { D: 20 };
  assert.deepEqual(resolvePointInTimeUniverse([member], "2025-01-15", inputs, values, spreads), [member]);
  assert.deepEqual(resolvePointInTimeUniverse([member], "2025-01-16", inputs, values, spreads), []);
});

test("dated eligibility observations fail closed and future revisions cannot leak backward", () => {
  const member: UniverseMember = {
    code: "A",
    assetGroup: "x",
    subgroup: "x",
    role: "core",
    listingDate: "2020-01-01",
  };
  const observation = (
    observationId: string,
    metric: PointInTimeEligibilityObservation["metric"],
    value: number,
    availableAt: string,
  ): PointInTimeEligibilityObservation => ({
    observationId,
    code: "A",
    metric,
    value,
    observedAt: availableAt,
    availableAt,
    sourceId: "synthetic",
    recordId: observationId,
  });
  const base = [
    observation("history-v1", "history_days", 300, "2025-01-01T00:00:00Z"),
    observation("value-v1", "monthly_trading_value_jpy", 100_000_000, "2025-01-01T00:00:00Z"),
    observation("spread-v1", "spread_bps", 20, "2025-01-01T00:00:00Z"),
  ];
  const policy = {
    minHistoryDaysCore: 252,
    minHistoryDaysTheme: 504,
    minMonthlyTradingValueJpy: 50_000_000,
    maxSpreadBpsCore: 100,
    maxSpreadBpsTheme: 75,
  };
  const prior = resolvePointInTimeUniverseWithDiagnostics([member], "2025-01-15", base, policy);
  const withFutureRevision = resolvePointInTimeUniverseWithDiagnostics(
    [member],
    "2025-01-15",
    [...base, observation("spread-v2", "spread_bps", 999, "2025-01-20T00:00:00Z")],
    policy,
  );
  assert.deepEqual(withFutureRevision, prior);
  assert.deepEqual(prior.members, [member]);

  const missingSpread = resolvePointInTimeUniverseWithDiagnostics([member], "2025-01-15", base.slice(0, 2), policy);
  assert.equal(missingSpread.diagnostics[0]!.reason, "missing_spread");
  assert.deepEqual(missingSpread.members, []);
});

test("cost model uses half spread plus slippage", () => {
  const rate = oneWayCostRate(20, { commissionBps: 0, slippageBps: 5, fallbackHalfSpreadBps: 15, fxConversionBps: 0 });
  assert.ok(Math.abs(rate - .0015) < 1e-12);
  const cost = turnoverCost({ A: 1 }, { B: 1 }, { A: rate, B: rate });
  assert.ok(Math.abs(cost - .003) < 1e-12);
});
