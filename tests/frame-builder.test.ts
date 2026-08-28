import { describe, expect, test } from "bun:test";
import {
  buildMonthlyFrames,
  buildMonthlyFramesWithDiagnostics,
  buildPointInTimeMonthlyFramesWithDiagnostics,
  type PointInTimeReturnSnapshot,
} from "../src/backtest/frame-builder.ts";
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

function pointInTimeResolver(
  bars: DailyBar[],
  alterAtOrAfter?: { cutoff: string; month: string; multiplier: number },
): (
  code: string,
  decisionDate: string,
  pinnedPrefix?: PointInTimeReturnSnapshot,
) => PointInTimeReturnSnapshot | undefined {
  return (code, decisionDate, pinnedPrefix) => {
    const selected = bars.filter((bar) => bar.tradingDate <= decisionDate).map((bar) => (
      pinnedPrefix !== undefined && bar.tradingDate <= pinnedPrefix.decisionDate
        ? { ...pinnedPrefix.bars.find((pinnedBar) => pinnedBar.tradingDate === bar.tradingDate)! }
        :
      alterAtOrAfter !== undefined
        && decisionDate >= alterAtOrAfter.cutoff
        && bar.tradingDate.startsWith(alterAtOrAfter.month)
        ? { ...bar, close: bar.close * alterAtOrAfter.multiplier, adjustedClose: bar.adjustedClose * alterAtOrAfter.multiplier }
        : { ...bar }
    ));
    if (selected.length === 0) return undefined;
    return {
      code,
      decisionDate,
      sourceCurrency: "JPY",
      currency: "JPY",
      basis: "price_return",
      normalizationVersion: "test-normalization-v1",
      inputFingerprint: `sha256:${"1".repeat(64)}`,
      snapshotFingerprint: `sha256:${(decisionDate.endsWith("31") ? "2" : "3").repeat(64)}`,
      pinnedPrefixFingerprint: pinnedPrefix?.snapshotFingerprint,
      bars: selected,
      selectedBarObservationIds: selected.map((bar) => `bar-${bar.tradingDate}`),
      appliedReturnEventIds: [],
      appliedFxObservationIds: [],
    };
  };
}

describe("buildMonthlyFrames", () => {
  test("builds point-in-time snapshots and next-month returns", () => {
    const frames = buildMonthlyFrames({ AAA: makeBars("AAA") }, { minHistoryDays: 252, costRate: 0.001 });
    expect(frames.length).toBeGreaterThan(0);
    const first = frames[0]!;
    expect(first.snapshots).toHaveLength(1);
    expect(first.snapshots[0]!.r12m).toBeGreaterThan(0);
    expect(first.nextMonthReturns.AAA).toBeGreaterThan(0);
    expect(first.returnLabel).toBe(followingMonth(first.label));
    expect(first.costRates.AAA).toBe(0.001);
  });

  test("labels each frame with the month in which its forward return is realized", () => {
    const frames = buildMonthlyFrames({ AAA: makeBars("AAA", 500) });

    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.returnLabel === followingMonth(frame.label))).toBe(true);
    expect(frames.map((frame) => frame.returnLabel)).toEqual(
      frames.map((frame) => followingMonth(frame.label)),
    );
  });

  test("rebuilds normalized signal and forward snapshots at their own Point-in-Time cutoffs", () => {
    const bars = makeBars("AAA", 600);
    const baseline = buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: pointInTimeResolver(bars),
    });
    const target = baseline.frames[0]!;
    const changed = buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: pointInTimeResolver(bars, {
        cutoff: `${target.returnLabel}-01`,
        month: target.returnLabel!,
        multiplier: 5,
      }),
    });
    const changedTarget = changed.frames.find((frame) => frame.label === target.label)!;

    expect(changedTarget.snapshots).toEqual(target.snapshots);
    expect(changedTarget.nextMonthReturns.AAA).not.toBe(target.nextMonthReturns.AAA);
    expect(changedTarget.returnLabel).toBe(followingMonth(changedTarget.label));
    expect(changed.assetDiagnostics[0]!.returnNormalizationDecisions?.filter(
      (decision) => decision.frameLabel === target.label,
    ).map((decision) => decision.phase)).toEqual(["forward_endpoint", "signal"]);
  });

  test("pins the signal prefix when later observations revise the entry month", () => {
    const bars = makeBars("AAA", 600);
    const baseline = buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: pointInTimeResolver(bars),
    });
    const target = baseline.frames[0]!;
    const revised = buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: pointInTimeResolver(bars, {
        cutoff: `${target.returnLabel}-01`,
        month: target.label,
        multiplier: 5,
      }),
    });
    const revisedTarget = revised.frames.find((frame) => frame.label === target.label)!;

    expect(revisedTarget.snapshots).toEqual(target.snapshots);
    expect(revisedTarget.nextMonthReturns.AAA).toBe(target.nextMonthReturns.AAA);
  });

  test("uses the asset's actual month-end trading date as the information cutoff", () => {
    const bars = makeBars("AAA", 700).filter((bar) => {
      const day = new Date(`${bar.tradingDate}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    });
    const baseline = buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: pointInTimeResolver(bars),
    });
    const changed = buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: pointInTimeResolver(bars, {
        cutoff: "2025-05-31",
        month: "2025-05",
        multiplier: 5,
      }),
    });
    const target = baseline.frames.find((frame) => frame.label === "2025-05")!;
    const changedTarget = changed.frames.find((frame) => frame.label === "2025-05")!;

    expect(target.decisionDate).toBe("2025-05-30");
    expect(changedTarget.snapshots).toEqual(target.snapshots);
    expect(changedTarget.nextMonthReturns.AAA).toBe(target.nextMonthReturns.AAA);
    expect(changed.assetDiagnostics[0]!.returnNormalizationDecisions?.find(
      (decision) => decision.frameLabel === "2025-05" && decision.phase === "signal",
    )?.cutoffDate).toBe("2025-05-30");
  });

  test("fails closed when the actual forward endpoint was not available on its trading date", () => {
    const bars = makeBars("AAA", 700).filter((bar) => {
      const day = new Date(`${bar.tradingDate}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    });
    const resolver = pointInTimeResolver(bars);

    expect(() => buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: (code, decisionDate, pinnedPrefix) => (
        decisionDate === "2025-05-30" && pinnedPrefix !== undefined
          ? undefined
          : resolver(code, decisionDate, pinnedPrefix)
      ),
    })).toThrow(/endpoint was not available on its trading date 2025-05-30/);
  });

  test("fails closed when normalized source or policy metadata changes between snapshots", () => {
    const bars = makeBars("AAA", 600);
    const resolver = pointInTimeResolver(bars);

    expect(() => buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: (code, decisionDate, pinnedPrefix) => {
        const snapshot = resolver(code, decisionDate, pinnedPrefix);
        return snapshot === undefined || pinnedPrefix === undefined
          ? snapshot
          : { ...snapshot, normalizationVersion: "test-normalization-v2" };
      },
    })).toThrow(/source or policy identity changed/);
  });

  test("rejects a partial final month instead of annualizing it as a complete month", () => {
    const bars = makeBars("AAA", 600);
    expect(() => buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-06-15",
      resolveReturnSnapshot: pointInTimeResolver(bars),
    })).toThrow(/calendar month-end/);
  });

  test("fails closed when a signal-eligible normalized asset has no forward snapshot", () => {
    const bars = makeBars("AAA", 600);
    const baselineResolver = pointInTimeResolver(bars);
    const cutoffToRemove = `${followingMonth("2024-09")}-31`;
    expect(() => buildPointInTimeMonthlyFramesWithDiagnostics({
      codes: ["AAA"],
      start: bars[0]!.tradingDate,
      end: "2025-07-31",
      resolveReturnSnapshot: (code, decisionDate, pinnedPrefix) => decisionDate === cutoffToRemove
        ? undefined
        : baselineResolver(code, decisionDate, pinnedPrefix),
    })).toThrow(/no snapshot is available/);
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

  test("volatility-window variants change the calculated signal input", () => {
    const bars = makeBars("AAA", 500).map((bar, index) => ({
      ...bar,
      adjustedClose: index > 450 ? bar.adjustedClose * (index % 2 === 0 ? 1.2 : .8) : bar.adjustedClose,
    }));
    const shortWindow = buildMonthlyFrames({ AAA: bars }, { volatilityWindowDays: 10 });
    const longWindow = buildMonthlyFrames({ AAA: bars }, { volatilityWindowDays: 120 });
    const sharedLabel = shortWindow.at(-1)!.label;
    const shortVolatility = shortWindow.find((frame) => frame.label === sharedLabel)!.snapshots[0]!.volatility;
    const longVolatility = longWindow.find((frame) => frame.label === sharedLabel)!.snapshots[0]!.volatility;
    expect(shortVolatility).not.toBe(longVolatility);
  });

  test("applies Point-in-Time Universe availability on each actual signal date", () => {
    const bars = makeBars("AAA", 500);
    const baseline = buildMonthlyFrames({ AAA: bars });
    const availableFrom = baseline[2]!.decisionDate!;
    const filtered = buildMonthlyFramesWithDiagnostics({ AAA: bars }, {
      universeEligibility: (_code, decisionDate) => decisionDate >= availableFrom
        ? { eligible: true, observationId: "universe-v1" }
        : { eligible: false, reason: "metadata_unavailable" },
    });

    expect(filtered.frames).toHaveLength(baseline.length);
    expect(filtered.frames.some((frame) => frame.snapshots.length === 0)).toBe(true);
    expect(filtered.frames.filter((frame) => frame.snapshots.length > 0)
      .every((frame) => frame.decisionDate! >= availableFrom)).toBe(true);
    expect(filtered.assetDiagnostics[0]!.universeObservationIds).toEqual(["universe-v1"]);
    expect(filtered.assetDiagnostics[0]!.universeExclusions?.metadata_unavailable).toBeGreaterThan(0);
  });

  test("uses each asset's own month-end trading date for Point-in-Time membership", () => {
    const alpha = makeBars("ALPHA", 500);
    const beta = makeBars("BETA", 500).filter((bar) => Number(bar.tradingDate.slice(8, 10)) <= 25);
    const result = buildMonthlyFramesWithDiagnostics({ ALPHA: alpha, BETA: beta }, {
      universeEligibility: () => ({ eligible: true, observationId: "known" }),
    });
    const label = result.frames.find((frame) => frame.snapshots.length === 2)!.label;
    const alphaSignal = result.assetDiagnostics.find((item) => item.code === "ALPHA")!
      .universeDecisions!.find((item) => item.frameLabel === label && item.phase === "signal")!;
    const betaSignal = result.assetDiagnostics.find((item) => item.code === "BETA")!
      .universeDecisions!.find((item) => item.frameLabel === label && item.phase === "signal")!;

    expect(alphaSignal.date).not.toBe(betaSignal.date);
    expect(alphaSignal.date).toBe(alpha.filter((bar) => bar.tradingDate.startsWith(label)).at(-1)!.tradingDate);
    expect(betaSignal.date).toBe(beta.filter((bar) => bar.tradingDate.startsWith(label)).at(-1)!.tradingDate);
  });

  test("keeps a valid month as an explicit cash frame when the whole Universe is unavailable", () => {
    const bars = makeBars("AAA", 500);
    const baseline = buildMonthlyFrames({ AAA: bars });
    const excludedLabel = baseline[2]!.label;
    const result = buildMonthlyFrames({ AAA: bars }, {
      universeEligibility: (_code, date, phase) => phase === "signal" && date.startsWith(excludedLabel)
        ? { eligible: false, reason: "metadata_unavailable" }
        : { eligible: true, observationId: "known" },
    });
    const explicitCash = result.find((frame) => frame.label === excludedLabel)!;

    expect(explicitCash).toBeDefined();
    expect(explicitCash.snapshots).toEqual([]);
    expect(explicitCash.nextMonthReturns).toEqual({});
  });

  test("does not use a forward endpoint after the final eligible date", () => {
    const bars = makeBars("AAA", 500);
    const baseline = buildMonthlyFrames({ AAA: bars });
    const target = baseline.find((frame) => {
      const next = followingMonth(frame.label);
      return bars.some((bar) => bar.tradingDate.startsWith(next) && bar.tradingDate.slice(8, 10) > "15");
    })!;
    const lastEligibleDate = `${followingMonth(target.label)}-15`;
    expect(() => buildMonthlyFrames({ AAA: bars }, {
      universeEligibility: (_code, date) => date <= lastEligibleDate
        ? { eligible: true, observationId: "lifecycle-v1", lastEligibleDate }
        : { eligible: false, reason: "past_last_eligible_date", observationId: "lifecycle-v1", lastEligibleDate },
    })).toThrow(/Cannot construct a Point-in-Time forward return.*past_last_eligible_date/);
  });

  test("does not use a forward endpoint after its Universe status becomes ineligible", () => {
    const bars = makeBars("AAA", 500);
    const baseline = buildMonthlyFrames({ AAA: bars });
    const target = baseline[0]!;

    expect(() => buildMonthlyFrames({ AAA: bars }, {
      universeEligibility: (_code, _date, phase) => phase === "signal"
        ? { eligible: true, observationId: "status-v1", status: "test_candidate" }
        : {
            eligible: false,
            reason: "status_not_enabled",
            observationId: "status-v2",
            status: "disabled",
          },
    })).toThrow(new RegExp(
      `Cannot construct a Point-in-Time forward return for AAA in frame ${target.label}.*status_not_enabled`,
    ));
  });
});
