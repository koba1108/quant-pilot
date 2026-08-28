import type { AssetSnapshot, RankedAsset, RotationStrategyParameters } from "./types.ts";
import { compareText } from "../determinism.ts";

export const ROTATION_STRATEGY_VERSION = "rotation-v1" as const;
export const DEFAULT_ROTATION_PARAMETERS: RotationStrategyParameters = {
  r6mWeight: 0.4,
  r12mWeight: 0.4,
  volatilityPenalty: 0.2,
  requirePositiveR12m: true,
};

export function validateRotationParameters(parameters: RotationStrategyParameters): RotationStrategyParameters {
  for (const [field, value] of [
    ["r6mWeight", parameters.r6mWeight],
    ["r12mWeight", parameters.r12mWeight],
    ["volatilityPenalty", parameters.volatilityPenalty],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Rotation ${field} must be between zero and one.`);
    }
  }
  const sum = parameters.r6mWeight + parameters.r12mWeight + parameters.volatilityPenalty;
  if (Math.abs(sum - 1) > 1e-12) throw new Error(`Rotation score weights must sum to one; received ${sum}.`);
  if (typeof parameters.requirePositiveR12m !== "boolean") {
    throw new Error("Rotation requirePositiveR12m must be boolean.");
  }
  return { ...parameters };
}

function zscore(values: number[]): number[] {
  if (values.length === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 0);
  return values.map((x) => (x - mean) / std);
}

export function rankRotation(
  snapshots: Iterable<AssetSnapshot>,
  parameters: RotationStrategyParameters = DEFAULT_ROTATION_PARAMETERS,
): RankedAsset[] {
  const validated = validateRotationParameters(parameters);
  const eligible = [...snapshots].filter(
    (s) => (s.eligible ?? true)
      && (!validated.requirePositiveR12m || s.r12m > 0)
      && s.volatility > 0,
  );
  if (eligible.length === 0) return [];

  const z6 = zscore(eligible.map((s) => s.r6m));
  const z12 = zscore(eligible.map((s) => s.r12m));
  const zv = zscore(eligible.map((s) => s.volatility));

  return eligible
    .map((s, i) => ({
      code: s.code,
      score: validated.r6mWeight * z6[i]!
        + validated.r12mWeight * z12[i]!
        - validated.volatilityPenalty * zv[i]!,
      volatility: s.volatility,
    }))
    .sort((a, b) => b.score - a.score || compareText(a.code, b.code));
}
