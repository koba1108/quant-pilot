import type { DailyBar } from "../data/models.ts";
import type { AssetSnapshot } from "../strategies/types.ts";
import type { MonthlyFrame } from "./simulator.ts";
import { compareText } from "../determinism.ts";

export interface UniverseEligibilityResult {
  eligible: boolean;
  reason?: string;
  observationId?: string;
  status?: string;
  listingDate?: string;
  lastEligibleDate?: string;
  observedAt?: string;
  availableAt?: string;
  retrievedAt?: string;
  source?: string;
  dataset?: string;
  sourceVersion?: string;
  recordId?: string;
  instrumentType?: string;
  isUsEquity?: boolean;
  isCryptoAsset?: boolean;
  isLeveraged?: boolean;
  isInverse?: boolean;
  currency?: string;
}

export interface UniverseDecisionAudit extends UniverseEligibilityResult {
  frameLabel: string;
  phase: "signal" | "forward_endpoint";
  date: string;
}

export interface FrameBuilderOptions {
  costRate?: number;
  minHistoryDays?: number;
  priceField?: "close" | "adjustedClose";
  volatilityWindowDays?: number;
  universeEligibility?: (
    code: string,
    decisionDate: string,
    phase: "signal" | "forward_endpoint",
  ) => UniverseEligibilityResult;
}

export interface AssetFrameDiagnostic {
  code: string;
  barCount: number;
  firstDate?: string;
  lastDate?: string;
  eligibleFrameCount: number;
  exclusionReason?: string;
  universeObservationIds?: string[];
  universeExclusions?: Record<string, number>;
  universeDecisions?: UniverseDecisionAudit[];
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
  for (const bar of [...bars].sort((a, b) => compareText(a.tradingDate, b.tradingDate))) {
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
  const volatilityWindowDays = options.volatilityWindowDays ?? 63;
  if (!Number.isInteger(volatilityWindowDays) || volatilityWindowDays < 2 || volatilityWindowDays > 252) {
    throw new Error(`volatilityWindowDays must be an integer from 2 to 252; received ${volatilityWindowDays}.`);
  }
  const requiredHistoryBars = Math.max(minHistoryDays, 252) + 1;
  const sortedSeries = new Map(
    Object.entries(series).sort(([left], [right]) => compareText(left, right)).map(([code, bars]) => [
      code,
      [...bars].sort((a, b) => compareText(a.tradingDate, b.tradingDate)),
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
    universeObservationIds: options.universeEligibility === undefined ? undefined : [],
    universeExclusions: options.universeEligibility === undefined ? undefined : {},
    universeDecisions: options.universeEligibility === undefined ? undefined : [],
  }));
  const diagnosticByCode = new Map(assetDiagnostics.map((diagnostic) => [diagnostic.code, diagnostic]));

  for (const label of labels) {
    const nextLabel = followingMonth(label);
    if (!labelSet.has(nextLabel)) continue;
    const snapshots: AssetSnapshot[] = [];
    const nextMonthReturns: Record<string, number> = {};
    const costRates: Record<string, number> = {};
    const frameDecisionDates: string[] = [];
    let hasUsableHistory = false;

    for (const [code, sorted] of sortedSeries) {
      costRates[code] = costRate;
      const currentIndex = lastIndexInMonth(sorted, label);
      const nextIndex = lastIndexInMonth(sorted, nextLabel);
      if (currentIndex + 1 < requiredHistoryBars || nextIndex <= currentIndex) continue;

      const currentBar = sorted[currentIndex]!;
      const nextBar = sorted[nextIndex]!;
      const current = currentBar[priceField];
      const p3 = sorted[currentIndex - 63]?.[priceField];
      const p6 = sorted[currentIndex - 126]?.[priceField];
      const p12 = sorted[currentIndex - 252]?.[priceField];
      if (!p3 || !p6 || !p12 || current <= 0) continue;
      hasUsableHistory = true;
      frameDecisionDates.push(currentBar.tradingDate);

      if (options.universeEligibility !== undefined) {
        const membership = options.universeEligibility(code, currentBar.tradingDate, "signal");
        const diagnostic = diagnosticByCode.get(code)!;
        diagnostic.universeDecisions!.push({
          ...membership,
          frameLabel: label,
          phase: "signal",
          date: currentBar.tradingDate,
        });
        if (membership.observationId !== undefined) {
          const ids = diagnostic.universeObservationIds!;
          if (!ids.includes(membership.observationId)) ids.push(membership.observationId);
        }
        if (!membership.eligible) {
          const reason = membership.reason ?? "not_eligible";
          diagnostic.universeExclusions![reason] = (diagnostic.universeExclusions![reason] ?? 0) + 1;
          continue;
        }
      }

      if (options.universeEligibility !== undefined) {
        const forwardMembership = options.universeEligibility(code, nextBar.tradingDate, "forward_endpoint");
        const diagnostic = diagnosticByCode.get(code)!;
        diagnostic.universeDecisions!.push({
          ...forwardMembership,
          frameLabel: label,
          phase: "forward_endpoint",
          date: nextBar.tradingDate,
        });
        if (forwardMembership.observationId !== undefined) {
          const ids = diagnostic.universeObservationIds!;
          if (!ids.includes(forwardMembership.observationId)) ids.push(forwardMembership.observationId);
        }
        if (!forwardMembership.eligible) {
          const reason = `forward_${forwardMembership.reason ?? "not_eligible"}`;
          diagnostic.universeExclusions![reason] = (diagnostic.universeExclusions![reason] ?? 0) + 1;
          throw new Error(
            `Cannot construct a Point-in-Time forward return for ${code} in frame ${label}: endpoint ${nextBar.tradingDate} is ${forwardMembership.reason ?? "not eligible"}.`,
          );
        }
      }
      const volWindow = sorted.slice(
        Math.max(0, currentIndex - volatilityWindowDays),
        currentIndex + 1,
      ).map((bar) => bar[priceField]);
      snapshots.push({
        code,
        r3m: current / p3 - 1,
        r6m: current / p6 - 1,
        r12m: current / p12 - 1,
        volatility: annualizedVolatility(volWindow),
        eligible: true,
      });
      nextMonthReturns[code] = nextBar[priceField] / current - 1;
      diagnosticByCode.get(code)!.eligibleFrameCount += 1;
    }

    const decisionDate = frameDecisionDates.sort(compareText).at(-1);
    if (hasUsableHistory && decisionDate !== undefined) {
      frames.push({ label, decisionDate, snapshots, nextMonthReturns, costRates, cashReturn: 0 });
    }
  }

  for (const diagnostic of assetDiagnostics) {
    diagnostic.universeObservationIds?.sort(compareText);
    diagnostic.universeDecisions?.sort((left, right) => compareText(left.frameLabel, right.frameLabel)
      || compareText(left.phase, right.phase)
      || compareText(left.date, right.date));
    if (diagnostic.eligibleFrameCount > 0) continue;
    const universeExclusions = diagnostic.universeExclusions ?? {};
    const universeSummary = Object.entries(universeExclusions)
      .sort(([left], [right]) => compareText(left, right))
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    const universeSuffix = universeSummary === "" ? "" : ` Point-in-Time Universe exclusions: ${universeSummary}.`;
    diagnostic.exclusionReason = diagnostic.barCount < requiredHistoryBars
      ? `Insufficient history: ${diagnostic.barCount} bars loaded; at least ${requiredHistoryBars} are required.${universeSuffix}`
      : universeSummary !== ""
      ? `No eligible frame remains after Point-in-Time Universe filtering: ${universeSummary}.`
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
