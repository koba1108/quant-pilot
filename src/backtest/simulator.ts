import type { AssetSnapshot } from "../strategies/types.ts";
import { rankTrend } from "../strategies/trend.ts";
import { rankRotation } from "../strategies/rotation.ts";
import { inverseVolWeights, type Weights } from "../portfolio/allocator.ts";
import { turnoverCost } from "../portfolio/costs.ts";
import { hardStopTriggered } from "../portfolio/risk.ts";

export interface MonthlyFrame {
  label: string;
  snapshots: AssetSnapshot[];
  nextMonthReturns: Record<string, number>;
  costRates: Record<string, number>;
  cashReturn?: number;
}

export interface SimulationResult {
  equityCurve: number[];
  monthlyReturns: number[];
  weightsHistory: Weights[];
  totalCostRate: number;
  stopped: boolean;
}

export function runMonthlyStrategy(
  frames: MonthlyFrame[],
  strategy: "trend" | "rotation",
  initialEquity = 1_000_000,
  maxAssets = 3,
  ddLimit = -0.3,
): SimulationResult {
  const ranker = strategy === "trend" ? rankTrend : rankRotation;
  let equity = initialEquity;
  const equityCurve = [equity];
  const monthlyReturns: number[] = [];
  const weightsHistory: Weights[] = [];
  let oldWeights: Weights = { CASH: 1 };
  let totalCostRate = 0;
  let stopped = false;

  for (const frame of frames) {
    const newWeights = stopped ? { CASH: 1 } : inverseVolWeights(ranker(frame.snapshots), maxAssets);
    const cost = turnoverCost(oldWeights, newWeights, frame.costRates);
    totalCostRate += cost;

    let gross = (newWeights.CASH ?? 0) * (frame.cashReturn ?? 0);
    for (const [asset, weight] of Object.entries(newWeights)) {
      if (asset === "CASH") continue;
      gross += weight * (frame.nextMonthReturns[asset] ?? 0);
    }

    const net = gross - cost;
    equity *= 1 + net;
    monthlyReturns.push(net);
    equityCurve.push(equity);
    weightsHistory.push(newWeights);
    oldWeights = newWeights;

    if (!stopped && hardStopTriggered(equityCurve, ddLimit)) {
      stopped = true;
      oldWeights = { CASH: 1 };
    }
  }

  return { equityCurve, monthlyReturns, weightsHistory, totalCostRate, stopped };
}
