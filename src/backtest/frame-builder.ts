import type { DailyBar } from "../data/models.ts";
import type { AssetSnapshot } from "../strategies/types.ts";
import type { MonthlyFrame } from "./simulator.ts";

export interface FrameBuilderOptions {
  costRate?: number;
  minHistoryDays?: number;
  priceField?: "close" | "adjustedClose";
}

export interface AssetFrameDiagnostic {
  code: string;
  barCount: number;
  firstDate?: string;
  lastDate?: string;
  eligibleFrameCount: number;
  exclusionReason?: string;
}

export interface FrameBuildResult {
  frames: MonthlyFrame[];
  assetDiagnostics: AssetFrameDiagnostic[];
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function followingMonth(label: string): string {
  const [year, month] = label.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month!, 1));
  return date.toISOString().slice(0, 7);
}

function annualizedVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i]! / prices[i - 1]!));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function monthEnds(bars: DailyBar[]): DailyBar[] {
  const byMonth = new Map<string, DailyBar>();
  for (const bar of [...bars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))) {
    byMonth.set(monthKey(bar.tradingDate), bar);
  }
  return [...byMonth.values()];
}

function lastIndexInMonth(bars: DailyBar[], label: string): number {
  for (let index = bars.length - 1; index >= 0; index--) {
    if (monthKey(bars[index]!.tradingDate) === label) return index;
  }
  return -1;
}

export function buildMonthlyFramesWithDiagnostics(
  series: Record<string, DailyBar[]>,
  options: FrameBuilderOptions = {},
): FrameBuildResult {
  const costRate = options.costRate ?? 0.001;
  const minHistoryDays = options.minHistoryDays ?? 252;
  const priceField = options.priceField ?? "adjustedClose";
  const requiredHistoryBars = Math.max(minHistoryDays, 252) + 1;
  const sortedSeries = new Map(
    Object.entries(series).map(([code, bars]) => [
      code,
      [...bars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate)),
    ]),
  );
  const monthly = new Map([...sortedSeries].map(([code, bars]) => [code, monthEnds(bars)]));
  const labels = [...new Set([...monthly.values()].flatMap((bars) => bars.map((b) => monthKey(b.tradingDate))))].sort();
  const labelSet = new Set(labels);
  const frames: MonthlyFrame[] = [];
  const assetDiagnostics: AssetFrameDiagnostic[] = [...sortedSeries].map(([code, bars]) => ({
    code,
    barCount: bars.length,
    firstDate: bars[0]?.tradingDate,
    lastDate: bars.at(-1)?.tradingDate,
    eligibleFrameCount: 0,
  }));
  const diagnosticByCode = new Map(assetDiagnostics.map((diagnostic) => [diagnostic.code, diagnostic]));

  for (const label of labels) {
    const nextLabel = followingMonth(label);
    if (!labelSet.has(nextLabel)) continue;
    const snapshots: AssetSnapshot[] = [];
    const nextMonthReturns: Record<string, number> = {};
    const costRates: Record<string, number> = {};

    for (const [code, sorted] of sortedSeries) {
      costRates[code] = costRate;
      const currentIndex = lastIndexInMonth(sorted, label);
      const nextIndex = lastIndexInMonth(sorted, nextLabel);
      if (currentIndex + 1 < requiredHistoryBars || nextIndex <= currentIndex) continue;

      const current = sorted[currentIndex]![priceField];
      const p3 = sorted[currentIndex - 63]?.[priceField];
      const p6 = sorted[currentIndex - 126]?.[priceField];
      const p12 = sorted[currentIndex - 252]?.[priceField];
      if (!p3 || !p6 || !p12 || current <= 0) continue;

      const volWindow = sorted.slice(Math.max(0, currentIndex - 63), currentIndex + 1).map((bar) => bar[priceField]);
      snapshots.push({
        code,
        r3m: current / p3 - 1,
        r6m: current / p6 - 1,
        r12m: current / p12 - 1,
        volatility: annualizedVolatility(volWindow),
        eligible: true,
      });
      nextMonthReturns[code] = sorted[nextIndex]![priceField] / current - 1;
      diagnosticByCode.get(code)!.eligibleFrameCount += 1;
    }

    if (snapshots.length > 0) {
      frames.push({ label, snapshots, nextMonthReturns, costRates, cashReturn: 0 });
    }
  }

  for (const diagnostic of assetDiagnostics) {
    if (diagnostic.eligibleFrameCount > 0) continue;
    diagnostic.exclusionReason = diagnostic.barCount < requiredHistoryBars
      ? `Insufficient history: ${diagnostic.barCount} bars loaded; at least ${requiredHistoryBars} are required.`
      : "No consecutive month-end signal/forward-return pair is available after the history requirement.";
  }

  return { frames, assetDiagnostics };
}

export function buildMonthlyFrames(
  series: Record<string, DailyBar[]>,
  options: FrameBuilderOptions = {},
): MonthlyFrame[] {
  return buildMonthlyFramesWithDiagnostics(series, options).frames;
}
