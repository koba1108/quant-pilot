import type { AssetSnapshot, RankedAsset, TrendStrategyParameters } from "./types.ts";
import { compareText } from "../determinism.ts";

export const TREND_STRATEGY_VERSION = "trend-v1" as const;
export const DEFAULT_TREND_PARAMETERS: TrendStrategyParameters = {
  r3mWeight: 0.2,
  r6mWeight: 0.3,
  r12mWeight: 0.5,
  requirePositiveR12m: true,
};

export function validateTrendParameters(parameters: TrendStrategyParameters): TrendStrategyParameters {
  for (const [field, value] of [
    ["r3mWeight", parameters.r3mWeight],
    ["r6mWeight", parameters.r6mWeight],
    ["r12mWeight", parameters.r12mWeight],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Trend ${field} must be between zero and one.`);
    }
  }
  const sum = parameters.r3mWeight + parameters.r6mWeight + parameters.r12mWeight;
  if (Math.abs(sum - 1) > 1e-12) throw new Error(`Trend momentum weights must sum to one; received ${sum}.`);
  if (typeof parameters.requirePositiveR12m !== "boolean") {
    throw new Error("Trend requirePositiveR12m must be boolean.");
  }
  return { ...parameters };
}

export function rankTrend(
  snapshots: Iterable<AssetSnapshot>,
  parameters: TrendStrategyParameters = DEFAULT_TREND_PARAMETERS,
): RankedAsset[] {
  const validated = validateTrendParameters(parameters);
  const ranked: RankedAsset[] = [];
  for (const s of snapshots) {
    const eligible = s.eligible ?? true;
    if (!eligible || (validated.requirePositiveR12m && s.r12m <= 0) || s.volatility <= 0) continue;
    const score = validated.r3mWeight * s.r3m
      + validated.r6mWeight * s.r6m
      + validated.r12mWeight * s.r12m;
    ranked.push({ code: s.code, score, volatility: s.volatility });
  }
  return ranked.sort((a, b) => b.score - a.score || compareText(a.code, b.code));
}
