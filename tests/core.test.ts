import { test } from "bun:test";
import assert from "node:assert/strict";
import { rankTrend, validateTrendParameters } from "../src/strategies/trend.ts";
import { rankRotation, validateRotationParameters } from "../src/strategies/rotation.ts";
import { inverseVolWeights } from "../src/portfolio/allocator.ts";
import { maxDrawdown, hardStopTriggered } from "../src/portfolio/risk.ts";
import type { AssetSnapshot } from "../src/strategies/types.ts";
import { assertConsecutiveMonthlyLabels } from "../src/backtest/metrics.ts";

const snap = (code: string, r3m: number, r6m: number, r12m: number, volatility: number): AssetSnapshot => ({ code, r3m, r6m, r12m, volatility });

test("trend filters negative 12m", () => {
  const ranked = rankTrend([snap("A", .03, .10, .20, .15), snap("B", .20, .10, -.01, .20)]);
  assert.deepEqual(ranked.map((x) => x.code), ["A"]);
});

test("rotation and inverse-vol weights", () => {
  const ranked = rankRotation([snap("A", .03, .10, .20, .10), snap("B", .02, .08, .15, .20), snap("C", .01, .06, .12, .30)]);
  const weights = inverseVolWeights(ranked);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok((weights.A ?? 0) > (weights.B ?? 0));
  assert.ok((weights.B ?? 0) > (weights.C ?? 0));
});

test("allocator rejects more than three holdings", () => {
  const ranked = rankRotation([
    snap("A", .03, .10, .20, .10),
    snap("B", .02, .08, .15, .20),
    snap("C", .01, .06, .12, .30),
    snap("D", .04, .11, .21, .12),
  ]);
  assert.throws(() => inverseVolWeights(ranked, 4), /maxAssets.*1 to 3/);
});

test("drawdown hard stop", () => {
  const curve = [100, 120, 100, 84];
  assert.ok(Math.abs(maxDrawdown(curve) - (-.30)) < 1e-12);
  assert.equal(hardStopTriggered(curve), true);
});

test("provisional Strategy A/B parameters are explicit, validated, and deterministically tie-broken", () => {
  const equal = [snap("B", .1, .1, .1, .2), snap("A", .1, .1, .1, .2)];
  assert.deepEqual(rankTrend(equal).map((asset) => asset.code), ["A", "B"]);
  assert.deepEqual(rankRotation(equal).map((asset) => asset.code), ["A", "B"]);
  assert.doesNotThrow(() => validateTrendParameters({
    r3mWeight: .1,
    r6mWeight: .3,
    r12mWeight: .6,
    requirePositiveR12m: true,
  }));
  assert.doesNotThrow(() => validateRotationParameters({
    r6mWeight: .3,
    r12mWeight: .5,
    volatilityPenalty: .2,
    requirePositiveR12m: true,
  }));
  assert.throws(() => validateTrendParameters({
    r3mWeight: .1,
    r6mWeight: .3,
    r12mWeight: .5,
    requirePositiveR12m: true,
  }), /sum to one/);
});

test("strategy parameter variants can change rankings and annualized metrics reject calendar gaps", () => {
  const candidates = [
    snap("SHORT", .30, .05, .02, .2),
    snap("LONG", .01, .10, .25, .2),
  ];
  const shortWeighted = rankTrend(candidates, {
    r3mWeight: .8,
    r6mWeight: .1,
    r12mWeight: .1,
    requirePositiveR12m: true,
  });
  const longWeighted = rankTrend(candidates, {
    r3mWeight: .1,
    r6mWeight: .1,
    r12mWeight: .8,
    requirePositiveR12m: true,
  });
  assert.equal(shortWeighted[0]!.code, "SHORT");
  assert.equal(longWeighted[0]!.code, "LONG");
  assert.doesNotThrow(() => assertConsecutiveMonthlyLabels(["2024-01", "2024-02", "2024-03"]));
  assert.throws(
    () => assertConsecutiveMonthlyLabels(["2024-01", "2024-03"]),
    /require consecutive monthly frames/,
  );
});
