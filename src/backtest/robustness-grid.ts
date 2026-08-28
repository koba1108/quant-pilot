import { readFile } from "node:fs/promises";
import {
  assertConsecutiveMonthlyLabels,
  annualizedReturn,
  annualizedVolatility,
  sharpe,
  sortino,
  worstMonth,
  worstYear,
} from "./metrics.ts";
import {
  executeLoadedBacktest,
  loadBacktestConfig,
  loadBacktestInputs,
  type BacktestConfig,
  type BacktestReturnBasis,
  type LoadedBacktestInput,
  type ResearchLayer,
} from "./runner.ts";
import { canonicalJson, sha256Canonical } from "../data/provenance.ts";
import {
  DEFAULT_ROTATION_PARAMETERS,
  ROTATION_STRATEGY_VERSION,
  validateRotationParameters,
} from "../strategies/rotation.ts";
import {
  DEFAULT_TREND_PARAMETERS,
  TREND_STRATEGY_VERSION,
  validateTrendParameters,
} from "../strategies/trend.ts";
import type { RotationStrategyParameters, TrendStrategyParameters } from "../strategies/types.ts";
import { compareText } from "../determinism.ts";

export const ROBUSTNESS_GRID_CONFIG_VERSION = "robustness-grid-config-v1" as const;
export const ROBUSTNESS_GRID_OUTPUT_VERSION = "robustness-grid-v1" as const;
const MAX_GRID_SCENARIOS = 2_000;
const SUPPORTED_REBALANCE_TIMING = "month_end_close";
const SUPPORTED_REPLACEMENT_RULE = "immediate_top_n";

export interface RobustnessGridAxes {
  strategies: ("trend" | "rotation")[];
  trendParameters: TrendStrategyParameters[];
  rotationParameters: RotationStrategyParameters[];
  costRates: number[];
  maxAssets: number[];
  volatilityWindowDays: number[];
  rebalanceTimings: string[];
  replacementRules: string[];
}

export interface RobustnessGridConfig {
  schemaVersion: typeof ROBUSTNESS_GRID_CONFIG_VERSION;
  baseConfig: string;
  axes: RobustnessGridAxes;
}

export interface RobustnessScenarioParameters {
  strategy: "trend" | "rotation";
  strategyVersion: typeof TREND_STRATEGY_VERSION | typeof ROTATION_STRATEGY_VERSION;
  strategyParameters: TrendStrategyParameters | RotationStrategyParameters;
  costRate: number;
  maxAssets: number;
  volatilityWindowDays: number;
  rebalanceTiming: string;
  replacementRule: string;
}

export interface UnsupportedAxis {
  axis: "rebalanceTiming" | "replacementRule";
  code: "FRAME_BUILDER_MONTH_END_ONLY" | "SIMULATOR_IMMEDIATE_RESELECT_ONLY";
  requested: string;
  supportedValues: readonly string[];
}

export interface RobustnessScenarioMetrics {
  cumulativePortfolioReturn: number;
  cagr: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  totalTurnover: number;
  totalCostRate: number;
  cashRatio: number;
  worstMonth?: { label: string; return: number };
  worstYear?: { label: string; return: number };
}

export interface RobustnessScenario {
  scenarioId: string;
  parameters: RobustnessScenarioParameters;
  status: "completed" | "unsupported";
  unsupportedAxes?: UnsupportedAxis[];
  result?: {
    months: number;
    initialEquity: number;
    finalEquity: number;
    stopped: boolean;
    stopLabel?: string;
    maxObservedHoldings: number;
  };
  metrics?: RobustnessScenarioMetrics;
}

export interface MetricRange {
  min: number;
  median: number;
  max: number;
}

export interface StabilityGroup {
  strategy: "trend" | "rotation";
  completedCount: number;
  positiveReturnRate: number | null;
  hardStopRate: number | null;
  metrics: {
    cumulativePortfolioReturn: MetricRange | null;
    cagr: MetricRange | null;
    volatility: MetricRange | null;
    sharpe: MetricRange | null;
    sortino: MetricRange | null;
    maxDrawdown: MetricRange | null;
    totalTurnover: MetricRange | null;
    totalCostRate: MetricRange | null;
    cashRatio: MetricRange | null;
  };
}

export type RobustnessAxisName =
  | "strategy"
  | "strategyParameters"
  | "costRate"
  | "maxAssets"
  | "volatilityWindowDays"
  | "rebalanceTiming"
  | "replacementRule";

export interface AxisStabilityGroup {
  axis: RobustnessAxisName;
  value: string | number;
  scenarioCount: number;
  completedCount: number;
  unsupportedCount: number;
  metrics: StabilityGroup["metrics"];
}

export interface RobustnessGridReport {
  outputSchemaVersion: typeof ROBUSTNESS_GRID_OUTPUT_VERSION;
  configSchemaVersion: typeof ROBUSTNESS_GRID_CONFIG_VERSION;
  selectionPolicy: "descriptive_only_no_automatic_winner";
  returnBasis: BacktestReturnBasis;
  returnNormalization: {
    status: "not_normalized";
    warning: string;
  };
  evidenceDisposition: "research_only";
  researchLayer: ResearchLayer | "unspecified";
  inputFingerprint: string;
  inputArtifactIds: readonly string[];
  inputDataContent: readonly { code: string; contentHash: string }[];
  universeMasterFingerprint?: string;
  universeObservationIds: readonly string[];
  capabilities: readonly {
    axis: string;
    status: "supported" | "fixed_only";
    reason?: string;
    supportedValues?: readonly string[];
  }[];
  counts: { total: number; completed: number; unsupported: number };
  scenarios: readonly RobustnessScenario[];
  stability: readonly StabilityGroup[];
  axisStability: readonly AxisStabilityGroup[];
  fingerprint: string;
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

function nonEmptyUniqueStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array.`);
  const output = value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") throw new Error(`${field}[${index}] must be non-empty.`);
    return item;
  });
  if (new Set(output).size !== output.length) throw new Error(`${field} must not contain duplicates.`);
  return output.sort();
}

function finiteUniqueNumbers(
  value: unknown,
  field: string,
  predicate: (item: number) => boolean,
): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array.`);
  const output = value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item) || !predicate(item)) {
      throw new Error(`Invalid ${field}[${index}]: ${String(item)}.`);
    }
    return item;
  });
  if (new Set(output).size !== output.length) throw new Error(`${field} must not contain duplicates.`);
  return output.sort((left, right) => left - right);
}

function parseTrendVariants(value: unknown): TrendStrategyParameters[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("axes.trendParameters must be a non-empty array.");
  const variants = value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`axes.trendParameters[${index}] must be an object.`);
    assertOnlyKeys(item, ["r3mWeight", "r6mWeight", "r12mWeight", "requirePositiveR12m"], `axes.trendParameters[${index}]`);
    return validateTrendParameters({
      r3mWeight: item.r3mWeight as number,
      r6mWeight: item.r6mWeight as number,
      r12mWeight: item.r12mWeight as number,
      requirePositiveR12m: item.requirePositiveR12m as boolean,
    });
  });
  const keys = variants.map(canonicalJson);
  if (new Set(keys).size !== keys.length) throw new Error("axes.trendParameters must not contain duplicates.");
  return variants.sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
}

function parseRotationVariants(value: unknown): RotationStrategyParameters[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("axes.rotationParameters must be a non-empty array.");
  const variants = value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`axes.rotationParameters[${index}] must be an object.`);
    assertOnlyKeys(item, ["r6mWeight", "r12mWeight", "volatilityPenalty", "requirePositiveR12m"], `axes.rotationParameters[${index}]`);
    return validateRotationParameters({
      r6mWeight: item.r6mWeight as number,
      r12mWeight: item.r12mWeight as number,
      volatilityPenalty: item.volatilityPenalty as number,
      requirePositiveR12m: item.requirePositiveR12m as boolean,
    });
  });
  const keys = variants.map(canonicalJson);
  if (new Set(keys).size !== keys.length) throw new Error("axes.rotationParameters must not contain duplicates.");
  return variants.sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
}

export function validateRobustnessGridConfig(value: unknown): RobustnessGridConfig {
  if (!isRecord(value)) throw new Error("Robustness grid config must be an object.");
  assertOnlyKeys(value, ["schemaVersion", "baseConfig", "axes"], "Robustness grid config");
  if (value.schemaVersion !== ROBUSTNESS_GRID_CONFIG_VERSION) {
    throw new Error(`schemaVersion must be ${ROBUSTNESS_GRID_CONFIG_VERSION}.`);
  }
  if (typeof value.baseConfig !== "string" || value.baseConfig.trim() === "") {
    throw new Error("baseConfig must be a non-empty path.");
  }
  if (!isRecord(value.axes)) throw new Error("axes must be an object.");
  assertOnlyKeys(value.axes, [
    "strategies", "trendParameters", "rotationParameters", "costRates", "maxAssets", "volatilityWindowDays",
    "rebalanceTimings", "replacementRules",
  ], "axes");
  const strategyStrings = nonEmptyUniqueStrings(value.axes.strategies, "axes.strategies");
  if (strategyStrings.some((strategy) => strategy !== "trend" && strategy !== "rotation")) {
    throw new Error("axes.strategies supports only trend and rotation.");
  }
  const strategies = strategyStrings as ("trend" | "rotation")[];
  const axes: RobustnessGridAxes = {
    strategies,
    trendParameters: parseTrendVariants(value.axes.trendParameters),
    rotationParameters: parseRotationVariants(value.axes.rotationParameters),
    costRates: finiteUniqueNumbers(value.axes.costRates, "axes.costRates", (item) => item >= 0 && item < 1),
    maxAssets: finiteUniqueNumbers(
      value.axes.maxAssets,
      "axes.maxAssets",
      (item) => Number.isInteger(item) && item >= 1 && item <= 3,
    ),
    volatilityWindowDays: finiteUniqueNumbers(
      value.axes.volatilityWindowDays,
      "axes.volatilityWindowDays",
      (item) => Number.isInteger(item) && item >= 2 && item <= 252,
    ),
    rebalanceTimings: nonEmptyUniqueStrings(value.axes.rebalanceTimings, "axes.rebalanceTimings"),
    replacementRules: nonEmptyUniqueStrings(value.axes.replacementRules, "axes.replacementRules"),
  };
  const variantCount = axes.strategies.reduce(
    (count, strategy) => count + (strategy === "trend" ? axes.trendParameters.length : axes.rotationParameters.length),
    0,
  );
  const scenarioCount = variantCount
    * axes.costRates.length
    * axes.maxAssets.length
    * axes.volatilityWindowDays.length
    * axes.rebalanceTimings.length
    * axes.replacementRules.length;
  if (scenarioCount > MAX_GRID_SCENARIOS) {
    throw new Error(`Robustness grid expands to ${scenarioCount} scenarios; maximum is ${MAX_GRID_SCENARIOS}.`);
  }
  return { schemaVersion: ROBUSTNESS_GRID_CONFIG_VERSION, baseConfig: value.baseConfig, axes };
}

function expandScenarios(config: RobustnessGridConfig): RobustnessScenarioParameters[] {
  const scenarios: RobustnessScenarioParameters[] = [];
  for (const strategy of config.axes.strategies) {
    const variants = strategy === "trend" ? config.axes.trendParameters : config.axes.rotationParameters;
    for (const strategyParameters of variants) {
      for (const costRate of config.axes.costRates) {
        for (const maxAssets of config.axes.maxAssets) {
          for (const volatilityWindowDays of config.axes.volatilityWindowDays) {
            for (const rebalanceTiming of config.axes.rebalanceTimings) {
              for (const replacementRule of config.axes.replacementRules) {
                scenarios.push({
                  strategy,
                  strategyVersion: strategy === "trend" ? TREND_STRATEGY_VERSION : ROTATION_STRATEGY_VERSION,
                  strategyParameters,
                  costRate,
                  maxAssets,
                  volatilityWindowDays,
                  rebalanceTiming,
                  replacementRule,
                });
              }
            }
          }
        }
      }
    }
  }
  return scenarios.sort((left, right) => compareText(left.strategy, right.strategy)
    || compareText(canonicalJson(left.strategyParameters), canonicalJson(right.strategyParameters))
    || left.costRate - right.costRate
    || left.maxAssets - right.maxAssets
    || left.volatilityWindowDays - right.volatilityWindowDays
    || compareText(left.rebalanceTiming, right.rebalanceTiming)
    || compareText(left.replacementRule, right.replacementRule));
}

function unsupportedAxes(parameters: RobustnessScenarioParameters): UnsupportedAxis[] {
  const output: UnsupportedAxis[] = [];
  if (parameters.rebalanceTiming !== SUPPORTED_REBALANCE_TIMING) {
    output.push({
      axis: "rebalanceTiming",
      code: "FRAME_BUILDER_MONTH_END_ONLY",
      requested: parameters.rebalanceTiming,
      supportedValues: [SUPPORTED_REBALANCE_TIMING],
    });
  }
  if (parameters.replacementRule !== SUPPORTED_REPLACEMENT_RULE) {
    output.push({
      axis: "replacementRule",
      code: "SIMULATOR_IMMEDIATE_RESELECT_ONLY",
      requested: parameters.replacementRule,
      supportedValues: [SUPPORTED_REPLACEMENT_RULE],
    });
  }
  return output;
}

function scenarioConfig(base: BacktestConfig, parameters: RobustnessScenarioParameters): BacktestConfig {
  return {
    ...base,
    strategy: parameters.strategy,
    costRate: parameters.costRate,
    maxAssets: parameters.maxAssets,
    volatilityWindowDays: parameters.volatilityWindowDays,
    trendParameters: parameters.strategy === "trend"
      ? parameters.strategyParameters as TrendStrategyParameters
      : undefined,
    rotationParameters: parameters.strategy === "rotation"
      ? parameters.strategyParameters as RotationStrategyParameters
      : undefined,
  };
}

function metricRange(values: number[]): MetricRange | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[midpoint]!
    : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
  return { min: sorted[0]!, median, max: sorted.at(-1)! };
}

function stabilityMetrics(scenarios: readonly RobustnessScenario[]): StabilityGroup["metrics"] {
  const completed = scenarios.filter((scenario) => scenario.status === "completed");
  const values = (selector: (metrics: RobustnessScenarioMetrics) => number) => completed.map((scenario) => selector(scenario.metrics!));
  return {
    cumulativePortfolioReturn: metricRange(values((metrics) => metrics.cumulativePortfolioReturn)),
    cagr: metricRange(values((metrics) => metrics.cagr)),
    volatility: metricRange(values((metrics) => metrics.volatility)),
    sharpe: metricRange(values((metrics) => metrics.sharpe)),
    sortino: metricRange(values((metrics) => metrics.sortino)),
    maxDrawdown: metricRange(values((metrics) => metrics.maxDrawdown)),
    totalTurnover: metricRange(values((metrics) => metrics.totalTurnover)),
    totalCostRate: metricRange(values((metrics) => metrics.totalCostRate)),
    cashRatio: metricRange(values((metrics) => metrics.cashRatio)),
  };
}

function stabilityGroup(
  strategy: "trend" | "rotation",
  scenarios: readonly RobustnessScenario[],
): StabilityGroup {
  const completed = scenarios.filter((scenario) => scenario.status === "completed" && scenario.parameters.strategy === strategy);
  return {
    strategy,
    completedCount: completed.length,
    positiveReturnRate: completed.length === 0
      ? null
      : completed.filter((scenario) => scenario.metrics!.cumulativePortfolioReturn > 0).length / completed.length,
    hardStopRate: completed.length === 0
      ? null
      : completed.filter((scenario) => scenario.result!.stopped).length / completed.length,
    metrics: stabilityMetrics(completed),
  };
}

function axisValue(parameters: RobustnessScenarioParameters, axis: RobustnessAxisName): string | number {
  if (axis === "strategyParameters") return canonicalJson(parameters.strategyParameters);
  return parameters[axis];
}

function buildAxisStability(scenarios: readonly RobustnessScenario[]): AxisStabilityGroup[] {
  const axes: readonly RobustnessAxisName[] = [
    "strategy",
    "strategyParameters",
    "costRate",
    "maxAssets",
    "volatilityWindowDays",
    "rebalanceTiming",
    "replacementRule",
  ];
  const output: AxisStabilityGroup[] = [];
  for (const axis of axes) {
    const groups = new Map<string, { value: string | number; scenarios: RobustnessScenario[] }>();
    for (const scenario of scenarios) {
      const value = axisValue(scenario.parameters, axis);
      const key = canonicalJson(value);
      const group = groups.get(key) ?? { value, scenarios: [] };
      group.scenarios.push(scenario);
      groups.set(key, group);
    }
    for (const { value, scenarios: groupedScenarios } of [...groups.values()]
      .sort((left, right) => compareText(canonicalJson(left.value), canonicalJson(right.value)))) {
      const completedCount = groupedScenarios.filter((scenario) => scenario.status === "completed").length;
      output.push({
        axis,
        value,
        scenarioCount: groupedScenarios.length,
        completedCount,
        unsupportedCount: groupedScenarios.length - completedCount,
        metrics: stabilityMetrics(groupedScenarios),
      });
    }
  }
  return output;
}

export async function runRobustnessGridConfig(config: RobustnessGridConfig): Promise<RobustnessGridReport> {
  const base = await loadBacktestConfig(config.baseConfig);
  const expanded = expandScenarios(config);
  const executable = expanded.filter((parameters) => unsupportedAxes(parameters).length === 0);
  const loaded: LoadedBacktestInput | undefined = executable.length === 0
    ? undefined
    : await loadBacktestInputs(base);
  const appliedUniverseObservationIds = new Set<string>();
  const scenarios: RobustnessScenario[] = [];
  for (const parameters of expanded) {
    const scenarioId = sha256Canonical(parameters);
    const unsupported = unsupportedAxes(parameters);
    if (unsupported.length > 0) {
      scenarios.push({ scenarioId, parameters, status: "unsupported", unsupportedAxes: unsupported });
      continue;
    }
    const detail = executeLoadedBacktest(loaded!, scenarioConfig(base, parameters));
    const labels = detail.frames.map((frame) => frame.label);
    assertConsecutiveMonthlyLabels(labels);
    for (const diagnostic of detail.summary.assetDiagnostics) {
      for (const decision of diagnostic.universeDecisions ?? []) {
        if (decision.observationId !== undefined) appliedUniverseObservationIds.add(decision.observationId);
      }
    }
    const metrics: RobustnessScenarioMetrics = {
      cumulativePortfolioReturn: detail.summary.cumulativePortfolioReturn,
      cagr: annualizedReturn(detail.simulation.monthlyReturns),
      volatility: annualizedVolatility(detail.simulation.monthlyReturns),
      sharpe: sharpe(detail.simulation.monthlyReturns),
      sortino: sortino(detail.simulation.monthlyReturns),
      maxDrawdown: detail.summary.maxDrawdown,
      totalTurnover: detail.simulation.totalTurnover,
      totalCostRate: detail.simulation.totalCostRate,
      cashRatio: detail.simulation.averageCashWeight,
      worstMonth: worstMonth(labels, detail.simulation.monthlyReturns),
      worstYear: worstYear(labels, detail.simulation.monthlyReturns),
    };
    scenarios.push({
      scenarioId,
      parameters,
      status: "completed",
      result: {
        months: detail.summary.months,
        initialEquity: detail.summary.initialEquity,
        finalEquity: detail.summary.finalEquity,
        stopped: detail.summary.stopped,
        stopLabel: detail.summary.stopLabel,
        maxObservedHoldings: detail.summary.maxObservedHoldings,
      },
      metrics,
    });
  }

  const completed = scenarios.filter((scenario) => scenario.status === "completed").length;
  const inputArtifactIds = loaded === undefined
    ? []
    : loaded.assets.flatMap((asset) => asset.provenance?.artifactId ?? []).sort(compareText);
  const inputDataContent = loaded === undefined
    ? []
    : loaded.assets.map((asset) => ({ code: asset.code, contentHash: asset.dataContentHash }))
      .sort((left, right) => compareText(left.code, right.code));
  const universeMasterFingerprint = loaded?.universeMaster?.fingerprint;
  const universeObservationIds = [...appliedUniverseObservationIds].sort(compareText);
  const reportWithoutFingerprint = {
    outputSchemaVersion: ROBUSTNESS_GRID_OUTPUT_VERSION,
    configSchemaVersion: ROBUSTNESS_GRID_CONFIG_VERSION,
    selectionPolicy: "descriptive_only_no_automatic_winner" as const,
    returnBasis: base.returnBasis ?? "provider_adjusted" as const,
    returnNormalization: {
      status: "not_normalized" as const,
      warning: "Corporate Actions, distributions, per-observation availability, and JPY conversion are not integrated into this grid.",
    },
    evidenceDisposition: "research_only" as const,
    researchLayer: base.researchLayer ?? "unspecified" as const,
    inputFingerprint: sha256Canonical({
      base,
      inputArtifactIds,
      inputDataContent,
      universeMasterFingerprint,
      universeObservationIds,
    }),
    inputArtifactIds,
    inputDataContent,
    universeMasterFingerprint,
    universeObservationIds,
    capabilities: [
      { axis: "strategyParameters", status: "supported" as const },
      { axis: "costRate", status: "supported" as const },
      { axis: "maxAssets", status: "supported" as const },
      { axis: "volatilityWindowDays", status: "supported" as const },
      {
        axis: "rebalanceTiming",
        status: "fixed_only" as const,
        reason: "Alternative calendar timing and next-open execution are not implemented.",
        supportedValues: [SUPPORTED_REBALANCE_TIMING],
      },
      {
        axis: "replacementRule",
        status: "fixed_only" as const,
        reason: "Hysteresis, minimum holding periods, and no-trade bands are not implemented.",
        supportedValues: [SUPPORTED_REPLACEMENT_RULE],
      },
    ],
    counts: { total: scenarios.length, completed, unsupported: scenarios.length - completed },
    scenarios,
    stability: (["trend", "rotation"] as const).map((strategy) => stabilityGroup(strategy, scenarios)),
    axisStability: buildAxisStability(scenarios),
  };
  return { ...reportWithoutFingerprint, fingerprint: sha256Canonical(reportWithoutFingerprint) };
}

export async function runRobustnessGrid(configPath: string): Promise<RobustnessGridReport> {
  return runRobustnessGridConfig(validateRobustnessGridConfig(JSON.parse(await readFile(configPath, "utf8"))));
}

async function main(): Promise<void> {
  const configPath = arg("config") ?? "robustness-grid.config.json";
  const report = await runRobustnessGrid(configPath);
  console.log(JSON.stringify(report, null, 2));
  if (report.counts.completed === 0) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export const PROVISIONAL_STRATEGY_PARAMETERS = {
  trend: DEFAULT_TREND_PARAMETERS,
  rotation: DEFAULT_ROTATION_PARAMETERS,
};
