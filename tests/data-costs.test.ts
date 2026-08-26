import test from "node:test";
import assert from "node:assert/strict";
import { resolvePointInTimeUniverse } from "../src/data/universe.ts";
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

test("cost model uses half spread plus slippage", () => {
  const rate = oneWayCostRate(20, { commissionBps: 0, slippageBps: 5, fallbackHalfSpreadBps: 15, fxConversionBps: 0 });
  assert.ok(Math.abs(rate - .0015) < 1e-12);
  const cost = turnoverCost({ A: 1 }, { B: 1 }, { A: rate, B: rate });
  assert.ok(Math.abs(cost - .003) < 1e-12);
});
