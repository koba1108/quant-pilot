import type { Weights } from "./allocator.ts";

export interface CostAssumptions {
  commissionBps: number;
  slippageBps: number;
  fallbackHalfSpreadBps: number;
  fxConversionBps: number;
}

export const defaultCostAssumptions: CostAssumptions = {
  commissionBps: 0,
  slippageBps: 5,
  fallbackHalfSpreadBps: 15,
  fxConversionBps: 0,
};

export function oneWayCostRate(
  spreadBps: number | undefined,
  assumptions: CostAssumptions = defaultCostAssumptions,
  foreignCurrencyTrade = false,
): number {
  const halfSpread = spreadBps === undefined ? assumptions.fallbackHalfSpreadBps : spreadBps / 2;
  let totalBps = assumptions.commissionBps + assumptions.slippageBps + halfSpread;
  if (foreignCurrencyTrade) totalBps += assumptions.fxConversionBps;
  return totalBps / 10_000;
}

export function turnoverCost(
  oldWeights: Weights,
  newWeights: Weights,
  perAssetCostRate: Record<string, number>,
): number {
  const assets = new Set([...Object.keys(oldWeights), ...Object.keys(newWeights)]);
  assets.delete("CASH");
  let total = 0;
  for (const asset of assets) {
    total += Math.abs((newWeights[asset] ?? 0) - (oldWeights[asset] ?? 0)) * (perAssetCostRate[asset] ?? 0);
  }
  return total;
}
