import { readFile } from "node:fs/promises";
import { CsvMarketDataProvider } from "../data/csv.ts";
import type { MarketDataProvider } from "../data/provider.ts";
import { StooqMarketDataProvider } from "../data/stooq.ts";
import { buildMonthlyFrames } from "./frame-builder.ts";
import { runMonthlyStrategy } from "./simulator.ts";

interface BacktestConfig {
  strategy: "trend" | "rotation";
  start: string;
  end: string;
  initialEquity?: number;
  maxAssets?: number;
  ddLimit?: number;
  costRate?: number;
  provider?: "csv" | "stooq";
  csvRoot?: string;
  assets: Array<{ code: string; symbol: string; listingDate?: string; delistingDate?: string }>;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const configPath = arg("config") ?? "backtest.config.json";
  const config = JSON.parse(await readFile(configPath, "utf8")) as BacktestConfig;
  const providerName = arg("provider") ?? config.provider ?? "csv";
  const provider: MarketDataProvider = providerName === "stooq"
    ? new StooqMarketDataProvider()
    : new CsvMarketDataProvider(config.csvRoot ?? "data/raw");

  const series: Record<string, Awaited<ReturnType<MarketDataProvider["loadDailyBars"]>>> = {};
  for (const asset of config.assets) {
    const start = asset.listingDate && asset.listingDate > config.start ? asset.listingDate : config.start;
    const end = asset.delistingDate && asset.delistingDate < config.end ? asset.delistingDate : config.end;
    if (start > end) continue;
    series[asset.code] = await provider.loadDailyBars({ code: asset.code, symbol: asset.symbol, start, end });
  }

  const frames = buildMonthlyFrames(series, { costRate: config.costRate });
  if (frames.length === 0) throw new Error("No backtest frames could be built. At least ~12 months of daily history is required.");

  const result = runMonthlyStrategy(
    frames,
    config.strategy,
    config.initialEquity ?? 1_000_000,
    config.maxAssets ?? 3,
    config.ddLimit ?? -0.3,
  );
  const finalEquity = result.equityCurve.at(-1)!;
  const initial = config.initialEquity ?? 1_000_000;
  const totalReturn = finalEquity / initial - 1;

  console.log(JSON.stringify({
    provider: provider.name,
    strategy: config.strategy,
    start: frames[0]!.label,
    end: frames.at(-1)!.label,
    months: frames.length,
    initialEquity: initial,
    finalEquity: Math.round(finalEquity),
    totalReturn,
    totalCostRate: result.totalCostRate,
    stopped: result.stopped,
    latestWeights: result.weightsHistory.at(-1),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
