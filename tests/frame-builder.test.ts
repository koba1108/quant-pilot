import { describe, expect, test } from "bun:test";
import { buildMonthlyFrames } from "../src/backtest/frame-builder.ts";
import type { DailyBar } from "../src/data/models.ts";

function makeBars(code: string, days = 320): DailyBar[] {
  const bars: DailyBar[] = [];
  const start = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const price = 100 + i * 0.2;
    bars.push({
      code,
      tradingDate: d.toISOString().slice(0, 10),
      close: price,
      adjustedClose: price,
      volume: 1000,
      tradingValue: price * 1000,
    });
  }
  return bars;
}

describe("buildMonthlyFrames", () => {
  test("builds point-in-time snapshots and next-month returns", () => {
    const frames = buildMonthlyFrames({ AAA: makeBars("AAA") }, { minHistoryDays: 252, costRate: 0.001 });
    expect(frames.length).toBeGreaterThan(0);
    const first = frames[0]!;
    expect(first.snapshots).toHaveLength(1);
    expect(first.snapshots[0]!.r12m).toBeGreaterThan(0);
    expect(first.nextMonthReturns.AAA).toBeGreaterThan(0);
    expect(first.costRates.AAA).toBe(0.001);
  });
});
