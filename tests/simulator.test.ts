import test from "node:test";
import assert from "node:assert/strict";
import { runMonthlyStrategy, type MonthlyFrame } from "../src/backtest/simulator.ts";
import type { AssetSnapshot } from "../src/strategies/types.ts";

const snap = (code: string, r3m: number, r6m: number, r12m: number, volatility: number): AssetSnapshot => ({ code, r3m, r6m, r12m, volatility });

test("simulator compounds and costs", () => {
  const frames: MonthlyFrame[] = [
    { label: "m1", snapshots: [snap("A", .1, .1, .1, .2)], nextMonthReturns: { A: .10 }, costRates: { A: .001 } },
    { label: "m2", snapshots: [snap("A", .1, .1, .1, .2)], nextMonthReturns: { A: .10 }, costRates: { A: .001 } },
  ];
  const result = runMonthlyStrategy(frames, "trend");
  const withoutCosts = runMonthlyStrategy(
    frames.map((frame) => ({ ...frame, costRates: { A: 0 } })),
    "trend",
  );
  assert.ok(result.equityCurve.at(-1)! > 1_200_000);
  assert.ok(result.equityCurve.at(-1)! < withoutCosts.equityCurve.at(-1)!);
  assert.equal(result.monthlyReturns.length, 2);
  assert.ok(Math.abs(result.totalCostRate - .001) < 1e-12);
  assert.ok(result.totalTurnover > 0);
  assert.ok(result.averageCashWeight >= 0 && result.averageCashWeight <= 1);
});

test("simulator hard stops after 30% drawdown and charges liquidation cost", () => {
  const frames: MonthlyFrame[] = [
    { label: "m1", snapshots: [snap("A", .1, .1, .1, .2)], nextMonthReturns: { A: -.31 }, costRates: { A: .001 } },
    { label: "m2", snapshots: [snap("A", .1, .1, .1, .2)], nextMonthReturns: { A: .50 }, costRates: { A: .001 } },
  ];
  const result = runMonthlyStrategy(frames, "trend");
  assert.equal(result.stopped, true);
  assert.equal(result.stopLabel, "m1");
  assert.deepEqual(result.endingWeights, { CASH: 1 });
  assert.deepEqual(result.weightsHistory[1], { CASH: 1 });
  assert.ok(Math.abs(result.totalCostRate - .002) < 1e-12);
  assert.equal(result.averageCashWeight, .5);
});

test("simulator rejects a holding limit above the approved maximum", () => {
  assert.throws(() => runMonthlyStrategy([], "trend", 1_000_000, 4), /maxAssets.*1 to 3/);
});

test("simulator rejects missing held-asset returns instead of substituting zero", () => {
  const frame: MonthlyFrame = {
    label: "m1",
    snapshots: [snap("A", .1, .1, .1, .2)],
    nextMonthReturns: {},
    costRates: { A: 0 },
  };
  assert.throws(() => runMonthlyStrategy([frame], "trend"), /Missing next-month return for held asset A/);
});

test("simulator rejects missing transaction costs instead of substituting zero", () => {
  const frame: MonthlyFrame = {
    label: "m1",
    snapshots: [snap("A", .1, .1, .1, .2)],
    nextMonthReturns: { A: .01 },
    costRates: {},
  };
  assert.throws(() => runMonthlyStrategy([frame], "trend"), /Missing transaction cost rate for A/);
});
