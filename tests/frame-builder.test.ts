import { describe, expect, test } from "bun:test";
import { buildMonthlyFrames, buildMonthlyFramesWithDiagnostics } from "../src/backtest/frame-builder.ts";
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

function followingMonth(label: string): string {
  const [year, month] = label.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 7);
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

  test("future prices can change forward returns but not the decision-date signal", () => {
    const bars = makeBars("AAA", 360);
    const baseline = buildMonthlyFrames({ AAA: bars }, { minHistoryDays: 252 });
    const target = baseline[0]!;
    const altered = bars.map((bar) => bar.tradingDate.slice(0, 7) > target.label
      ? { ...bar, close: bar.close * 10, adjustedClose: bar.adjustedClose * 10 }
      : bar);
    const rebuilt = buildMonthlyFrames({ AAA: altered }, { minHistoryDays: 252 });
    const rebuiltTarget = rebuilt.find((frame) => frame.label === target.label)!;

    expect(rebuiltTarget.snapshots).toEqual(target.snapshots);
    expect(rebuiltTarget.nextMonthReturns.AAA).not.toBe(target.nextMonthReturns.AAA);
  });

  test("does not stretch a forward return across a missing calendar month", () => {
    const bars = makeBars("AAA", 360);
    const baseline = buildMonthlyFrames({ AAA: bars }, { minHistoryDays: 252 });
    const targetLabel = baseline[0]!.label;
    const missingLabel = followingMonth(targetLabel);
    const withGap = bars.filter((bar) => bar.tradingDate.slice(0, 7) !== missingLabel);
    const rebuilt = buildMonthlyFrames({ AAA: withGap }, { minHistoryDays: 252 });

    expect(rebuilt.find((frame) => frame.label === targetLabel)).toBeUndefined();
  });

  test("reports insufficient history as an explicit exclusion", () => {
    const result = buildMonthlyFramesWithDiagnostics({ SHORT: makeBars("SHORT", 100) });
    expect(result.frames).toHaveLength(0);
    expect(result.assetDiagnostics[0]).toMatchObject({
      code: "SHORT",
      barCount: 100,
      eligibleFrameCount: 0,
    });
    expect(result.assetDiagnostics[0]!.exclusionReason).toContain("Insufficient history");
  });

  test("uses the explicitly selected price field", () => {
    const bars = makeBars("AAA").map((bar, index) => ({
      ...bar,
      adjustedClose: 100 + index * .4,
    }));
    const rawPrice = buildMonthlyFrames({ AAA: bars }, { priceField: "close" });
    const providerAdjusted = buildMonthlyFrames({ AAA: bars }, { priceField: "adjustedClose" });

    expect(rawPrice[0]!.snapshots[0]!.r12m).not.toBe(providerAdjusted[0]!.snapshots[0]!.r12m);
  });
});
