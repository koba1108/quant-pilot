import type { AssetSnapshot, RankedAsset } from "./types.ts";

function zscore(values: number[]): number[] {
  if (values.length === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 0);
  return values.map((x) => (x - mean) / std);
}

export function rankRotation(snapshots: Iterable<AssetSnapshot>): RankedAsset[] {
  const eligible = [...snapshots].filter(
    (s) => (s.eligible ?? true) && s.r12m > 0 && s.volatility > 0,
  );
  if (eligible.length === 0) return [];

  const z6 = zscore(eligible.map((s) => s.r6m));
  const z12 = zscore(eligible.map((s) => s.r12m));
  const zv = zscore(eligible.map((s) => s.volatility));

  return eligible
    .map((s, i) => ({
      code: s.code,
      score: 0.4 * z6[i]! + 0.4 * z12[i]! - 0.2 * zv[i]!,
      volatility: s.volatility,
    }))
    .sort((a, b) => b.score - a.score);
}
