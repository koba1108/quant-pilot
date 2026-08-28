import {
  defaultEligibilityPolicy,
  type EligibilityPolicy,
  type UniverseMember,
} from "./models.ts";

function activeOn(member: UniverseMember, asOf: string): boolean {
  return member.listingDate <= asOf && (member.delistingDate === undefined || asOf <= member.delistingDate);
}

export type EligibilityMetric = "history_days" | "monthly_trading_value_jpy" | "spread_bps";

export interface PointInTimeEligibilityObservation {
  observationId: string;
  code: string;
  metric: EligibilityMetric;
  value: number;
  observedAt: string;
  availableAt: string;
  sourceId: string;
  recordId: string;
}

export type UniverseEligibilityExclusion =
  | "not_active"
  | "missing_history"
  | "insufficient_history"
  | "missing_trading_value"
  | "insufficient_trading_value"
  | "missing_spread"
  | "spread_too_wide";

export interface UniverseEligibilityDiagnostic {
  code: string;
  eligible: boolean;
  reason?: UniverseEligibilityExclusion;
  appliedObservationIds: string[];
}

export interface PointInTimeUniverseResolution {
  members: UniverseMember[];
  diagnostics: UniverseEligibilityDiagnostic[];
}

function cutoffAtEndOfDay(asOf: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`Invalid universe asOf date: ${asOf}.`);
  const cutoff = Date.parse(`${asOf}T23:59:59.999Z`);
  if (!Number.isFinite(cutoff) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) {
    throw new Error(`Invalid universe asOf date: ${asOf}.`);
  }
  return cutoff;
}

function latestMetric(
  observations: readonly PointInTimeEligibilityObservation[],
  code: string,
  metric: EligibilityMetric,
  cutoff: number,
): PointInTimeEligibilityObservation | undefined {
  const eligible = observations
    .filter((observation) => observation.code === code && observation.metric === metric)
    .filter((observation) => Number.isFinite(Date.parse(observation.observedAt)))
    .filter((observation) => Number.isFinite(Date.parse(observation.availableAt)))
    .filter((observation) => Date.parse(observation.observedAt) <= Date.parse(observation.availableAt))
    .filter((observation) => Date.parse(observation.availableAt) <= cutoff)
    .sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt)
      || left.observationId.localeCompare(right.observationId));
  const selected = eligible.at(-1);
  if (selected !== undefined && (!Number.isFinite(selected.value) || selected.value < 0)) {
    throw new Error(`Invalid ${metric} observation ${selected.observationId} for ${code}.`);
  }
  return selected;
}

export function resolvePointInTimeUniverseWithDiagnostics(
  members: Iterable<UniverseMember>,
  asOf: string,
  observations: readonly PointInTimeEligibilityObservation[],
  policy: EligibilityPolicy,
): PointInTimeUniverseResolution {
  const cutoff = cutoffAtEndOfDay(asOf);
  const diagnostics: UniverseEligibilityDiagnostic[] = [];
  const included: UniverseMember[] = [];
  for (const member of [...members].sort((left, right) => left.code.localeCompare(right.code))) {
    const diagnostic: UniverseEligibilityDiagnostic = {
      code: member.code,
      eligible: false,
      appliedObservationIds: [],
    };
    diagnostics.push(diagnostic);
    if (!activeOn(member, asOf)) {
      diagnostic.reason = "not_active";
      continue;
    }
    const history = latestMetric(observations, member.code, "history_days", cutoff);
    if (history === undefined) {
      diagnostic.reason = "missing_history";
      continue;
    }
    diagnostic.appliedObservationIds.push(history.observationId);
    const minHistory = member.theme ? policy.minHistoryDaysTheme : policy.minHistoryDaysCore;
    if (history.value < Math.max(minHistory, member.minHistoryDays ?? policy.minHistoryDaysCore)) {
      diagnostic.reason = "insufficient_history";
      continue;
    }
    const tradingValue = latestMetric(observations, member.code, "monthly_trading_value_jpy", cutoff);
    if (tradingValue === undefined) {
      diagnostic.reason = "missing_trading_value";
      continue;
    }
    diagnostic.appliedObservationIds.push(tradingValue.observationId);
    if (tradingValue.value < policy.minMonthlyTradingValueJpy) {
      diagnostic.reason = "insufficient_trading_value";
      continue;
    }
    const spread = latestMetric(observations, member.code, "spread_bps", cutoff);
    if (spread === undefined) {
      diagnostic.reason = "missing_spread";
      continue;
    }
    diagnostic.appliedObservationIds.push(spread.observationId);
    const maxSpread = member.theme ? policy.maxSpreadBpsTheme : policy.maxSpreadBpsCore;
    if (spread.value > maxSpread) {
      diagnostic.reason = "spread_too_wide";
      continue;
    }
    diagnostic.eligible = true;
    included.push(member);
  }
  return { members: included, diagnostics };
}

export function resolvePointInTimeUniverse(
  members: Iterable<UniverseMember>,
  asOf: string,
  historyDays: Record<string, number>,
  monthlyTradingValue: Record<string, number>,
  latestSpreadBps: Record<string, number | undefined>,
  policy: EligibilityPolicy = defaultEligibilityPolicy,
): UniverseMember[] {
  const output: UniverseMember[] = [];
  for (const member of members) {
    if (!activeOn(member, asOf)) continue;
    const minHistory = member.theme ? policy.minHistoryDaysTheme : policy.minHistoryDaysCore;
    if ((historyDays[member.code] ?? 0) < Math.max(minHistory, member.minHistoryDays ?? 252)) continue;
    if ((monthlyTradingValue[member.code] ?? 0) < policy.minMonthlyTradingValueJpy) continue;
    const maxSpread = member.theme ? policy.maxSpreadBpsTheme : policy.maxSpreadBpsCore;
    const spread = latestSpreadBps[member.code];
    if (spread !== undefined && spread > maxSpread) continue;
    output.push(member);
  }
  return output;
}
