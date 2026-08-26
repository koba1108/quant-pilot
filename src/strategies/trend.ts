import type { AssetSnapshot, RankedAsset } from "./types.ts";

export function rankTrend(snapshots: Iterable<AssetSnapshot>): RankedAsset[] {
  const ranked: RankedAsset[] = [];
  for (const s of snapshots) {
    const eligible = s.eligible ?? true;
    if (!eligible || s.r12m <= 0 || s.volatility <= 0) continue;
    const score = 0.2 * s.r3m + 0.3 * s.r6m + 0.5 * s.r12m;
    ranked.push({ code: s.code, score, volatility: s.volatility });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
