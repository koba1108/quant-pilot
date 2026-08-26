import {
  defaultEligibilityPolicy,
  type EligibilityPolicy,
  type UniverseMember,
} from "./models.ts";

function activeOn(member: UniverseMember, asOf: string): boolean {
  return member.listingDate <= asOf && (member.delistingDate === undefined || asOf < member.delistingDate);
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
