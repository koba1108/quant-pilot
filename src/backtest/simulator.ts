import type { AssetSnapshot, StrategyParameterOverrides } from "../strategies/types.ts";
import { rankTrend } from "../strategies/trend.ts";
import { rankRotation } from "../strategies/rotation.ts";
import { inverseVolWeights, MAX_PORTFOLIO_ASSETS, type Weights } from "../portfolio/allocator.ts";
import { turnoverCost } from "../portfolio/costs.ts";
import { hardStopTriggered } from "../portfolio/risk.ts";

export interface MonthlyFrame {
  label: string;
  decisionDate?: string;
  snapshots: AssetSnapshot[];
  nextMonthReturns: Record<string, number>;
  costRates: Record<string, number>;
  cashReturn?: number;
}

export interface SimulationResult {
  equityCurve: number[];
  monthlyReturns: number[];
  weightsHistory: Weights[];
  endingWeights: Weights;
  totalCostRate: number;
  totalTurnover: number;
  /** Mean cash allocation used during each monthly return period, before any end-of-period hard-stop liquidation. */
  averageCashWeight: number;
  stopped: boolean;
  stopLabel?: string;
}

function grossTurnover(oldWeights: Weights, newWeights: Weights): number {
  const assets = new Set([...Object.keys(oldWeights), ...Object.keys(newWeights)]);
  assets.delete("CASH");
  let total = 0;
  for (const asset of assets) {
    total += Math.abs((newWeights[asset] ?? 0) - (oldWeights[asset] ?? 0));
  }
  return total;
}

function assertSimulationParameters(maxAssets: number, ddLimit: number): void {
  if (!Number.isInteger(maxAssets) || maxAssets < 1 || maxAssets > MAX_PORTFOLIO_ASSETS) {
    throw new Error(`maxAssets must be an integer from 1 to ${MAX_PORTFOLIO_ASSETS}; received ${maxAssets}.`);
  }
  if (!Number.isFinite(ddLimit) || ddLimit >= 0 || ddLimit < -0.3) {
    throw new Error(`ddLimit cannot be looser than the approved -0.3 hard stop; received ${ddLimit}.`);
  }
}

function requiredRate(rates: Record<string, number>, asset: string, label: string): number {
  if (!Object.hasOwn(rates, asset)) {
    throw new Error(`Missing transaction cost rate for ${asset} in frame ${label}.`);
  }
  const rate = rates[asset]!;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new Error(`Invalid transaction cost rate for ${asset} in frame ${label}: ${rate}.`);
  }
  return rate;
}

export function runMonthlyStrategy(
  frames: MonthlyFrame[],
  strategy: "trend" | "rotation",
  initialEquity = 1_000_000,
  maxAssets = 3,
  ddLimit = -0.3,
  strategyParameters: StrategyParameterOverrides = {},
): SimulationResult {
  assertSimulationParameters(maxAssets, ddLimit);
  const ranker = strategy === "trend"
    ? (snapshots: Iterable<AssetSnapshot>) => rankTrend(snapshots, strategyParameters.trend)
    : (snapshots: Iterable<AssetSnapshot>) => rankRotation(snapshots, strategyParameters.rotation);
  let equity = initialEquity;
  const equityCurve = [equity];
  const monthlyReturns: number[] = [];
  const weightsHistory: Weights[] = [];
  let oldWeights: Weights = { CASH: 1 };
  let totalCostRate = 0;
  let totalTurnover = 0;
  let stopped = false;
  let stopLabel: string | undefined;

  for (const frame of frames) {
    const equityAtStart = equity;
    const newWeights = stopped ? { CASH: 1 } : inverseVolWeights(ranker(frame.snapshots), maxAssets);
    const tradedAssets = new Set([...Object.keys(oldWeights), ...Object.keys(newWeights)]);
    tradedAssets.delete("CASH");
    for (const asset of tradedAssets) {
      if (Math.abs((newWeights[asset] ?? 0) - (oldWeights[asset] ?? 0)) > 0) {
        requiredRate(frame.costRates, asset, frame.label);
      }
    }
    const cost = turnoverCost(oldWeights, newWeights, frame.costRates);
    totalTurnover += grossTurnover(oldWeights, newWeights);
    totalCostRate += cost;

    const cashReturn = frame.cashReturn ?? 0;
    if (!Number.isFinite(cashReturn) || cashReturn < -1) {
      throw new Error(`Invalid cash return in frame ${frame.label}: ${cashReturn}.`);
    }
    let gross = (newWeights.CASH ?? 0) * cashReturn;
    for (const [asset, weight] of Object.entries(newWeights)) {
      if (asset === "CASH") continue;
      if (!Object.hasOwn(frame.nextMonthReturns, asset)) {
        throw new Error(`Missing next-month return for held asset ${asset} in frame ${frame.label}.`);
      }
      const assetReturn = frame.nextMonthReturns[asset]!;
      if (!Number.isFinite(assetReturn) || assetReturn < -1) {
        throw new Error(`Invalid next-month return for ${asset} in frame ${frame.label}: ${assetReturn}.`);
      }
      gross += weight * assetReturn;
    }

    let net = gross - cost;
    if (net <= -1) throw new Error(`Frame ${frame.label} would reduce equity to zero or below.`);
    equity *= 1 + net;
    weightsHistory.push(newWeights);

    if (!stopped && hardStopTriggered([...equityCurve, equity], ddLimit)) {
      const liquidationRates: Record<string, number> = {};
      for (const asset of Object.keys(newWeights)) {
        if (asset !== "CASH") liquidationRates[asset] = requiredRate(frame.costRates, asset, frame.label);
      }
      const liquidationCost = turnoverCost(newWeights, { CASH: 1 }, liquidationRates);
      if (liquidationCost >= 1) {
        throw new Error(`Liquidation cost is invalid in frame ${frame.label}: ${liquidationCost}.`);
      }
      equity *= 1 - liquidationCost;
      totalTurnover += grossTurnover(newWeights, { CASH: 1 });
      totalCostRate += liquidationCost;
      net = equity / equityAtStart - 1;
      stopped = true;
      stopLabel = frame.label;
      oldWeights = { CASH: 1 };
    } else {
      oldWeights = newWeights;
    }

    monthlyReturns.push(net);
    equityCurve.push(equity);
  }

  return {
    equityCurve,
    monthlyReturns,
    weightsHistory,
    endingWeights: oldWeights,
    totalCostRate,
    totalTurnover,
    averageCashWeight: weightsHistory.length === 0
      ? 1
      : weightsHistory.reduce((sum, weights) => sum + (weights.CASH ?? 0), 0) / weightsHistory.length,
    stopped,
    stopLabel,
  };
}
