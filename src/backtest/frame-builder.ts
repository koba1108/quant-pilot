import type { DailyBar } from "../data/models.ts";
import { sha256Canonical } from "../data/provenance.ts";
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
  returnNormalizationExclusions?: Record<string, number>;
  returnNormalizationDecisions?: PointInTimeReturnDecisionAudit[];
}

export interface FrameBuildResult {
  frames: MonthlyFrame[];
  assetDiagnostics: AssetFrameDiagnostic[];
}

export interface PointInTimeReturnSnapshot {
  code: string;
  decisionDate: string;
  sourceCurrency: string;
  currency: "JPY";
  basis: "price_return" | "total_return";
  normalizationVersion: string;
  policyId?: string;
  fxNormalizationVersion?: string;
  fxContractId?: string;
  inputFingerprint: string;
  snapshotFingerprint: string;
  pinnedPrefixFingerprint?: string;
  bars: DailyBar[];
  selectedBarObservationIds: readonly string[];
  appliedReturnEventIds: readonly string[];
  appliedFxObservationIds: readonly string[];
}

export interface PointInTimeReturnDecisionAudit {
  frameLabel: string;
  phase: "signal" | "forward_endpoint";
  cutoffDate: string;
  firstTradingDate: string;
  lastTradingDate: string;
  sourceCurrency: string;
  currency: "JPY";
  basis: "price_return" | "total_return";
  normalizationVersion: string;
  policyId?: string;
  fxNormalizationVersion?: string;
  fxContractId?: string;
  inputFingerprint: string;
  snapshotFingerprint: string;
  pinnedPrefixFingerprint?: string;
  barObservationCount: number;
  barObservationIdsHash: string;
  appliedReturnEventIds: readonly string[];
  fxObservationCount: number;
  fxObservationIdsHash?: string;
}

export interface PointInTimeFrameBuilderRequest {
  codes: readonly string[];
  start: string;
  end: string;
  resolveReturnSnapshot: (
    code: string,
    decisionDate: string,
    pinnedPrefix?: PointInTimeReturnSnapshot,
  ) => PointInTimeReturnSnapshot | undefined;
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

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function monthEnd(label: string): string {
  if (!/^\d{4}-\d{2}$/.test(label)) throw new Error(`Invalid month label: ${label}.`);
  const [year, month] = label.split("-").map(Number);
  if (month! < 1 || month! > 12) throw new Error(`Invalid month label: ${label}.`);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

function monthLabels(start: string, end: string): string[] {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    throw new Error(`Point-in-Time frame range must be ordered ISO dates; received ${start}..${end}.`);
  }
  const labels: string[] = [];
  let label = monthKey(start);
  const last = monthKey(end);
  while (label <= last) {
    labels.push(label);
    label = followingMonth(label);
  }
  return labels;
}

function incrementReason(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function assertSnapshot(
  snapshot: PointInTimeReturnSnapshot,
  code: string,
  cutoffDate: string,
): void {
  if (snapshot.code !== code) {
    throw new Error(`Point-in-Time return resolver returned ${snapshot.code}; expected ${code}.`);
  }
  if (snapshot.decisionDate !== cutoffDate) {
    throw new Error(
      `Point-in-Time return snapshot for ${code} has decisionDate ${snapshot.decisionDate}; expected ${cutoffDate}.`,
    );
  }
  if (snapshot.currency !== "JPY") {
    throw new Error(`Point-in-Time return snapshot for ${code} is not normalized to JPY.`);
  }
  if (snapshot.bars.length === 0) {
    throw new Error(`Point-in-Time return snapshot for ${code} on ${cutoffDate} has no bars.`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(snapshot.inputFingerprint)
    || !/^sha256:[0-9a-f]{64}$/.test(snapshot.snapshotFingerprint)) {
    throw new Error(`Point-in-Time return snapshot fingerprints are invalid for ${code} on ${cutoffDate}.`);
  }
  let previousDate = "";
  for (const bar of snapshot.bars) {
    if (bar.code !== code || !isIsoDate(bar.tradingDate) || bar.tradingDate > cutoffDate) {
      throw new Error(`Point-in-Time return snapshot for ${code} contains an invalid bar ${bar.tradingDate}.`);
    }
    if (previousDate !== "" && bar.tradingDate <= previousDate) {
      throw new Error(`Point-in-Time return snapshot bars are duplicated or unordered for ${code}.`);
    }
    if (!Number.isFinite(bar.adjustedClose) || bar.adjustedClose <= 0) {
      throw new Error(`Point-in-Time normalized value is invalid for ${code} on ${bar.tradingDate}.`);
    }
    previousDate = bar.tradingDate;
  }
  if (snapshot.selectedBarObservationIds.length !== snapshot.bars.length) {
    throw new Error(
      `Point-in-Time return snapshot for ${code} must bind one selected bar observation to each normalized bar.`,
    );
  }
  for (const [field, ids] of [
    ["selectedBarObservationIds", snapshot.selectedBarObservationIds],
    ["appliedReturnEventIds", snapshot.appliedReturnEventIds],
    ["appliedFxObservationIds", snapshot.appliedFxObservationIds],
  ] as const) {
    if (ids.some((id) => id.trim() === "") || new Set(ids).size !== ids.length) {
      throw new Error(`Point-in-Time return snapshot ${field} is empty or duplicated for ${code}.`);
    }
  }
}

function returnDecisionAudit(
  snapshot: PointInTimeReturnSnapshot,
  frameLabel: string,
  phase: PointInTimeReturnDecisionAudit["phase"],
): PointInTimeReturnDecisionAudit {
  return {
    frameLabel,
    phase,
    cutoffDate: snapshot.decisionDate,
    firstTradingDate: snapshot.bars[0]!.tradingDate,
    lastTradingDate: snapshot.bars.at(-1)!.tradingDate,
    sourceCurrency: snapshot.sourceCurrency,
    currency: snapshot.currency,
    basis: snapshot.basis,
    normalizationVersion: snapshot.normalizationVersion,
    policyId: snapshot.policyId,
    fxNormalizationVersion: snapshot.fxNormalizationVersion,
    fxContractId: snapshot.fxContractId,
    inputFingerprint: snapshot.inputFingerprint,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    pinnedPrefixFingerprint: snapshot.pinnedPrefixFingerprint,
    barObservationCount: snapshot.selectedBarObservationIds.length,
    barObservationIdsHash: sha256Canonical(snapshot.selectedBarObservationIds),
    appliedReturnEventIds: [...snapshot.appliedReturnEventIds].sort(compareText),
    fxObservationCount: snapshot.appliedFxObservationIds.length,
    fxObservationIdsHash: snapshot.appliedFxObservationIds.length === 0
      ? undefined
      : sha256Canonical(snapshot.appliedFxObservationIds),
  };
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
      frames.push({
        label,
        returnLabel: nextLabel,
        decisionDate,
        snapshots,
        nextMonthReturns,
        costRates,
        cashReturn: 0,
      });
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

/**
 * Builds close-to-next-month-close frames from a resolver that recreates the
 * normalized JPY series at each information cutoff. Signal metrics are always
 * taken from the signal snapshot. The later forward-endpoint snapshot must pin
 * that complete prefix and add only observations after the signal cutoff.
 */
export function buildPointInTimeMonthlyFramesWithDiagnostics(
  request: PointInTimeFrameBuilderRequest,
  options: Omit<FrameBuilderOptions, "priceField"> = {},
): FrameBuildResult {
  const costRate = options.costRate ?? 0.001;
  const minHistoryDays = options.minHistoryDays ?? 252;
  const volatilityWindowDays = options.volatilityWindowDays ?? 63;
  if (!Number.isFinite(costRate) || costRate < 0 || costRate >= 1) {
    throw new Error(`costRate must be finite from 0 (inclusive) to 1 (exclusive); received ${costRate}.`);
  }
  if (!Number.isInteger(minHistoryDays) || minHistoryDays < 1) {
    throw new Error(`minHistoryDays must be a positive integer; received ${minHistoryDays}.`);
  }
  if (!Number.isInteger(volatilityWindowDays) || volatilityWindowDays < 2 || volatilityWindowDays > 252) {
    throw new Error(`volatilityWindowDays must be an integer from 2 to 252; received ${volatilityWindowDays}.`);
  }
  if (!Array.isArray(request.codes) || request.codes.length === 0) {
    throw new Error("Point-in-Time frame construction requires at least one asset code.");
  }
  const codes = [...request.codes].sort(compareText);
  if (codes.some((code) => code.trim() === "") || new Set(codes).size !== codes.length) {
    throw new Error("Point-in-Time frame asset codes must be non-empty and unique.");
  }
  const labels = monthLabels(request.start, request.end);
  if (request.end !== monthEnd(monthKey(request.end))) {
    throw new Error(
      `Point-in-Time monthly frame end must be a calendar month-end; received ${request.end}. Partial months are not annualized as full months.`,
    );
  }
  const labelSet = new Set(labels);
  const requiredHistoryBars = Math.max(minHistoryDays, 252) + 1;
  const frames: MonthlyFrame[] = [];
  const assetDiagnostics: AssetFrameDiagnostic[] = codes.map((code) => ({
    code,
    barCount: 0,
    eligibleFrameCount: 0,
    universeObservationIds: options.universeEligibility === undefined ? undefined : [],
    universeExclusions: options.universeEligibility === undefined ? undefined : {},
    universeDecisions: options.universeEligibility === undefined ? undefined : [],
    returnNormalizationExclusions: {},
    returnNormalizationDecisions: [],
  }));
  const diagnosticByCode = new Map(assetDiagnostics.map((diagnostic) => [diagnostic.code, diagnostic]));

  for (const label of labels) {
    const nextLabel = followingMonth(label);
    if (!labelSet.has(nextLabel)) continue;
    const signalMonthCutoff = monthEnd(label);
    const forwardMonthCutoff = monthEnd(nextLabel);
    const snapshots: AssetSnapshot[] = [];
    const nextMonthReturns: Record<string, number> = {};
    const costRates: Record<string, number> = {};
    const frameDecisionDates: string[] = [];
    let hasUsableHistory = false;

    for (const code of codes) {
      costRates[code] = costRate;
      const diagnostic = diagnosticByCode.get(code)!;
      const signalProbe = request.resolveReturnSnapshot(code, signalMonthCutoff);
      if (signalProbe === undefined) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "missing_signal_snapshot");
        continue;
      }
      assertSnapshot(signalProbe, code, signalMonthCutoff);
      const probeSignalBars = signalProbe.bars.filter(
        (bar) => bar.tradingDate >= request.start && bar.tradingDate <= signalMonthCutoff,
      );
      const probeCurrentIndex = lastIndexInMonth(probeSignalBars, label);
      if (probeCurrentIndex < 0) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "missing_signal_month_bar");
        continue;
      }
      const signalCutoff = probeSignalBars[probeCurrentIndex]!.tradingDate;
      const signalSnapshot = signalCutoff === signalMonthCutoff
        ? signalProbe
        : request.resolveReturnSnapshot(code, signalCutoff);
      if (signalSnapshot === undefined) {
        throw new Error(
          `Cannot construct a Point-in-Time normalized signal for ${code} in frame ${label}: the month-end bar was not available on its trading date ${signalCutoff}.`,
        );
      }
      assertSnapshot(signalSnapshot, code, signalCutoff);
      const signalBars = signalSnapshot.bars.filter(
        (bar) => bar.tradingDate >= request.start && bar.tradingDate <= signalCutoff,
      );
      diagnostic.barCount = Math.max(diagnostic.barCount, signalBars.length);
      if (signalBars[0] !== undefined
        && (diagnostic.firstDate === undefined || signalBars[0].tradingDate < diagnostic.firstDate)) {
        diagnostic.firstDate = signalBars[0].tradingDate;
      }
      if (signalBars.at(-1) !== undefined
        && (diagnostic.lastDate === undefined || signalBars.at(-1)!.tradingDate > diagnostic.lastDate)) {
        diagnostic.lastDate = signalBars.at(-1)!.tradingDate;
      }
      const currentIndex = lastIndexInMonth(signalBars, label);
      if (currentIndex < 0) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "missing_signal_month_bar");
        continue;
      }
      if (currentIndex + 1 < requiredHistoryBars) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "insufficient_history");
        continue;
      }

      const currentBar = signalBars[currentIndex]!;
      const current = currentBar.adjustedClose;
      const p3 = signalBars[currentIndex - 63]?.adjustedClose;
      const p6 = signalBars[currentIndex - 126]?.adjustedClose;
      const p12 = signalBars[currentIndex - 252]?.adjustedClose;
      if (!p3 || !p6 || !p12 || current <= 0) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "invalid_signal_history");
        continue;
      }
      hasUsableHistory = true;
      frameDecisionDates.push(currentBar.tradingDate);
      diagnostic.returnNormalizationDecisions!.push(
        returnDecisionAudit(signalSnapshot, label, "signal"),
      );

      if (options.universeEligibility !== undefined) {
        const membership = options.universeEligibility(code, currentBar.tradingDate, "signal");
        diagnostic.universeDecisions!.push({
          ...membership,
          frameLabel: label,
          phase: "signal",
          date: currentBar.tradingDate,
        });
        if (membership.observationId !== undefined
          && !diagnostic.universeObservationIds!.includes(membership.observationId)) {
          diagnostic.universeObservationIds!.push(membership.observationId);
        }
        if (!membership.eligible) {
          const reason = membership.reason ?? "not_eligible";
          incrementReason(diagnostic.universeExclusions!, reason);
          continue;
        }
      }

      const forwardProbe = request.resolveReturnSnapshot(code, forwardMonthCutoff, signalSnapshot);
      if (forwardProbe === undefined) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "missing_forward_snapshot");
        throw new Error(
          `Cannot construct a Point-in-Time normalized forward return for ${code} in frame ${label}: no snapshot is available at ${forwardMonthCutoff}.`,
        );
      }
      assertSnapshot(forwardProbe, code, forwardMonthCutoff);
      const probeForwardBars = forwardProbe.bars.filter(
        (bar) => bar.tradingDate >= request.start && bar.tradingDate <= forwardMonthCutoff,
      );
      const probeNextIndex = lastIndexInMonth(probeForwardBars, nextLabel);
      const probeNextBar = probeNextIndex < 0 ? undefined : probeForwardBars[probeNextIndex];
      if (probeNextBar === undefined || probeNextBar.tradingDate <= currentBar.tradingDate) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "missing_forward_endpoint");
        throw new Error(
          `Cannot construct a Point-in-Time normalized forward return for ${code} in frame ${label}: a next-month endpoint is required.`,
        );
      }
      const forwardCutoff = probeNextBar.tradingDate;
      const forwardSnapshot = forwardCutoff === forwardMonthCutoff
        ? forwardProbe
        : request.resolveReturnSnapshot(code, forwardCutoff, signalSnapshot);
      if (forwardSnapshot === undefined) {
        throw new Error(
          `Cannot construct a Point-in-Time normalized forward return for ${code} in frame ${label}: the endpoint was not available on its trading date ${forwardCutoff}.`,
        );
      }
      assertSnapshot(forwardSnapshot, code, forwardCutoff);
      if (forwardSnapshot.inputFingerprint !== signalSnapshot.inputFingerprint
        || forwardSnapshot.basis !== signalSnapshot.basis
        || forwardSnapshot.sourceCurrency !== signalSnapshot.sourceCurrency
        || forwardSnapshot.normalizationVersion !== signalSnapshot.normalizationVersion
        || forwardSnapshot.policyId !== signalSnapshot.policyId
        || forwardSnapshot.fxNormalizationVersion !== signalSnapshot.fxNormalizationVersion
        || forwardSnapshot.fxContractId !== signalSnapshot.fxContractId) {
        throw new Error(
          `Point-in-Time normalized source or policy identity changed between signal and forward snapshots for ${code} in frame ${label}.`,
        );
      }
      if (forwardSnapshot.pinnedPrefixFingerprint !== signalSnapshot.snapshotFingerprint) {
        throw new Error(
          `Point-in-Time forward snapshot for ${code} in frame ${label} is not bound to its signal snapshot.`,
        );
      }
      const forwardPrefixBars = forwardSnapshot.bars.filter((bar) => bar.tradingDate <= signalCutoff);
      const forwardPrefixObservationIds = forwardSnapshot.selectedBarObservationIds.slice(
        0,
        signalSnapshot.selectedBarObservationIds.length,
      );
      const forwardPrefixFxObservationIds = forwardSnapshot.appliedFxObservationIds.slice(
        0,
        signalSnapshot.appliedFxObservationIds.length,
      );
      if (sha256Canonical(forwardPrefixBars) !== sha256Canonical(signalSnapshot.bars)
        || sha256Canonical(forwardPrefixObservationIds)
          !== sha256Canonical(signalSnapshot.selectedBarObservationIds)
        || sha256Canonical(forwardPrefixFxObservationIds)
          !== sha256Canonical(signalSnapshot.appliedFxObservationIds)) {
        throw new Error(
          `Point-in-Time forward snapshot for ${code} in frame ${label} changed its pinned signal prefix.`,
        );
      }
      const forwardBars = forwardSnapshot.bars.filter(
        (bar) => bar.tradingDate >= request.start && bar.tradingDate <= forwardCutoff,
      );
      const entryBar = forwardBars.find((bar) => bar.tradingDate === currentBar.tradingDate);
      const nextIndex = lastIndexInMonth(forwardBars, nextLabel);
      const nextBar = nextIndex < 0 ? undefined : forwardBars[nextIndex];
      if (entryBar === undefined || nextBar === undefined || nextBar.tradingDate <= currentBar.tradingDate) {
        incrementReason(diagnostic.returnNormalizationExclusions!, "missing_forward_endpoint");
        throw new Error(
          `Cannot construct a Point-in-Time normalized forward return for ${code} in frame ${label}: exact signal and next-month endpoints are required.`,
        );
      }
      diagnostic.lastDate = diagnostic.lastDate === undefined || nextBar.tradingDate > diagnostic.lastDate
        ? nextBar.tradingDate
        : diagnostic.lastDate;
      diagnostic.returnNormalizationDecisions!.push(
        returnDecisionAudit(forwardSnapshot, label, "forward_endpoint"),
      );

      if (options.universeEligibility !== undefined) {
        const forwardMembership = options.universeEligibility(code, nextBar.tradingDate, "forward_endpoint");
        diagnostic.universeDecisions!.push({
          ...forwardMembership,
          frameLabel: label,
          phase: "forward_endpoint",
          date: nextBar.tradingDate,
        });
        if (forwardMembership.observationId !== undefined
          && !diagnostic.universeObservationIds!.includes(forwardMembership.observationId)) {
          diagnostic.universeObservationIds!.push(forwardMembership.observationId);
        }
        if (!forwardMembership.eligible) {
          const reason = `forward_${forwardMembership.reason ?? "not_eligible"}`;
          incrementReason(diagnostic.universeExclusions!, reason);
          throw new Error(
            `Cannot construct a Point-in-Time forward return for ${code} in frame ${label}: endpoint ${nextBar.tradingDate} is ${forwardMembership.reason ?? "not eligible"}.`,
          );
        }
      }

      const volWindow = signalBars.slice(
        Math.max(0, currentIndex - volatilityWindowDays),
        currentIndex + 1,
      ).map((bar) => bar.adjustedClose);
      snapshots.push({
        code,
        r3m: current / p3 - 1,
        r6m: current / p6 - 1,
        r12m: current / p12 - 1,
        volatility: annualizedVolatility(volWindow),
        eligible: true,
      });
      nextMonthReturns[code] = nextBar.adjustedClose / currentBar.adjustedClose - 1;
      diagnostic.eligibleFrameCount += 1;
    }

    const decisionDate = frameDecisionDates.sort(compareText).at(-1);
    if (hasUsableHistory && decisionDate !== undefined) {
      frames.push({
        label,
        returnLabel: nextLabel,
        decisionDate,
        snapshots,
        nextMonthReturns,
        costRates,
        cashReturn: 0,
      });
    }
  }

  for (const diagnostic of assetDiagnostics) {
    diagnostic.universeObservationIds?.sort(compareText);
    diagnostic.universeDecisions?.sort((left, right) => compareText(left.frameLabel, right.frameLabel)
      || compareText(left.phase, right.phase)
      || compareText(left.date, right.date));
    diagnostic.returnNormalizationDecisions?.sort(
      (left, right) => compareText(left.frameLabel, right.frameLabel)
        || compareText(left.phase, right.phase)
        || compareText(left.cutoffDate, right.cutoffDate),
    );
    if (diagnostic.eligibleFrameCount > 0) continue;
    const normalizationSummary = Object.entries(diagnostic.returnNormalizationExclusions ?? {})
      .sort(([left], [right]) => compareText(left, right))
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    const universeSummary = Object.entries(diagnostic.universeExclusions ?? {})
      .sort(([left], [right]) => compareText(left, right))
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    diagnostic.exclusionReason = diagnostic.barCount < requiredHistoryBars
      ? `Insufficient Point-in-Time normalized history: ${diagnostic.barCount} bars available; at least ${requiredHistoryBars} are required.`
      : universeSummary !== ""
      ? `No eligible frame remains after Point-in-Time Universe filtering: ${universeSummary}.`
      : `No normalized signal/forward-return pair remains: ${normalizationSummary || "no eligible endpoints"}.`;
  }

  return { frames, assetDiagnostics };
}

export function buildMonthlyFrames(
  series: Record<string, DailyBar[]>,
  options: FrameBuilderOptions = {},
): MonthlyFrame[] {
  return buildMonthlyFramesWithDiagnostics(series, options).frames;
}
