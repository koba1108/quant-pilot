import { readFile } from "node:fs/promises";
import { CsvMarketDataProvider } from "../data/csv.ts";
import type { DailyBar } from "../data/models.ts";
import type { MarketDataProvider } from "../data/provider.ts";
import {
  buildVersionedDataArtifact,
  isIsoDateTime,
  sha256Canonical,
  type DataArtifactProvenance,
} from "../data/provenance.ts";
import { StooqMarketDataProvider } from "../data/stooq.ts";
import {
  assertUniverseMasterIntegrity,
  evaluateUniverseMembership,
  getUniverseInstrumentDefinition,
  loadUniverseMaster,
  type UniverseMaster,
} from "../data/universe-master.ts";
import { MAX_PORTFOLIO_ASSETS } from "../portfolio/allocator.ts";
import { maxDrawdown } from "../portfolio/risk.ts";
import { validateRotationParameters } from "../strategies/rotation.ts";
import { validateTrendParameters } from "../strategies/trend.ts";
import type { RotationStrategyParameters, TrendStrategyParameters } from "../strategies/types.ts";
import {
  buildMonthlyFramesWithDiagnostics,
  type FrameBuildResult,
  type UniverseDecisionAudit,
} from "./frame-builder.ts";
import { runMonthlyStrategy, type SimulationResult } from "./simulator.ts";
import { compareText } from "../determinism.ts";

type ProviderName = "csv" | "stooq";
export type BacktestReturnBasis = "unadjusted_price" | "provider_adjusted";
export type ResearchLayer = "synthetic_fixture" | "proxy" | "etf_realistic";
export const BACKTEST_SUMMARY_SCHEMA_VERSION = "backtest-summary-v2" as const;

export interface BacktestAssetProvenanceConfig {
  source: string;
  dataset: string;
  sourceVersion: string;
  adapterVersion: string;
  observedAt: string;
  availableAt: string;
  retrievedAt: string;
  recordId?: string;
}

export interface BacktestAssetConfig {
  code: string;
  symbol?: string;
  listingDate?: string;
  delistingDate?: string;
  provenance?: BacktestAssetProvenanceConfig;
}

export interface BacktestConfig {
  strategy: "trend" | "rotation";
  start: string;
  end: string;
  initialEquity?: number;
  maxAssets?: number;
  ddLimit?: number;
  costRate?: number;
  volatilityWindowDays?: number;
  returnBasis?: BacktestReturnBasis;
  provider?: ProviderName;
  csvRoot?: string;
  researchLayer?: ResearchLayer;
  universeMasterPath?: string;
  universeStatuses?: string[];
  trendParameters?: TrendStrategyParameters;
  rotationParameters?: RotationStrategyParameters;
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
  dataArtifactId?: string;
  universeObservationIds?: string[];
  universeExclusions?: Record<string, number>;
  universeDecisions?: UniverseDecisionAudit[];
}

export interface BacktestSummary {
  outputSchemaVersion: typeof BACKTEST_SUMMARY_SCHEMA_VERSION;
  provider: string;
  returnBasis: BacktestReturnBasis;
  returnNormalization: { status: "not_normalized"; warning: string };
  researchLayer: ResearchLayer | "unspecified";
  evidenceDisposition: "research_only";
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
  universeMaster?: {
    schemaVersion: "universe-master-v1";
    fingerprint: string;
    allowedStatuses: readonly string[];
  };
  assetDiagnostics: BacktestAssetDiagnostic[];
}

export interface LoadedBacktestAsset {
  code: string;
  symbol: string;
  requestedStart: string;
  requestedEnd: string;
  bars: DailyBar[];
  dataContentHash: string;
  provenance?: DataArtifactProvenance;
}

export interface LoadedBacktestInput {
  config: BacktestConfig;
  loadConfigFingerprint: string;
  integrityFingerprint: string;
  providerName: string;
  series: Record<string, DailyBar[]>;
  assets: readonly LoadedBacktestAsset[];
  baseDiagnostics: ReadonlyMap<string, BacktestAssetDiagnostic>;
  universeMaster?: UniverseMaster;
  universeStatuses?: ReadonlySet<string>;
}

export interface DetailedBacktestResult {
  summary: BacktestSummary;
  frames: FrameBuildResult["frames"];
  simulation: SimulationResult;
  loaded: LoadedBacktestInput;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.join(", ")}.`);
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function validateAssetProvenance(value: unknown, field: string): BacktestAssetProvenanceConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, [
    "source", "dataset", "sourceVersion", "adapterVersion", "observedAt", "availableAt", "retrievedAt", "recordId",
  ], field);
  const output: BacktestAssetProvenanceConfig = {
    source: requiredString(value.source, `${field}.source`),
    dataset: requiredString(value.dataset, `${field}.dataset`),
    sourceVersion: requiredString(value.sourceVersion, `${field}.sourceVersion`),
    adapterVersion: requiredString(value.adapterVersion, `${field}.adapterVersion`),
    observedAt: requiredString(value.observedAt, `${field}.observedAt`),
    availableAt: requiredString(value.availableAt, `${field}.availableAt`),
    retrievedAt: requiredString(value.retrievedAt, `${field}.retrievedAt`),
    recordId: value.recordId === undefined ? undefined : requiredString(value.recordId, `${field}.recordId`),
  };
  for (const timestampField of ["observedAt", "availableAt", "retrievedAt"] as const) {
    if (!isIsoDateTime(output[timestampField])) {
      throw new Error(`${field}.${timestampField} must be an ISO timestamp with timezone.`);
    }
  }
  if (Date.parse(output.observedAt) > Date.parse(output.availableAt)
    || Date.parse(output.availableAt) > Date.parse(output.retrievedAt)) {
    throw new Error(`${field} timestamps must satisfy observedAt <= availableAt <= retrievedAt.`);
  }
  return output;
}

function parseTrendParameters(value: unknown): TrendStrategyParameters | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("trendParameters must be an object.");
  assertOnlyKeys(value, ["r3mWeight", "r6mWeight", "r12mWeight", "requirePositiveR12m"], "trendParameters");
  return validateTrendParameters({
    r3mWeight: value.r3mWeight as number,
    r6mWeight: value.r6mWeight as number,
    r12mWeight: value.r12mWeight as number,
    requirePositiveR12m: value.requirePositiveR12m as boolean,
  });
}

function parseRotationParameters(value: unknown): RotationStrategyParameters | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("rotationParameters must be an object.");
  assertOnlyKeys(value, ["r6mWeight", "r12mWeight", "volatilityPenalty", "requirePositiveR12m"], "rotationParameters");
  return validateRotationParameters({
    r6mWeight: value.r6mWeight as number,
    r12mWeight: value.r12mWeight as number,
    volatilityPenalty: value.volatilityPenalty as number,
    requirePositiveR12m: value.requirePositiveR12m as boolean,
  });
}

export function validateBacktestConfig(value: unknown): BacktestConfig {
  if (!isRecord(value)) throw new Error("Backtest config must be a JSON object.");
  assertOnlyKeys(value, [
    "strategy", "start", "end", "initialEquity", "maxAssets", "ddLimit", "costRate", "volatilityWindowDays",
    "returnBasis", "provider", "csvRoot", "researchLayer", "universeMasterPath", "universeStatuses",
    "trendParameters", "rotationParameters", "assets",
  ], "Backtest config");
  if (value.strategy !== "trend" && value.strategy !== "rotation") {
    throw new Error(`strategy must be "trend" or "rotation"; received ${String(value.strategy)}.`);
  }
  if (!isIsoDate(value.start) || !isIsoDate(value.end) || value.start > value.end) {
    throw new Error(`start/end must be valid ISO dates with start <= end; received ${String(value.start)}..${String(value.end)}.`);
  }
  if (value.provider !== undefined && value.provider !== "csv" && value.provider !== "stooq") {
    throw new Error(`provider must be "csv" or "stooq"; received ${String(value.provider)}.`);
  }
  if (value.returnBasis !== undefined
    && value.returnBasis !== "unadjusted_price"
    && value.returnBasis !== "provider_adjusted") {
    throw new Error(`returnBasis must be "unadjusted_price" or "provider_adjusted"; received ${String(value.returnBasis)}.`);
  }
  if (value.provider === "stooq" && value.returnBasis === "provider_adjusted") {
    throw new Error("Stooq currently supports only unadjusted_price returnBasis.");
  }
  if (value.csvRoot !== undefined && (typeof value.csvRoot !== "string" || value.csvRoot.trim() === "")) {
    throw new Error("csvRoot must be a non-empty string when provided.");
  }
  if (value.researchLayer !== undefined
    && value.researchLayer !== "synthetic_fixture"
    && value.researchLayer !== "proxy"
    && value.researchLayer !== "etf_realistic") {
    throw new Error(`Invalid researchLayer: ${String(value.researchLayer)}.`);
  }
  if (value.researchLayer === "etf_realistic") {
    throw new Error(
      "researchLayer=etf_realistic is not executable until normalized returns, per-observation availability, and JPY conversion are integrated.",
    );
  }

  const universeMasterPath = value.universeMasterPath === undefined
    ? undefined
    : requiredString(value.universeMasterPath, "universeMasterPath");
  let universeStatuses: string[] | undefined;
  if (universeMasterPath !== undefined) {
    if (!Array.isArray(value.universeStatuses) || value.universeStatuses.length === 0) {
      throw new Error("universeStatuses must be an explicitly non-empty array when universeMasterPath is used.");
    }
    universeStatuses = value.universeStatuses.map((status, index) => requiredString(status, `universeStatuses[${index}]`));
    if (new Set(universeStatuses).size !== universeStatuses.length) {
      throw new Error("universeStatuses must not contain duplicates.");
    }
    universeStatuses.sort();
  } else if (value.universeStatuses !== undefined) {
    throw new Error("universeStatuses requires universeMasterPath.");
  }
  if (universeMasterPath === undefined
    && value.researchLayer !== "synthetic_fixture"
    && value.researchLayer !== "proxy") {
    throw new Error(
      "The config-only asset path is limited to explicitly labeled synthetic_fixture or proxy research; ETF-realistic research requires a strict Point-in-Time universe master.",
    );
  }

  const initialEquity = optionalFiniteNumber(value.initialEquity, "initialEquity", (numberValue) => numberValue > 0);
  const maxAssets = optionalFiniteNumber(
    value.maxAssets,
    "maxAssets",
    (numberValue) => Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= MAX_PORTFOLIO_ASSETS,
  );
  const ddLimit = optionalFiniteNumber(value.ddLimit, "ddLimit", (numberValue) => numberValue < 0 && numberValue >= -0.3);
  const costRate = optionalFiniteNumber(value.costRate, "costRate", (numberValue) => numberValue >= 0 && numberValue < 1);
  const volatilityWindowDays = optionalFiniteNumber(
    value.volatilityWindowDays,
    "volatilityWindowDays",
    (numberValue) => Number.isInteger(numberValue) && numberValue >= 2 && numberValue <= 252,
  );
  const trendParameters = parseTrendParameters(value.trendParameters);
  const rotationParameters = parseRotationParameters(value.rotationParameters);
  if (value.strategy === "trend" && rotationParameters !== undefined) {
    throw new Error("rotationParameters cannot be used with the trend strategy.");
  }
  if (value.strategy === "rotation" && trendParameters !== undefined) {
    throw new Error("trendParameters cannot be used with the rotation strategy.");
  }

  if (!Array.isArray(value.assets) || value.assets.length === 0) throw new Error("assets must be a non-empty array.");
  const seenCodes = new Set<string>();
  const assets = value.assets.map((asset, index): BacktestAssetConfig => {
    if (!isRecord(asset)) throw new Error(`assets[${index}] must be an object.`);
    assertOnlyKeys(asset, ["code", "symbol", "listingDate", "delistingDate", "provenance"], `assets[${index}]`);
    const code = requiredString(asset.code, `assets[${index}].code`);
    if (seenCodes.has(code)) throw new Error(`Duplicate asset code in config: ${code}.`);
    seenCodes.add(code);
    const symbol = asset.symbol === undefined ? undefined : requiredString(asset.symbol, `assets[${index}].symbol`);
    if (universeMasterPath === undefined && symbol === undefined) {
      throw new Error(`assets[${index}].symbol must be provided without universeMasterPath.`);
    }
    if (universeMasterPath !== undefined
      && (symbol !== undefined || asset.listingDate !== undefined || asset.delistingDate !== undefined)) {
      throw new Error(`Asset ${code} must get symbol and lifecycle dates only from universeMasterPath.`);
    }
    if (asset.listingDate !== undefined && !isIsoDate(asset.listingDate)) {
      throw new Error(`Invalid listingDate for ${code}: ${String(asset.listingDate)}.`);
    }
    if (asset.delistingDate !== undefined && !isIsoDate(asset.delistingDate)) {
      throw new Error(`Invalid delistingDate for ${code}: ${String(asset.delistingDate)}.`);
    }
    if (typeof asset.listingDate === "string" && typeof asset.delistingDate === "string"
      && asset.listingDate > asset.delistingDate) {
      throw new Error(`listingDate must not be after delistingDate for ${code}.`);
    }
    return {
      code,
      symbol,
      listingDate: asset.listingDate as string | undefined,
      delistingDate: asset.delistingDate as string | undefined,
      provenance: validateAssetProvenance(asset.provenance, `assets[${index}].provenance`),
    };
  }).sort((left, right) => compareText(left.code, right.code));

  return {
    strategy: value.strategy,
    start: value.start,
    end: value.end,
    initialEquity,
    maxAssets,
    ddLimit,
    costRate,
    volatilityWindowDays,
    returnBasis: value.returnBasis as BacktestReturnBasis | undefined,
    provider: value.provider as ProviderName | undefined,
    csvRoot: value.csvRoot as string | undefined,
    researchLayer: value.researchLayer as ResearchLayer | undefined,
    universeMasterPath,
    universeStatuses,
    trendParameters,
    rotationParameters,
    assets,
  };
}

function resolveProviderName(value: string | undefined): ProviderName | undefined {
  if (value === undefined) return undefined;
  if (value !== "csv" && value !== "stooq") throw new Error(`provider must be "csv" or "stooq"; received ${value}.`);
  return value;
}

function loadConfigFingerprint(config: BacktestConfig): string {
  return sha256Canonical({
    start: config.start,
    end: config.end,
    returnBasis: config.returnBasis,
    provider: config.provider,
    csvRoot: config.csvRoot,
    researchLayer: config.researchLayer,
    universeMasterPath: config.universeMasterPath,
    universeStatuses: config.universeStatuses,
    assets: config.assets,
  });
}

function loadedInputIntegrityFingerprint(input: {
  providerName: string;
  assets: readonly LoadedBacktestAsset[];
  series: Record<string, DailyBar[]>;
  baseDiagnostics: ReadonlyMap<string, BacktestAssetDiagnostic>;
  universeMaster?: UniverseMaster;
  universeStatuses?: ReadonlySet<string>;
}): string {
  return sha256Canonical({
    providerName: input.providerName,
    assets: input.assets.map((asset) => ({
      code: asset.code,
      symbol: asset.symbol,
      requestedStart: asset.requestedStart,
      requestedEnd: asset.requestedEnd,
      dataContentHash: sha256Canonical(asset.bars),
      provenance: asset.provenance,
    })),
    series: Object.entries(input.series).sort(([left], [right]) => compareText(left, right))
      .map(([code, bars]) => ({ code, contentHash: sha256Canonical(bars) })),
    baseDiagnostics: [...input.baseDiagnostics.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([code, diagnostic]) => ({ code, diagnostic })),
    universeMasterFingerprint: input.universeMaster?.fingerprint,
    universeStatuses: input.universeStatuses === undefined ? undefined : [...input.universeStatuses].sort(compareText),
  });
}

function cloneDiagnostic(diagnostic: BacktestAssetDiagnostic): BacktestAssetDiagnostic {
  return {
    ...diagnostic,
    universeObservationIds: diagnostic.universeObservationIds === undefined
      ? undefined
      : [...diagnostic.universeObservationIds],
    universeExclusions: diagnostic.universeExclusions === undefined
      ? undefined
      : { ...diagnostic.universeExclusions },
    universeDecisions: diagnostic.universeDecisions === undefined
      ? undefined
      : diagnostic.universeDecisions.map((decision) => ({ ...decision })),
  };
}

export function assertBarsWithinRequest(
  bars: readonly DailyBar[],
  request: { code: string; start: string; end: string },
): void {
  for (const bar of bars) {
    if (bar.code !== request.code) {
      throw new Error(`Provider returned code ${bar.code} for requested code ${request.code}.`);
    }
    if (bar.tradingDate < request.start || bar.tradingDate > request.end) {
      throw new Error(
        `Provider returned ${request.code} bar ${bar.tradingDate} outside requested range ${request.start}..${request.end}.`,
      );
    }
  }
}

export async function loadBacktestInputs(
  config: BacktestConfig,
  providerOverride?: string,
): Promise<LoadedBacktestInput> {
  config = validateBacktestConfig(config);
  const providerName = resolveProviderName(providerOverride) ?? config.provider ?? "csv";
  const returnBasis = config.returnBasis ?? "provider_adjusted";
  if (providerName === "stooq" && returnBasis !== "unadjusted_price") {
    throw new Error("Stooq currently supports only unadjusted_price returnBasis.");
  }
  const provider: MarketDataProvider = providerName === "stooq"
    ? new StooqMarketDataProvider()
    : new CsvMarketDataProvider(config.csvRoot ?? "data/raw", returnBasis === "provider_adjusted");
  const universeMaster = config.universeMasterPath === undefined ? undefined : await loadUniverseMaster(config.universeMasterPath);
  const universeStatuses = config.universeStatuses === undefined ? undefined : new Set(config.universeStatuses);

  const series: Record<string, DailyBar[]> = {};
  const diagnostics = new Map<string, BacktestAssetDiagnostic>();
  const loadedAssets: LoadedBacktestAsset[] = [];
  for (const asset of config.assets) {
    const definition = universeMaster === undefined ? undefined : getUniverseInstrumentDefinition(universeMaster, asset.code);
    const symbol = definition?.symbol ?? asset.symbol!;
    const listingDate = definition?.earliestListingDate ?? asset.listingDate;
    const lastEligibleDate = definition?.latestPossibleEligibleDate ?? asset.delistingDate;
    const start = listingDate && listingDate > config.start ? listingDate : config.start;
    const end = lastEligibleDate && lastEligibleDate < config.end ? lastEligibleDate : config.end;
    if (start > end) {
      diagnostics.set(asset.code, {
        code: asset.code,
        symbol,
        requestedStart: start,
        requestedEnd: end,
        loadedBars: 0,
        eligibleFrameCount: 0,
        status: "excluded",
        reason: "Listing/last-eligible dates do not overlap the configured backtest window.",
        universeObservationIds: universeMaster === undefined ? undefined : [],
      });
      continue;
    }
    const request = { code: asset.code, symbol, start, end };
    const bars = await provider.loadDailyBars(request);
    assertBarsWithinRequest(bars, request);
    series[asset.code] = bars;
    const dataContentHash = sha256Canonical(bars);
    const artifact = asset.provenance === undefined ? undefined : buildVersionedDataArtifact({
      artifactKind: "daily_bars",
      payload: bars,
      source: asset.provenance.source,
      dataset: asset.provenance.dataset,
      sourceVersion: asset.provenance.sourceVersion,
      adapterVersion: asset.provenance.adapterVersion,
      observedAt: asset.provenance.observedAt,
      availableAt: asset.provenance.availableAt,
      retrievedAt: asset.provenance.retrievedAt,
      request,
      recordId: asset.provenance.recordId,
    });
    loadedAssets.push({
      code: asset.code,
      symbol,
      requestedStart: start,
      requestedEnd: end,
      bars,
      dataContentHash,
      provenance: artifact?.provenance,
    });
    diagnostics.set(asset.code, {
      code: asset.code,
      symbol,
      requestedStart: start,
      requestedEnd: end,
      loadedBars: bars.length,
      loadedStart: bars[0]?.tradingDate,
      loadedEnd: bars.at(-1)?.tradingDate,
      eligibleFrameCount: 0,
      status: "excluded",
      dataArtifactId: artifact?.provenance.artifactId,
      universeObservationIds: universeMaster === undefined ? undefined : [],
    });
  }
  const loaded = {
    config,
    loadConfigFingerprint: loadConfigFingerprint(config),
    integrityFingerprint: "",
    providerName: provider.name,
    series,
    assets: loadedAssets,
    baseDiagnostics: diagnostics,
    universeMaster,
    universeStatuses,
  };
  loaded.integrityFingerprint = loadedInputIntegrityFingerprint(loaded);
  return loaded;
}

export function executeLoadedBacktest(
  loaded: LoadedBacktestInput,
  config: BacktestConfig = loaded.config,
): DetailedBacktestResult {
  config = validateBacktestConfig(config);
  if (loadConfigFingerprint(config) !== loaded.loadConfigFingerprint) {
    throw new Error("Execution config changes data-loading fields; reload backtest inputs before execution.");
  }
  if (loaded.universeMaster !== undefined) assertUniverseMasterIntegrity(loaded.universeMaster);
  for (const asset of loaded.assets) {
    const currentHash = sha256Canonical(asset.bars);
    if (currentHash !== asset.dataContentHash || sha256Canonical(loaded.series[asset.code]) !== asset.dataContentHash) {
      throw new Error(`Loaded market-data content changed after validation for ${asset.code}.`);
    }
  }
  if (loadedInputIntegrityFingerprint(loaded) !== loaded.integrityFingerprint) {
    throw new Error("Loaded backtest inputs changed after validation.");
  }
  const returnBasis = config.returnBasis ?? "provider_adjusted";
  const built = buildMonthlyFramesWithDiagnostics(loaded.series, {
    costRate: config.costRate,
    priceField: returnBasis === "unadjusted_price" ? "close" : "adjustedClose",
    volatilityWindowDays: config.volatilityWindowDays,
    universeEligibility: loaded.universeMaster === undefined ? undefined : (code, decisionDate, phase) => {
      const membership = evaluateUniverseMembership(
        loaded.universeMaster!,
        code,
        decisionDate,
        { allowedStatuses: loaded.universeStatuses!, supportedCurrencies: new Set(["JPY"]) },
      );
      return {
        eligible: membership.eligible,
        reason: membership.reason,
        observationId: membership.observationId,
        status: membership.status,
        listingDate: membership.listingDate,
        lastEligibleDate: membership.lastEligibleDate,
        observedAt: membership.observedAt,
        availableAt: membership.availableAt,
        retrievedAt: membership.provenance?.retrievedAt,
        source: membership.provenance?.source,
        dataset: membership.provenance?.dataset,
        sourceVersion: membership.provenance?.sourceVersion,
        recordId: membership.provenance?.recordId,
        instrumentType: membership.instrumentType,
        isUsEquity: membership.isUsEquity,
        isCryptoAsset: membership.isCryptoAsset,
        isLeveraged: membership.isLeveraged,
        isInverse: membership.isInverse,
        currency: membership.currency,
      };
    },
  });
  const diagnostics = new Map(
    [...loaded.baseDiagnostics].map(([code, diagnostic]) => [code, cloneDiagnostic(diagnostic)]),
  );
  for (const frameDiagnostic of built.assetDiagnostics) {
    const diagnostic = diagnostics.get(frameDiagnostic.code)!;
    diagnostic.eligibleFrameCount = frameDiagnostic.eligibleFrameCount;
    diagnostic.status = frameDiagnostic.eligibleFrameCount > 0 ? "included" : "excluded";
    diagnostic.reason = frameDiagnostic.exclusionReason;
    if (frameDiagnostic.universeObservationIds !== undefined) {
      diagnostic.universeObservationIds = frameDiagnostic.universeObservationIds;
    }
    if (frameDiagnostic.universeExclusions !== undefined) {
      diagnostic.universeExclusions = frameDiagnostic.universeExclusions;
    }
    if (frameDiagnostic.universeDecisions !== undefined) {
      diagnostic.universeDecisions = frameDiagnostic.universeDecisions;
    }
  }
  const assetDiagnostics = config.assets.map((asset) => diagnostics.get(asset.code)!);
  if (built.frames.length === 0) {
    const reasons = assetDiagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.reason ?? "no eligible frame"}`).join("; ");
    throw new Error(`No backtest frames could be built. ${reasons}`);
  }

  const initial = config.initialEquity ?? 1_000_000;
  const simulation = runMonthlyStrategy(
    built.frames,
    config.strategy,
    initial,
    config.maxAssets ?? 3,
    config.ddLimit ?? -0.3,
    { trend: config.trendParameters, rotation: config.rotationParameters },
  );
  const finalEquityExact = simulation.equityCurve.at(-1)!;
  const maxObservedHoldings = simulation.weightsHistory.reduce((maximum, weights) => {
    const holdings = Object.entries(weights).filter(([asset, weight]) => asset !== "CASH" && weight > 0).length;
    return Math.max(maximum, holdings);
  }, 0);
  const summary: BacktestSummary = {
    outputSchemaVersion: BACKTEST_SUMMARY_SCHEMA_VERSION,
    provider: loaded.providerName,
    returnBasis,
    returnNormalization: {
      status: "not_normalized",
      warning: returnBasis === "unadjusted_price"
        ? "Corporate Actions and distributions are not normalized."
        : "Provider adjustment semantics and Point-in-Time safety are unverified.",
    },
    researchLayer: config.researchLayer ?? "unspecified",
    evidenceDisposition: "research_only",
    strategy: config.strategy,
    start: built.frames[0]!.label,
    end: built.frames.at(-1)!.label,
    months: built.frames.length,
    initialEquity: initial,
    finalEquity: Math.round(finalEquityExact),
    cumulativePortfolioReturn: finalEquityExact / initial - 1,
    maxDrawdown: maxDrawdown(simulation.equityCurve),
    totalCostRate: simulation.totalCostRate,
    stopped: simulation.stopped,
    stopLabel: simulation.stopLabel,
    maxObservedHoldings,
    latestWeights: simulation.endingWeights,
    universeMaster: loaded.universeMaster === undefined ? undefined : {
      schemaVersion: loaded.universeMaster.schemaVersion,
      fingerprint: loaded.universeMaster.fingerprint,
      allowedStatuses: [...loaded.universeStatuses!].sort(compareText),
    },
    assetDiagnostics,
  };
  return { summary, frames: built.frames, simulation, loaded };
}

export async function runBacktestConfig(config: BacktestConfig, providerOverride?: string): Promise<BacktestSummary> {
  const validated = validateBacktestConfig(config);
  return executeLoadedBacktest(await loadBacktestInputs(validated, providerOverride)).summary;
}

export async function loadBacktestConfig(configPath: string): Promise<BacktestConfig> {
  return validateBacktestConfig(JSON.parse(await readFile(configPath, "utf8")));
}

export async function runBacktestDetailed(configPath: string, providerOverride?: string): Promise<DetailedBacktestResult> {
  const config = await loadBacktestConfig(configPath);
  return executeLoadedBacktest(await loadBacktestInputs(config, providerOverride));
}

export async function runBacktest(configPath: string, providerOverride?: string): Promise<BacktestSummary> {
  return (await runBacktestDetailed(configPath, providerOverride)).summary;
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
