import { readFile } from "node:fs/promises";
import { CsvMarketDataProvider } from "../data/csv.ts";
import type { MarketDataProvider } from "../data/provider.ts";
import { StooqMarketDataProvider } from "../data/stooq.ts";
import { MAX_PORTFOLIO_ASSETS } from "../portfolio/allocator.ts";
import { maxDrawdown } from "../portfolio/risk.ts";
import { buildMonthlyFramesWithDiagnostics } from "./frame-builder.ts";
import { runMonthlyStrategy } from "./simulator.ts";

type ProviderName = "csv" | "stooq";
export type BacktestReturnBasis = "unadjusted_price" | "provider_adjusted";
export const BACKTEST_SUMMARY_SCHEMA_VERSION = "backtest-summary-v2" as const;

export interface BacktestAssetConfig {
  code: string;
  symbol: string;
  listingDate?: string;
  delistingDate?: string;
}

export interface BacktestConfig {
  strategy: "trend" | "rotation";
  start: string;
  end: string;
  initialEquity?: number;
  maxAssets?: number;
  ddLimit?: number;
  costRate?: number;
  returnBasis?: BacktestReturnBasis;
  provider?: ProviderName;
  csvRoot?: string;
  assets: BacktestAssetConfig[];
}

export interface BacktestAssetDiagnostic {
  code: string;
  symbol: string;
  requestedStart: string;
  requestedEnd: string;
  loadedBars: number;
  loadedStart?: string;
  loadedEnd?: string;
  eligibleFrameCount: number;
  status: "included" | "excluded";
  reason?: string;
}

export interface BacktestSummary {
  outputSchemaVersion: typeof BACKTEST_SUMMARY_SCHEMA_VERSION;
  provider: string;
  returnBasis: BacktestReturnBasis;
  returnNormalization: {
    status: "not_normalized";
    warning: string;
  };
  strategy: "trend" | "rotation";
  start: string;
  end: string;
  months: number;
  initialEquity: number;
  finalEquity: number;
  cumulativePortfolioReturn: number;
  maxDrawdown: number;
  totalCostRate: number;
  stopped: boolean;
  stopLabel?: string;
  maxObservedHoldings: number;
  latestWeights: Record<string, number>;
  assetDiagnostics: BacktestAssetDiagnostic[];
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function optionalFiniteNumber(
  value: unknown,
  field: string,
  predicate: (numberValue: number) => boolean,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !predicate(value)) {
    throw new Error(`Invalid ${field}: ${String(value)}.`);
  }
  return value;
}

export function validateBacktestConfig(value: unknown): BacktestConfig {
  if (!isRecord(value)) throw new Error("Backtest config must be a JSON object.");
  if (value.strategy !== "trend" && value.strategy !== "rotation") {
    throw new Error(`strategy must be "trend" or "rotation"; received ${String(value.strategy)}.`);
  }
  if (!isIsoDate(value.start) || !isIsoDate(value.end) || value.start > value.end) {
    throw new Error(`start/end must be valid ISO dates with start <= end; received ${String(value.start)}..${String(value.end)}.`);
  }
  if (value.provider !== undefined && value.provider !== "csv" && value.provider !== "stooq") {
    throw new Error(`provider must be "csv" or "stooq"; received ${String(value.provider)}.`);
  }
  if (
    value.returnBasis !== undefined
    && value.returnBasis !== "unadjusted_price"
    && value.returnBasis !== "provider_adjusted"
  ) {
    throw new Error(
      `returnBasis must be "unadjusted_price" or "provider_adjusted"; received ${String(value.returnBasis)}.`,
    );
  }
  if (value.provider === "stooq" && value.returnBasis === "provider_adjusted") {
    throw new Error("Stooq currently supports only unadjusted_price returnBasis.");
  }
  if (value.csvRoot !== undefined && (typeof value.csvRoot !== "string" || value.csvRoot.trim() === "")) {
    throw new Error("csvRoot must be a non-empty string when provided.");
  }

  const initialEquity = optionalFiniteNumber(value.initialEquity, "initialEquity", (numberValue) => numberValue > 0);
  const maxAssets = optionalFiniteNumber(
    value.maxAssets,
    "maxAssets",
    (numberValue) => Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= MAX_PORTFOLIO_ASSETS,
  );
  const ddLimit = optionalFiniteNumber(
    value.ddLimit,
    "ddLimit",
    (numberValue) => numberValue < 0 && numberValue >= -0.3,
  );
  const costRate = optionalFiniteNumber(value.costRate, "costRate", (numberValue) => numberValue >= 0 && numberValue < 1);

  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new Error("assets must be a non-empty array.");
  }
  const seenCodes = new Set<string>();
  const assets = value.assets.map((asset, index): BacktestAssetConfig => {
    if (!isRecord(asset)) throw new Error(`assets[${index}] must be an object.`);
    if (typeof asset.code !== "string" || asset.code.trim() === "") {
      throw new Error(`assets[${index}].code must be a non-empty string.`);
    }
    if (seenCodes.has(asset.code)) throw new Error(`Duplicate asset code in config: ${asset.code}.`);
    seenCodes.add(asset.code);
    if (typeof asset.symbol !== "string" || asset.symbol.trim() === "") {
      throw new Error(`assets[${index}].symbol must be a non-empty string.`);
    }
    if (asset.listingDate !== undefined && !isIsoDate(asset.listingDate)) {
      throw new Error(`Invalid listingDate for ${asset.code}: ${String(asset.listingDate)}.`);
    }
    if (asset.delistingDate !== undefined && !isIsoDate(asset.delistingDate)) {
      throw new Error(`Invalid delistingDate for ${asset.code}: ${String(asset.delistingDate)}.`);
    }
    if (
      typeof asset.listingDate === "string"
      && typeof asset.delistingDate === "string"
      && asset.listingDate > asset.delistingDate
    ) {
      throw new Error(`listingDate must not be after delistingDate for ${asset.code}.`);
    }
    return {
      code: asset.code,
      symbol: asset.symbol,
      listingDate: asset.listingDate as string | undefined,
      delistingDate: asset.delistingDate as string | undefined,
    };
  });

  return {
    strategy: value.strategy,
    start: value.start,
    end: value.end,
    initialEquity,
    maxAssets,
    ddLimit,
    costRate,
    returnBasis: value.returnBasis as BacktestReturnBasis | undefined,
    provider: value.provider as ProviderName | undefined,
    csvRoot: value.csvRoot as string | undefined,
    assets,
  };
}

function resolveProviderName(value: string | undefined): ProviderName | undefined {
  if (value === undefined) return undefined;
  if (value !== "csv" && value !== "stooq") {
    throw new Error(`provider must be "csv" or "stooq"; received ${value}.`);
  }
  return value;
}

export async function runBacktest(configPath: string, providerOverride?: string): Promise<BacktestSummary> {
  const config = validateBacktestConfig(JSON.parse(await readFile(configPath, "utf8")));
  const providerName = resolveProviderName(providerOverride) ?? config.provider ?? "csv";
  const returnBasis = config.returnBasis ?? "provider_adjusted";
  if (providerName === "stooq" && returnBasis !== "unadjusted_price") {
    throw new Error("Stooq currently supports only unadjusted_price returnBasis.");
  }
  const provider: MarketDataProvider = providerName === "stooq"
    ? new StooqMarketDataProvider()
    : new CsvMarketDataProvider(
        config.csvRoot ?? "data/raw",
        returnBasis === "provider_adjusted",
      );

  const series: Record<string, Awaited<ReturnType<MarketDataProvider["loadDailyBars"]>>> = {};
  const diagnostics = new Map<string, BacktestAssetDiagnostic>();
  for (const asset of config.assets) {
    const start = asset.listingDate && asset.listingDate > config.start ? asset.listingDate : config.start;
    const end = asset.delistingDate && asset.delistingDate < config.end ? asset.delistingDate : config.end;
    if (start > end) {
      diagnostics.set(asset.code, {
        code: asset.code,
        symbol: asset.symbol,
        requestedStart: start,
        requestedEnd: end,
        loadedBars: 0,
        eligibleFrameCount: 0,
        status: "excluded",
        reason: "Listing/delisting dates do not overlap the configured backtest window.",
      });
      continue;
    }
    const bars = await provider.loadDailyBars({ code: asset.code, symbol: asset.symbol, start, end });
    series[asset.code] = bars;
    diagnostics.set(asset.code, {
      code: asset.code,
      symbol: asset.symbol,
      requestedStart: start,
      requestedEnd: end,
      loadedBars: bars.length,
      loadedStart: bars[0]?.tradingDate,
      loadedEnd: bars.at(-1)?.tradingDate,
      eligibleFrameCount: 0,
      status: "excluded",
    });
  }

  const built = buildMonthlyFramesWithDiagnostics(series, {
    costRate: config.costRate,
    priceField: returnBasis === "unadjusted_price" ? "close" : "adjustedClose",
  });
  for (const frameDiagnostic of built.assetDiagnostics) {
    const diagnostic = diagnostics.get(frameDiagnostic.code)!;
    diagnostic.eligibleFrameCount = frameDiagnostic.eligibleFrameCount;
    diagnostic.status = frameDiagnostic.eligibleFrameCount > 0 ? "included" : "excluded";
    diagnostic.reason = frameDiagnostic.exclusionReason;
  }
  const assetDiagnostics = config.assets.map((asset) => diagnostics.get(asset.code)!);
  if (built.frames.length === 0) {
    const reasons = assetDiagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.reason ?? "no eligible frame"}`)
      .join("; ");
    throw new Error(`No backtest frames could be built. ${reasons}`);
  }

  const initial = config.initialEquity ?? 1_000_000;
  const result = runMonthlyStrategy(
    built.frames,
    config.strategy,
    initial,
    config.maxAssets ?? 3,
    config.ddLimit ?? -0.3,
  );
  const finalEquityExact = result.equityCurve.at(-1)!;
  const maxObservedHoldings = result.weightsHistory.reduce((maximum, weights) => {
    const holdings = Object.entries(weights).filter(([asset, weight]) => asset !== "CASH" && weight > 0).length;
    return Math.max(maximum, holdings);
  }, 0);

  return {
    outputSchemaVersion: BACKTEST_SUMMARY_SCHEMA_VERSION,
    provider: provider.name,
    returnBasis,
    returnNormalization: {
      status: "not_normalized",
      warning: returnBasis === "unadjusted_price"
        ? "Corporate Actions and distributions are not normalized."
        : "Provider adjustment semantics and Point-in-Time safety are unverified.",
    },
    strategy: config.strategy,
    start: built.frames[0]!.label,
    end: built.frames.at(-1)!.label,
    months: built.frames.length,
    initialEquity: initial,
    finalEquity: Math.round(finalEquityExact),
    cumulativePortfolioReturn: finalEquityExact / initial - 1,
    maxDrawdown: maxDrawdown(result.equityCurve),
    totalCostRate: result.totalCostRate,
    stopped: result.stopped,
    stopLabel: result.stopLabel,
    maxObservedHoldings,
    latestWeights: result.endingWeights,
    assetDiagnostics,
  };
}

async function main(): Promise<void> {
  const configPath = arg("config") ?? "backtest.config.json";
  console.log(JSON.stringify(await runBacktest(configPath, arg("provider")), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
