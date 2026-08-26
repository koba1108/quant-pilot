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
  assert.ok(result.equityCurve.at(-1)! > 1_200_000);
  assert.equal(result.monthlyReturns.length, 2);
});

test("simulator hard stops after 30% drawdown", () => {
  const frames: MonthlyFrame[] = [
    { label: "m1", snapshots: [snap("A", .1, .1, .1, .2)], nextMonthReturns: { A: -.31 }, costRates: { A: 0 } },
    { label: "m2", snapshots: [snap("A", .1, .1, .1, .2)], nextMonthReturns: { A: .50 }, costRates: { A: 0 } },
  ];
  const result = runMonthlyStrategy(frames, "trend");
  assert.equal(result.stopped, true);
  assert.deepEqual(result.weightsHistory[1], { CASH: 1 });
});
