import test from "node:test";
import assert from "node:assert/strict";
import { rankTrend } from "../src/strategies/trend.ts";
import { rankRotation } from "../src/strategies/rotation.ts";
import { inverseVolWeights } from "../src/portfolio/allocator.ts";
import { maxDrawdown, hardStopTriggered } from "../src/portfolio/risk.ts";
import type { AssetSnapshot } from "../src/strategies/types.ts";

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

test("drawdown hard stop", () => {
  const curve = [100, 120, 100, 84];
  assert.ok(Math.abs(maxDrawdown(curve) - (-.30)) < 1e-12);
  assert.equal(hardStopTriggered(curve), true);
});
