import type { DailyBar } from "../data/models.ts";
import type { AssetSnapshot } from "../strategies/types.ts";
import type { MonthlyFrame } from "./simulator.ts";

export interface FrameBuilderOptions {
  costRate?: number;
  minHistoryDays?: number;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
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

export function buildMonthlyFrames(
  series: Record<string, DailyBar[]>,
  options: FrameBuilderOptions = {},
): MonthlyFrame[] {
  const costRate = options.costRate ?? 0.001;
  const minHistoryDays = options.minHistoryDays ?? 252;
  const monthly = new Map(Object.entries(series).map(([code, bars]) => [code, monthEnds(bars)]));
  const labels = [...new Set([...monthly.values()].flatMap((bars) => bars.map((b) => monthKey(b.tradingDate))))].sort();
  const frames: MonthlyFrame[] = [];

  for (let li = 0; li < labels.length - 1; li++) {
    const label = labels[li]!;
    const nextLabel = labels[li + 1]!;
    const snapshots: AssetSnapshot[] = [];
    const nextMonthReturns: Record<string, number> = {};
    const costRates: Record<string, number> = {};

    for (const [code, dailyBars] of Object.entries(series)) {
      const sorted = [...dailyBars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
      const currentIndex = sorted.findLastIndex((b) => monthKey(b.tradingDate) === label);
      const nextIndex = sorted.findLastIndex((b) => monthKey(b.tradingDate) === nextLabel);
      if (currentIndex < minHistoryDays || nextIndex <= currentIndex) continue;

      const current = sorted[currentIndex]!.adjustedClose;
      const p3 = sorted[currentIndex - 63]?.adjustedClose;
      const p6 = sorted[currentIndex - 126]?.adjustedClose;
      const p12 = sorted[currentIndex - 252]?.adjustedClose;
      if (!p3 || !p6 || !p12 || current <= 0) continue;

      const volWindow = sorted.slice(Math.max(0, currentIndex - 63), currentIndex + 1).map((b) => b.adjustedClose);
      snapshots.push({
        code,
        r3m: current / p3 - 1,
        r6m: current / p6 - 1,
        r12m: current / p12 - 1,
        volatility: annualizedVolatility(volWindow),
        eligible: true,
      });
      nextMonthReturns[code] = sorted[nextIndex]!.adjustedClose / current - 1;
      costRates[code] = costRate;
    }

    if (snapshots.length > 0) {
      frames.push({ label, snapshots, nextMonthReturns, costRates, cashReturn: 0 });
    }
  }
  return frames;
}
