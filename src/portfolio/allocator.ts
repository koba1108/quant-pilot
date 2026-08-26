import type { RankedAsset } from "../strategies/types.ts";

export type Weights = Record<string, number>;

export const MAX_PORTFOLIO_ASSETS = 3;

export function inverseVolWeights(ranked: RankedAsset[], maxAssets = 3): Weights {
  if (!Number.isInteger(maxAssets) || maxAssets < 1 || maxAssets > MAX_PORTFOLIO_ASSETS) {
    throw new Error(`maxAssets must be an integer from 1 to ${MAX_PORTFOLIO_ASSETS}; received ${maxAssets}.`);
  }
  const selected = ranked.slice(0, maxAssets).filter((x) => x.volatility > 0);
  if (selected.length === 0) return { CASH: 1 };

  const inv = selected.map((x) => 1 / x.volatility);
  const total = inv.reduce((a, b) => a + b, 0);
  const weights: Weights = {};
  selected.forEach((x, i) => {
    weights[x.code] = inv[i]! / total;
  });
  weights.CASH = Math.max(0, 1 - Object.values(weights).reduce((a, b) => a + b, 0));
  return weights;
}
