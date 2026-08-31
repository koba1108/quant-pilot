import { compareText } from "../determinism.ts";
import { inverseVolWeights, MAX_PORTFOLIO_ASSETS, type Weights } from "../portfolio/allocator.ts";
import { oneWayCostRate } from "../portfolio/costs.ts";
import {
  buildVersionedDataArtifact,
  canonicalJson,
  isIsoDateTime,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../data/provenance.ts";
import {
  assertUniverseMasterIntegrity,
  evaluateUniverseMembershipAtCutoff,
  type UniverseMaster,
  type UniverseMembershipDecision,
} from "../data/universe-master.ts";
import { rankRotation } from "../strategies/rotation.ts";
import { rankTrend } from "../strategies/trend.ts";
import type { AssetSnapshot, RankedAsset } from "../strategies/types.ts";
import {
  PRE_FORWARD_MODE,
  validatePreForwardConfig,
  type PreForwardConfig,
  type PreForwardExecutionInstrumentConfig,
  type PreForwardStrategyConfig,
} from "./config.ts";
import {
  assertLoadedPreForwardInputIntegrity,
  type LoadedPreForwardInput,
  type LoadedPreForwardSeries,
} from "./market-input.ts";

export const VIRTUAL_PORTFOLIO_STATE_SCHEMA_VERSION = "virtual-portfolio-state-v1" as const;
export const PRE_FORWARD_DECISION_PACKAGE_SCHEMA_VERSION = "pre-forward-decision-package-v6" as const;
export const PRE_FORWARD_DECISION_ENGINE_VERSION = "pre-forward-decision-engine-v7" as const;
export const PRE_FORWARD_RUN_REPORT_SCHEMA_VERSION = "pre-forward-run-report-v1" as const;
export const PRE_FORWARD_DISTRIBUTION_POLICY_ID = "d018-virtual-receivable-pay-date-v1" as const;
export const PRE_FORWARD_DAILY_CLOSE_NOT_BEFORE_UTC = "07:00:00Z" as const;

const ARTIFACT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface VirtualPosition {
  code: string;
  units: number;
  averageCostJpy: number;
}

export interface VirtualDistributionReceivable {
  receivableId: string;
  code: string;
  exDate: string;
  payDate: string;
  grossAmountJpy: number;
}

export interface VirtualPortfolioState {
  schemaVersion: typeof VIRTUAL_PORTFOLIO_STATE_SCHEMA_VERSION;
  portfolioId: string;
  cashJpy: number;
  positions: readonly VirtualPosition[];
  distributionReceivables: readonly VirtualDistributionReceivable[];
  highWaterMarkJpy: number;
  stopped: boolean;
  stoppedAt?: string;
  lastAsOf?: string;
  fingerprint: string;
}

export interface PreForwardPositionValuation extends VirtualPosition {
  marketPriceJpy: number;
  marketValueJpy: number;
}

export interface PreForwardPortfolioValuation {
  cashJpy: number;
  positions: readonly PreForwardPositionValuation[];
  distributionReceivablesJpy: number;
  totalEquityJpy: number;
  highWaterMarkJpy: number;
  drawdown: number;
}

export interface PreForwardInstrumentDiagnostic {
  code: string;
  artifactId?: string;
  source?: string;
  dataset?: string;
  artifactAvailableAt?: string;
  availabilityBasis?: LoadedPreForwardSeries["availabilityBasis"];
  returnBasis?: LoadedPreForwardSeries["returnBasis"];
  returnEventCoverage?: LoadedPreForwardSeries["returnEventCoverage"];
  totalBarCount: number;
  usableBarCount: number;
  excludedFutureBarCount: number;
  excludedUnavailableBarCount: number;
  excludedPreListingBarCount: number;
  excludedPostEligibilityBarCount: number;
  firstTradingDate?: string;
  signalDate?: string;
  signalBarAvailableAt?: string;
  dataAgeDays?: number;
  universeDecision?: UniverseMembershipDecision;
  execution?: {
    marketPriceJpy: number;
    tradingUnit: number;
    oneWayCostRate: number;
    expectedBenefit?: PreForwardExecutionInstrumentConfig["expectedBenefit"];
  };
  snapshot?: AssetSnapshot;
  status: "ready" | "blocked";
  blockers: readonly string[];
}

export interface PreForwardBenefitGateDecision {
  code: string;
  action: "buy_from_cash";
  policyVersion: string;
  evidenceBasis: "synthetic_fixture_assumption";
  evidenceId: string;
  evidenceAvailableAt: string;
  grossExpectedBenefitBps: number;
  estimatedExecutionCostBps: number;
  safetyMarginBps: number;
  requiredGrossBenefitBps: number;
  passed: boolean;
}

export interface VirtualOrder {
  orderId: string;
  sequence: number;
  code: string;
  side: "buy" | "sell";
  units: number;
  tradingUnit: number;
  priceJpy: number;
  grossJpy: number;
  costRate: number;
  modeledCostJpy: number;
  cashDeltaJpy: number;
  reason: "rebalance" | "hard_stop_before_rebalance" | "hard_stop_after_cost";
  benefitGate?: PreForwardBenefitGateDecision;
  riskOverride?: "d010_mandatory_liquidation";
}

export interface VirtualExecution extends VirtualOrder {
  executionId: string;
  status: "filled_virtual";
  priceSource: "latest_unadjusted_close_proxy";
}

export interface DistributionSettlement {
  receivableId: string;
  code: string;
  payDate: string;
  amountJpy: number;
}

export interface PreForwardDecisionPackage {
  schemaVersion: typeof PRE_FORWARD_DECISION_PACKAGE_SCHEMA_VERSION;
  engineVersion: typeof PRE_FORWARD_DECISION_ENGINE_VERSION;
  mode: typeof PRE_FORWARD_MODE;
  formalForwardClockStarted: false;
  status: "executed" | "blocked";
  runKey: string;
  cycleId: string;
  asOf: string;
  asOfDate: string;
  createdAt: string;
  portfolioId: string;
  strategy: {
    name: "trend" | "rotation";
    strategyVersion: string;
    strategyConfigVersion: string;
    parameters: PreForwardStrategyConfig["parameters"];
    parametersFingerprint: string;
    provisionalResearchParameters: true;
  };
  configFingerprint: string;
  input: {
    evidenceTier: LoadedPreForwardInput["evidenceTier"];
    disposition: "research_only";
    inputArtifactIds: readonly string[];
    parentAuditArtifactId?: string;
    loadedInputIntegrityFingerprint: string;
    inputFingerprint: string;
    missingCapabilities: readonly string[];
    limitations: readonly string[];
  };
  universe: {
    masterFingerprint?: string;
    snapshotArtifactId?: string;
    allowedStatuses: readonly string[];
    supportedCurrencies: readonly ["JPY"];
  };
  instrumentDiagnostics: readonly PreForwardInstrumentDiagnostic[];
  quantDecision: {
    snapshots: readonly AssetSnapshot[];
    ranking: readonly RankedAsset[];
    requestedTargetWeights: Weights;
    effectiveTargetWeights: Weights;
    selectionMode: "quant_rank_plus_cost_benefit_gate_m2";
    benefitGate: {
      policyVersion: string;
      scope: "initial_cash_to_asset_only";
      safetyMarginBps: number;
      decisions: readonly PreForwardBenefitGateDecision[];
      replacementPolicy: "blocked_pending_o006";
    };
  };
  committee: {
    status: "not_invoked_for_m2_deterministic_strategy_ab";
    overrideApplied: false;
    limitation: string;
  };
  distributionAccounting: {
    policyId: typeof PRE_FORWARD_DISTRIBUTION_POLICY_ID;
    coverage: "not_applicable_initial_cash_cycle" | "complete_synthetic_no_events" | "missing_event_artifacts";
    openingReceivables: readonly VirtualDistributionReceivable[];
    createdReceivables: readonly [];
    settlements: readonly DistributionSettlement[];
  };
  risk: {
    maxHoldings: number;
    drawdownLimit: -0.3;
    highWaterMarkJpy: number;
    equityBeforeJpy?: number;
    drawdownBefore?: number;
    hardStopTriggered: boolean;
    hardStopPhase?: "before_rebalance" | "after_cost";
    stoppedBefore: boolean;
    stoppedAfter: boolean;
    valuationEventCoverage:
      | "not_applicable_initial_cash_cycle"
      | "complete_synthetic_no_events"
      | "missing_event_artifacts";
  };
  execution: {
    policyVersion: string;
    priceSource: "latest_unadjusted_close_proxy";
    commissionBps: number;
    slippageBps: number;
    fallbackHalfSpreadBps: number;
    fxConversionBps: 0;
    orders: readonly VirtualOrder[];
    executions: readonly VirtualExecution[];
    totalModeledCostJpy: number;
    stateTransitionApplied: boolean;
  };
  portfolio: {
    beforeState: VirtualPortfolioState;
    beforeValuation?: PreForwardPortfolioValuation;
    afterState: VirtualPortfolioState;
    afterValuation?: PreForwardPortfolioValuation;
  };
  ledger: {
    expectedHeadBefore?: string;
  };
  blockedReasons: readonly string[];
  packageFingerprint: string;
}

export interface BuildPreForwardDecisionRequest {
  config: PreForwardConfig;
  configFingerprint: string;
  strategy: PreForwardStrategyConfig;
  asOf: string;
  createdAt: string;
  input: LoadedPreForwardInput;
  universeMaster?: UniverseMaster;
  universeSnapshotArtifactId?: string;
  beforeState: VirtualPortfolioState;
  expectedLedgerHead?: string;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function roundJpy(value: number): number {
  if (!Number.isFinite(value)) throw new Error("JPY amount must be finite.");
  return Math.round(value);
}

function normalizedNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Portfolio number must be finite.");
  return Object.is(value, -0) ? 0 : value;
}

function stateBody(input: Omit<VirtualPortfolioState, "fingerprint">): Omit<VirtualPortfolioState, "fingerprint"> {
  return {
    schemaVersion: VIRTUAL_PORTFOLIO_STATE_SCHEMA_VERSION,
    portfolioId: input.portfolioId,
    cashJpy: normalizedNumber(input.cashJpy),
    positions: [...input.positions].map((position) => ({ ...position })).sort((left, right) => compareText(left.code, right.code)),
    distributionReceivables: [...input.distributionReceivables]
      .map((receivable) => ({ ...receivable }))
      .sort((left, right) => compareText(left.receivableId, right.receivableId)),
    highWaterMarkJpy: normalizedNumber(input.highWaterMarkJpy),
    stopped: input.stopped,
    stoppedAt: input.stoppedAt,
    lastAsOf: input.lastAsOf,
  };
}

export function buildVirtualPortfolioState(
  input: Omit<VirtualPortfolioState, "schemaVersion" | "fingerprint">,
): VirtualPortfolioState {
  const body = stateBody({ schemaVersion: VIRTUAL_PORTFOLIO_STATE_SCHEMA_VERSION, ...input });
  const state = { ...body, fingerprint: sha256Canonical(body) };
  assertVirtualPortfolioState(state);
  return state;
}

export function createInitialVirtualPortfolioState(
  portfolioId: string,
  initialCashJpy = 1_000_000,
): VirtualPortfolioState {
  return buildVirtualPortfolioState({
    portfolioId,
    cashJpy: initialCashJpy,
    positions: [],
    distributionReceivables: [],
    highWaterMarkJpy: initialCashJpy,
    stopped: false,
  });
}

export function assertVirtualPortfolioState(state: VirtualPortfolioState): void {
  if (state.schemaVersion !== VIRTUAL_PORTFOLIO_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported virtual portfolio state schema: ${String(state.schemaVersion)}.`);
  }
  if (typeof state.portfolioId !== "string" || state.portfolioId.trim() === "") {
    throw new Error("Virtual portfolio state portfolioId must be non-empty.");
  }
  if (!Number.isFinite(state.cashJpy) || state.cashJpy < 0) throw new Error("Virtual portfolio cash must be non-negative.");
  if (!Number.isFinite(state.highWaterMarkJpy) || state.highWaterMarkJpy <= 0) {
    throw new Error("Virtual portfolio highWaterMarkJpy must be positive.");
  }
  if (!Array.isArray(state.positions) || state.positions.length > MAX_PORTFOLIO_ASSETS) {
    throw new Error(`Virtual portfolio may contain at most ${MAX_PORTFOLIO_ASSETS} positions.`);
  }
  let priorCode = "";
  for (const position of state.positions) {
    if (position.code.trim() === "" || (priorCode !== "" && compareText(priorCode, position.code) >= 0)) {
      throw new Error("Virtual portfolio positions must have unique, sorted codes.");
    }
    if (!Number.isInteger(position.units) || position.units <= 0
      || !Number.isFinite(position.averageCostJpy) || position.averageCostJpy < 0) {
      throw new Error(`Virtual portfolio position is invalid for ${position.code}.`);
    }
    priorCode = position.code;
  }
  let priorReceivable = "";
  for (const receivable of state.distributionReceivables) {
    if (receivable.receivableId.trim() === ""
      || (priorReceivable !== "" && compareText(priorReceivable, receivable.receivableId) >= 0)
      || !isIsoDate(receivable.exDate)
      || !isIsoDate(receivable.payDate)
      || receivable.payDate < receivable.exDate
      || !Number.isFinite(receivable.grossAmountJpy)
      || receivable.grossAmountJpy < 0) {
      throw new Error(`Virtual distribution receivable is invalid: ${receivable.receivableId}.`);
    }
    priorReceivable = receivable.receivableId;
  }
  if (state.lastAsOf !== undefined && !isIsoDateTime(state.lastAsOf)) {
    throw new Error("Virtual portfolio lastAsOf must be an ISO timestamp with timezone.");
  }
  if (state.stopped) {
    if (state.stoppedAt === undefined || !isIsoDateTime(state.stoppedAt)) {
      throw new Error("Stopped virtual portfolio state must include stoppedAt.");
    }
  } else if (state.stoppedAt !== undefined) {
    throw new Error("Active virtual portfolio state must not include stoppedAt.");
  }
  const { fingerprint, ...body } = state;
  if (fingerprint !== sha256Canonical(body)) throw new Error("Virtual portfolio state fingerprint is invalid.");
}

function annualizedVolatility(prices: readonly number[]): number {
  if (prices.length < 2) return 0;
  const returns: number[] = [];
  for (let index = 1; index < prices.length; index++) {
    returns.push(Math.log(prices[index]! / prices[index - 1]!));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function calendarAgeDays(latestDate: string, asOfDate: string): number {
  return Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${latestDate}T00:00:00Z`)) / 86_400_000);
}

export function preForwardBarAvailableAt(series: LoadedPreForwardSeries, tradingDate: string): string {
  if (!isIsoDate(tradingDate)) throw new Error(`Invalid pre-forward bar trading date: ${tradingDate}.`);
  const conservativeCloseFloor = Date.parse(`${tradingDate}T${PRE_FORWARD_DAILY_CLOSE_NOT_BEFORE_UTC}`);
  const artifactAvailability = Date.parse(series.availableAt);
  if (!Number.isFinite(artifactAvailability)) {
    throw new Error(`Invalid pre-forward artifact availability for ${series.code}.`);
  }
  return new Date(Math.max(conservativeCloseFloor, artifactAvailability)).toISOString();
}

function buildSnapshot(bars: readonly LoadedPreForwardSeries["bars"][number][], windowDays: number): AssetSnapshot {
  const currentIndex = bars.length - 1;
  const current = bars[currentIndex]!.adjustedClose;
  const p3 = bars[currentIndex - 63]!.adjustedClose;
  const p6 = bars[currentIndex - 126]!.adjustedClose;
  const p12 = bars[currentIndex - 252]!.adjustedClose;
  const volWindow = bars.slice(Math.max(0, currentIndex - windowDays), currentIndex + 1)
    .map((bar) => bar.adjustedClose);
  return {
    code: bars[currentIndex]!.code,
    r3m: current / p3 - 1,
    r6m: current / p6 - 1,
    r12m: current / p12 - 1,
    volatility: annualizedVolatility(volWindow),
    eligible: true,
  };
}

interface DiagnosticBuildResult {
  diagnostics: PreForwardInstrumentDiagnostic[];
  priceByCode: Map<string, number>;
  executionByCode: Map<string, PreForwardExecutionInstrumentConfig>;
  costRateByCode: Map<string, number>;
  heldEventCoverageReadyCodes: Set<string>;
}

function heldIntervalHasCompleteSyntheticEventCoverage(
  series: LoadedPreForwardSeries | undefined,
  previousAsOf: string | undefined,
  latestTradingDate: string | undefined,
  asOf: string,
): boolean {
  if (series === undefined || previousAsOf === undefined || latestTradingDate === undefined) return false;
  const coverage = series.returnEventCoverage;
  if (coverage === undefined) return false;
  const previousDate = previousAsOf.slice(0, 10);
  return coverage.basis === "synthetic_complete_no_events_v1"
    && coverage.corporateActions === "complete"
    && coverage.distributions === "complete"
    && coverage.startDate <= previousDate
    && coverage.endDate >= asOf.slice(0, 10)
    && Date.parse(coverage.availableAt) <= Date.parse(asOf);
}

function buildInstrumentDiagnostics(request: BuildPreForwardDecisionRequest, asOfDate: string): DiagnosticBuildResult {
  const seriesByCode = new Map<string, LoadedPreForwardSeries>();
  for (const series of request.input.series) {
    if (seriesByCode.has(series.code)) throw new Error(`Pre-forward input contains duplicate series for ${series.code}.`);
    seriesByCode.set(series.code, series);
  }
  const executionByCode = new Map(request.config.execution.instruments.map((item) => [item.code, item]));
  const stateCodes = request.beforeState.positions.map((position) => position.code);
  const heldCodes = new Set(stateCodes);
  const heldEventCoverageReadyCodes = new Set<string>();
  const codes = [...new Set([...seriesByCode.keys(), ...executionByCode.keys(), ...stateCodes])].sort(compareText);
  const priceByCode = new Map<string, number>();
  const costRateByCode = new Map<string, number>();
  const policy = {
    allowedStatuses: new Set(request.config.universe.allowedStatuses),
    supportedCurrencies: new Set(request.config.universe.supportedCurrencies),
  };
  const diagnostics = codes.map((code): PreForwardInstrumentDiagnostic => {
    const blockers: string[] = [];
    const series = seriesByCode.get(code);
    const execution = executionByCode.get(code);
    if (series === undefined) blockers.push("missing_daily_bars_artifact");
    if (execution === undefined) blockers.push("missing_execution_assumptions");
    if (execution?.expectedBenefit === undefined) {
      blockers.push("missing_expected_benefit_evidence");
    } else if (execution?.expectedBenefit !== undefined
      && Date.parse(execution.expectedBenefit.availableAt) > Date.parse(request.asOf)) {
      blockers.push("expected_benefit_not_available_as_of");
    }
    const dateEligibleBars = series?.bars.filter((bar) => bar.tradingDate <= asOfDate) ?? [];
    const excludedFutureBarCount = series === undefined ? 0 : series.bars.length - dateEligibleBars.length;
    const availableBars = series === undefined ? [] : dateEligibleBars.filter((bar) => (
      Date.parse(preForwardBarAvailableAt(series, bar.tradingDate)) <= Date.parse(request.asOf)
    ));
    const excludedUnavailableBarCount = dateEligibleBars.length - availableBars.length;
    if (series !== undefined && Date.parse(series.availableAt) > Date.parse(request.asOf)) {
      blockers.push("artifact_not_available_as_of");
    }
    let universeDecision: UniverseMembershipDecision | undefined;
    if (request.universeMaster === undefined) {
      blockers.push("universe_master_missing");
    } else {
      universeDecision = evaluateUniverseMembershipAtCutoff(
        request.universeMaster,
        code,
        asOfDate,
        request.asOf,
        policy,
      );
      if (!universeDecision.eligible) blockers.push(`universe_${universeDecision.reason ?? "not_eligible"}`);
    }
    const excludedPreListingBarCount = universeDecision?.listingDate === undefined
      ? 0
      : availableBars.filter((bar) => bar.tradingDate < universeDecision.listingDate!).length;
    const excludedPostEligibilityBarCount = universeDecision?.lastEligibleDate === undefined
      ? 0
      : availableBars.filter((bar) => bar.tradingDate > universeDecision.lastEligibleDate!).length;
    const bars = availableBars.filter((bar) => (
      (universeDecision?.listingDate === undefined || bar.tradingDate >= universeDecision.listingDate)
        && (universeDecision?.lastEligibleDate === undefined || bar.tradingDate <= universeDecision.lastEligibleDate)
    ));
    const latest = bars.at(-1);
    if (bars.length === 0) blockers.push("no_bar_on_or_before_as_of");
    if (bars.length < request.config.signal.minHistoryBars) blockers.push("insufficient_history");
    let dataAgeDays: number | undefined;
    if (latest !== undefined) {
      dataAgeDays = calendarAgeDays(latest.tradingDate, asOfDate);
      if (dataAgeDays < 0) blockers.push("future_market_data");
      if (dataAgeDays > request.config.signal.maxDataAgeDays) blockers.push("stale_market_data");
    }
    if (heldCodes.has(code)
      && request.beforeState.lastAsOf !== undefined
      && Date.parse(request.asOf) > Date.parse(request.beforeState.lastAsOf)) {
      if (heldIntervalHasCompleteSyntheticEventCoverage(
        series,
        request.beforeState.lastAsOf,
        latest?.tradingDate,
        request.asOf,
      )) {
        heldEventCoverageReadyCodes.add(code);
      } else {
        blockers.push("held_interval_return_event_coverage_missing");
      }
    }
    let executionAudit: PreForwardInstrumentDiagnostic["execution"];
    if (latest !== undefined && execution !== undefined && series !== undefined
      && Date.parse(series.availableAt) <= Date.parse(request.asOf)
      && dataAgeDays !== undefined && dataAgeDays >= 0
      && dataAgeDays <= request.config.signal.maxDataAgeDays) {
      const costRate = oneWayCostRate(execution.spreadBps, {
        commissionBps: request.config.execution.commissionBps,
        slippageBps: request.config.execution.slippageBps,
        fallbackHalfSpreadBps: request.config.execution.fallbackHalfSpreadBps,
        fxConversionBps: request.config.execution.fxConversionBps,
      });
      priceByCode.set(code, latest.close);
      costRateByCode.set(code, costRate);
      executionAudit = {
        marketPriceJpy: latest.close,
        tradingUnit: execution.tradingUnit,
        oneWayCostRate: costRate,
        expectedBenefit: execution.expectedBenefit,
      };
    }
    let snapshot: AssetSnapshot | undefined;
    const historyRequired = Math.max(253, request.config.signal.minHistoryBars);
    if (blockers.length === 0 && bars.length >= historyRequired) {
      snapshot = buildSnapshot(bars, request.config.signal.volatilityWindowDays);
      if (!Number.isFinite(snapshot.volatility) || snapshot.volatility <= 0) {
        blockers.push("invalid_or_zero_volatility");
        snapshot = undefined;
      }
    }
    const uniqueBlockers = [...new Set(blockers)].sort(compareText);
    return {
      code,
      artifactId: series?.artifactId,
      source: series?.source,
      dataset: series?.dataset,
      artifactAvailableAt: series?.availableAt,
      availabilityBasis: series?.availabilityBasis,
      returnBasis: series?.returnBasis,
      returnEventCoverage: series?.returnEventCoverage,
      totalBarCount: series?.bars.length ?? 0,
      usableBarCount: bars.length,
      excludedFutureBarCount,
      excludedUnavailableBarCount,
      excludedPreListingBarCount,
      excludedPostEligibilityBarCount,
      firstTradingDate: bars[0]?.tradingDate,
      signalDate: latest?.tradingDate,
      signalBarAvailableAt: latest === undefined || series === undefined
        ? undefined
        : preForwardBarAvailableAt(series, latest.tradingDate),
      dataAgeDays,
      universeDecision,
      execution: executionAudit,
      snapshot,
      status: uniqueBlockers.length === 0 ? "ready" : "blocked",
      blockers: uniqueBlockers,
    };
  });
  return { diagnostics, priceByCode, executionByCode, costRateByCode, heldEventCoverageReadyCodes };
}

function normalizedBps(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Basis-point value must be finite.");
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function buildBenefitGateDecisions(
  request: BuildPreForwardDecisionRequest,
  ranking: readonly RankedAsset[],
  diagnostics: DiagnosticBuildResult,
): PreForwardBenefitGateDecision[] {
  return ranking.map((asset): PreForwardBenefitGateDecision => {
    const execution = diagnostics.executionByCode.get(asset.code);
    const costRate = diagnostics.costRateByCode.get(asset.code);
    const evidence = execution?.expectedBenefit;
    if (execution === undefined || costRate === undefined || evidence === undefined) {
      throw new Error(`Ranked asset lacks D-009 cost-benefit evidence: ${asset.code}.`);
    }
    const estimatedExecutionCostBps = normalizedBps(costRate * 10_000);
    const safetyMarginBps = request.config.execution.benefitGate.safetyMarginBps;
    const requiredGrossBenefitBps = normalizedBps(estimatedExecutionCostBps + safetyMarginBps);
    return {
      code: asset.code,
      action: "buy_from_cash",
      policyVersion: request.config.execution.benefitGate.policyVersion,
      evidenceBasis: evidence.basis,
      evidenceId: evidence.evidenceId,
      evidenceAvailableAt: evidence.availableAt,
      grossExpectedBenefitBps: evidence.grossExpectedBenefitBps,
      estimatedExecutionCostBps,
      safetyMarginBps,
      requiredGrossBenefitBps,
      passed: evidence.grossExpectedBenefitBps > requiredGrossBenefitBps,
    };
  });
}

function valuation(
  state: VirtualPortfolioState,
  prices: ReadonlyMap<string, number>,
  highWaterMarkJpy: number,
): PreForwardPortfolioValuation | undefined {
  const positions: PreForwardPositionValuation[] = [];
  for (const position of state.positions) {
    const marketPriceJpy = prices.get(position.code);
    if (marketPriceJpy === undefined) return undefined;
    positions.push({
      ...position,
      marketPriceJpy,
      marketValueJpy: roundJpy(position.units * marketPriceJpy),
    });
  }
  const distributionReceivablesJpy = roundJpy(
    state.distributionReceivables.reduce((sum, receivable) => sum + receivable.grossAmountJpy, 0),
  );
  const totalEquityJpy = roundJpy(
    state.cashJpy
      + positions.reduce((sum, position) => sum + position.marketValueJpy, 0)
      + distributionReceivablesJpy,
  );
  return {
    cashJpy: state.cashJpy,
    positions,
    distributionReceivablesJpy,
    totalEquityJpy,
    highWaterMarkJpy,
    drawdown: highWaterMarkJpy <= 0 ? 0 : totalEquityJpy / highWaterMarkJpy - 1,
  };
}

function settleReceivables(
  state: VirtualPortfolioState,
  asOfDate: string,
): { state: VirtualPortfolioState; settlements: DistributionSettlement[] } {
  const matured = state.distributionReceivables.filter((receivable) => receivable.payDate <= asOfDate);
  const remaining = state.distributionReceivables.filter((receivable) => receivable.payDate > asOfDate);
  const settlements = matured.map((receivable) => ({
    receivableId: receivable.receivableId,
    code: receivable.code,
    payDate: receivable.payDate,
    amountJpy: roundJpy(receivable.grossAmountJpy),
  }));
  return {
    state: buildVirtualPortfolioState({
      portfolioId: state.portfolioId,
      cashJpy: roundJpy(state.cashJpy + settlements.reduce((sum, item) => sum + item.amountJpy, 0)),
      positions: state.positions,
      distributionReceivables: remaining,
      highWaterMarkJpy: state.highWaterMarkJpy,
      stopped: state.stopped,
      stoppedAt: state.stoppedAt,
      lastAsOf: state.lastAsOf,
    }),
    settlements,
  };
}

interface ExecutionResult {
  state: VirtualPortfolioState;
  orders: VirtualOrder[];
  executions: VirtualExecution[];
}

function executeTargets(
  runKey: string,
  state: VirtualPortfolioState,
  targetWeights: Weights,
  priority: readonly string[],
  prices: ReadonlyMap<string, number>,
  executionByCode: ReadonlyMap<string, PreForwardExecutionInstrumentConfig>,
  costRateByCode: ReadonlyMap<string, number>,
  benefitGateByCode: ReadonlyMap<string, PreForwardBenefitGateDecision>,
  reason: VirtualOrder["reason"],
): ExecutionResult {
  const currentByCode = new Map(state.positions.map((position) => [position.code, { ...position }]));
  const investableValue = roundJpy(
    state.cashJpy + state.positions.reduce((sum, position) => (
      sum + roundJpy(position.units * prices.get(position.code)!)
    ), 0),
  );
  const targetUnits = new Map<string, number>();
  for (const [code, weight] of Object.entries(targetWeights)) {
    if (code === "CASH" || weight <= 0) continue;
    const price = prices.get(code);
    const execution = executionByCode.get(code);
    const costRate = costRateByCode.get(code);
    if (price === undefined || execution === undefined || costRate === undefined) {
      throw new Error(`Cannot execute target without complete price/cost/unit assumptions for ${code}.`);
    }
    const lotGross = price * execution.tradingUnit;
    const costAdjustedBudget = investableValue * weight / (1 + costRate);
    targetUnits.set(code, Math.floor(costAdjustedBudget / lotGross) * execution.tradingUnit);
  }
  for (const position of state.positions) {
    if (!targetUnits.has(position.code)) targetUnits.set(position.code, 0);
  }

  let cashJpy = state.cashJpy;
  const orders: VirtualOrder[] = [];
  const executions: VirtualExecution[] = [];
  const append = (code: string, side: VirtualOrder["side"], units: number): void => {
    if (units <= 0) return;
    const priceJpy = prices.get(code)!;
    const execution = executionByCode.get(code)!;
    const costRate = costRateByCode.get(code)!;
    const grossJpy = roundJpy(priceJpy * units);
    const modeledCostJpy = roundJpy(grossJpy * costRate);
    const cashDeltaJpy = side === "buy" ? -(grossJpy + modeledCostJpy) : grossJpy - modeledCostJpy;
    const sequence = orders.length + 1;
    let benefitGate: PreForwardBenefitGateDecision | undefined;
    let riskOverride: VirtualOrder["riskOverride"];
    if (reason === "rebalance") {
      if (side !== "buy") {
        throw new Error("Ordinary held-asset replacement remains blocked pending an approved O-006 policy.");
      }
      benefitGate = benefitGateByCode.get(code);
      if (benefitGate === undefined
        || !benefitGate.passed
        || benefitGate.grossExpectedBenefitBps
          <= benefitGate.estimatedExecutionCostBps + benefitGate.safetyMarginBps) {
        throw new Error(`D-009 cost-benefit gate rejected virtual order for ${code}.`);
      }
    } else {
      riskOverride = "d010_mandatory_liquidation";
    }
    const orderBody = {
      sequence, code, side, units, tradingUnit: execution.tradingUnit, priceJpy,
      grossJpy, costRate, modeledCostJpy, cashDeltaJpy, reason, benefitGate, riskOverride,
    };
    const order: VirtualOrder = { orderId: sha256Canonical({ runKey, ...orderBody }), ...orderBody };
    const filled: VirtualExecution = {
      ...order,
      executionId: sha256Canonical({ orderId: order.orderId, status: "filled_virtual" }),
      status: "filled_virtual",
      priceSource: "latest_unadjusted_close_proxy",
    };
    orders.push(order);
    executions.push(filled);
    cashJpy = roundJpy(cashJpy + cashDeltaJpy);
  };

  for (const code of [...targetUnits.keys()].sort(compareText)) {
    const current = currentByCode.get(code)?.units ?? 0;
    const target = targetUnits.get(code)!;
    if (current <= target) continue;
    append(code, "sell", current - target);
    const position = currentByCode.get(code)!;
    if (target === 0) currentByCode.delete(code);
    else currentByCode.set(code, { ...position, units: target });
  }

  const buyPriority = [...new Set([...priority, ...[...targetUnits.keys()].sort(compareText)])];
  for (const code of buyPriority) {
    const target = targetUnits.get(code) ?? 0;
    const current = currentByCode.get(code)?.units ?? 0;
    if (target <= current) continue;
    const price = prices.get(code)!;
    const execution = executionByCode.get(code)!;
    const costRate = costRateByCode.get(code)!;
    const oneLotGross = roundJpy(price * execution.tradingUnit);
    const oneLotCost = roundJpy(oneLotGross * costRate);
    const affordableLots = Math.floor(cashJpy / (oneLotGross + oneLotCost));
    const requestedLots = Math.floor((target - current) / execution.tradingUnit);
    const units = Math.min(affordableLots, requestedLots) * execution.tradingUnit;
    if (units <= 0) continue;
    const old = currentByCode.get(code);
    const gross = roundJpy(price * units);
    const modeledCost = roundJpy(gross * costRate);
    append(code, "buy", units);
    const newUnits = current + units;
    const oldBook = old === undefined ? 0 : old.averageCostJpy * old.units;
    currentByCode.set(code, {
      code,
      units: newUnits,
      averageCostJpy: (oldBook + gross + modeledCost) / newUnits,
    });
  }
  if (cashJpy < 0) throw new Error("Virtual execution produced negative cash.");
  const positions = [...currentByCode.values()].filter((position) => position.units > 0).sort((a, b) => compareText(a.code, b.code));
  if (positions.length > MAX_PORTFOLIO_ASSETS) throw new Error("Virtual execution exceeded the three-holding hard limit.");
  return {
    state: buildVirtualPortfolioState({
      portfolioId: state.portfolioId,
      cashJpy,
      positions,
      distributionReceivables: state.distributionReceivables,
      highWaterMarkJpy: state.highWaterMarkJpy,
      stopped: state.stopped,
      stoppedAt: state.stoppedAt,
      lastAsOf: state.lastAsOf,
    }),
    orders,
    executions,
  };
}

function withStateMetadata(
  state: VirtualPortfolioState,
  asOf: string,
  highWaterMarkJpy: number,
  stopped: boolean,
  stoppedAt: string | undefined,
): VirtualPortfolioState {
  return buildVirtualPortfolioState({
    portfolioId: state.portfolioId,
    cashJpy: state.cashJpy,
    positions: state.positions,
    distributionReceivables: state.distributionReceivables,
    highWaterMarkJpy,
    stopped,
    stoppedAt,
    lastAsOf: asOf,
  });
}

export function preForwardCycleId(asOf: string): string {
  if (!isIsoDateTime(asOf)) throw new Error("Pre-forward cycle requires an ISO timestamp with timezone.");
  return asOf.slice(0, 7);
}

export function buildPreForwardRunKey(strategy: PreForwardStrategyConfig, asOf: string): string {
  return sha256Canonical({
    mode: PRE_FORWARD_MODE,
    portfolioId: strategy.portfolioId,
    strategy: strategy.strategy,
    cycleId: preForwardCycleId(asOf),
  });
}

function packageWithFingerprint(
  input: Omit<PreForwardDecisionPackage, "packageFingerprint">,
): PreForwardDecisionPackage {
  const payload = { ...input, packageFingerprint: sha256Canonical(input) };
  assertPreForwardDecisionPackage(payload);
  return payload;
}

export function buildPreForwardDecisionPackage(
  request: BuildPreForwardDecisionRequest,
): PreForwardDecisionPackage {
  const validatedConfig = validatePreForwardConfig(request.config);
  if (canonicalJson(validatedConfig) !== canonicalJson(request.config)
    || request.configFingerprint !== sha256Canonical(validatedConfig)) {
    throw new Error("Pre-forward config changed after validation.");
  }
  const configuredStrategy = validatedConfig.strategies.find((candidate) => (
    candidate.portfolioId === request.strategy.portfolioId
      && candidate.strategy === request.strategy.strategy
  ));
  if (configuredStrategy === undefined
    || canonicalJson(configuredStrategy) !== canonicalJson(request.strategy)) {
    throw new Error("Pre-forward strategy is not bound to the validated config.");
  }
  assertLoadedPreForwardInputIntegrity(request.input);
  assertVirtualPortfolioState(request.beforeState);
  if (!isIsoDateTime(request.asOf)) throw new Error("Pre-forward asOf must be an ISO timestamp with timezone.");
  if (!isIsoDateTime(request.createdAt) || Date.parse(request.createdAt) < Date.parse(request.asOf)) {
    throw new Error("Pre-forward createdAt must be an ISO timestamp at or after asOf.");
  }
  if (request.beforeState.portfolioId !== request.strategy.portfolioId) {
    throw new Error("Pre-forward portfolio state does not match the strategy portfolioId.");
  }
  if ((request.universeMaster === undefined) !== (request.universeSnapshotArtifactId === undefined)
    || request.universeSnapshotArtifactId !== undefined
      && !ARTIFACT_ID_PATTERN.test(request.universeSnapshotArtifactId)) {
    throw new Error("Pre-forward Universe master must be bound to its retained snapshot artifact.");
  }
  if (request.universeMaster !== undefined) assertUniverseMasterIntegrity(request.universeMaster);
  const asOfDate = request.asOf.slice(0, 10);
  if (!isIsoDate(asOfDate)) throw new Error("Pre-forward asOf does not contain a valid declared market date.");
  const cycleId = preForwardCycleId(request.asOf);
  const runKey = buildPreForwardRunKey(request.strategy, request.asOf);
  const diagnosticResult = buildInstrumentDiagnostics(request, asOfDate);
  const snapshots = diagnosticResult.diagnostics.flatMap((diagnostic) => (
    diagnostic.snapshot === undefined ? [] : [diagnostic.snapshot]
  ));
  const ranking = request.strategy.strategy === "trend"
    ? rankTrend(snapshots, request.strategy.parameters)
    : rankRotation(snapshots, request.strategy.parameters);
  const requestedTargetWeights = inverseVolWeights(ranking, request.strategy.maxAssets);
  const benefitGateDecisions = buildBenefitGateDecisions(request, ranking, diagnosticResult);
  const passedBenefitCodes = new Set(
    benefitGateDecisions.filter((decision) => decision.passed).map((decision) => decision.code),
  );
  const benefitGatedRanking = ranking.filter((asset) => passedBenefitCodes.has(asset.code));
  const benefitGatedTargetWeights = inverseVolWeights(benefitGatedRanking, request.strategy.maxAssets);
  const benefitGateByCode = new Map(benefitGateDecisions.map((decision) => [decision.code, decision]));
  const blockedReasons = diagnosticResult.diagnostics.flatMap((diagnostic) => (
    diagnostic.blockers.map((blocker) => `${diagnostic.code}:${blocker}`)
  ));
  const chronologyValid = request.beforeState.lastAsOf === undefined
    || Date.parse(request.asOf) > Date.parse(request.beforeState.lastAsOf);
  if (!chronologyValid) {
    blockedReasons.push("portfolio:as_of_not_after_last_state");
  }
  if (request.beforeState.lastAsOf !== undefined
    && preForwardCycleId(request.beforeState.lastAsOf) === cycleId
    && Date.parse(request.asOf) > Date.parse(request.beforeState.lastAsOf)) {
    blockedReasons.push("portfolio:intramonth_reassessment_not_authorized");
  }
  if (request.beforeState.positions.length > 0) {
    blockedReasons.push("portfolio:cost_aware_replacement_policy_not_approved");
  }
  const heldEventCoverageComplete = request.beforeState.positions.length > 0
    && request.beforeState.positions.every((position) => (
      diagnosticResult.heldEventCoverageReadyCodes.has(position.code)
    ));
  const valuationEventCoverage = request.beforeState.positions.length === 0
    ? "not_applicable_initial_cash_cycle" as const
    : heldEventCoverageComplete
      ? "complete_synthetic_no_events" as const
      : "missing_event_artifacts" as const;
  const distributionCoverage = valuationEventCoverage;
  if (valuationEventCoverage === "missing_event_artifacts") {
    blockedReasons.push("portfolio:distribution_event_coverage_missing_for_held_interval");
    blockedReasons.push("portfolio:corporate_action_unit_coverage_missing_for_held_interval");
  }
  blockedReasons.sort(compareText);

  const beforeHwm = request.beforeState.highWaterMarkJpy;
  const rawBeforeValuation = request.beforeState.positions.length === 0
    || (chronologyValid && heldEventCoverageComplete)
    ? valuation(request.beforeState, diagnosticResult.priceByCode, beforeHwm)
    : undefined;
  const beforeHwmAtCutoff = rawBeforeValuation === undefined
    ? beforeHwm
    : Math.max(beforeHwm, rawBeforeValuation.totalEquityJpy);
  const beforeValuation = rawBeforeValuation === undefined
    ? undefined
    : valuation(request.beforeState, diagnosticResult.priceByCode, beforeHwmAtCutoff);
  if (request.beforeState.positions.length > 0
    && valuationEventCoverage !== "missing_event_artifacts"
    && beforeValuation === undefined) {
    blockedReasons.push("portfolio:missing_valuation_price_for_held_asset");
  }
  const stoppedBefore = request.beforeState.stopped;
  const hardStopBefore = beforeValuation !== undefined
    && beforeValuation.drawdown <= request.config.portfolio.drawdownLimit;
  const forceCash = stoppedBefore || hardStopBefore;
  const canLiquidate = request.beforeState.positions.every((position) => (
    diagnosticResult.priceByCode.has(position.code)
      && diagnosticResult.executionByCode.has(position.code)
      && diagnosticResult.costRateByCode.has(position.code)
  ));
  if (forceCash && !canLiquidate) blockedReasons.push("portfolio:cannot_liquidate_missing_execution_input");
  const uniqueBlockedReasons = [...new Set(blockedReasons)].sort(compareText);

  let status: PreForwardDecisionPackage["status"] = "blocked";
  let effectiveTargetWeights: Weights = forceCash ? { CASH: 1 } : benefitGatedTargetWeights;
  let afterState = request.beforeState;
  let afterValuation: PreForwardPortfolioValuation | undefined;
  let settlements: DistributionSettlement[] = [];
  let orders: VirtualOrder[] = [];
  let executions: VirtualExecution[] = [];
  let hardStopPhase: PreForwardDecisionPackage["risk"]["hardStopPhase"];
  let hardStopTriggered = false;

  const safetyLiquidationAllowed = forceCash
    && request.beforeState.positions.length > 0
    && chronologyValid
    && valuationEventCoverage !== "missing_event_artifacts"
    && canLiquidate
    && beforeValuation !== undefined;
  if (safetyLiquidationAllowed || uniqueBlockedReasons.length === 0) {
    status = "executed";
    const settled = settleReceivables(request.beforeState, asOfDate);
    settlements = settled.settlements;
    let workingState = settled.state;
    if (forceCash) {
      effectiveTargetWeights = { CASH: 1 };
      hardStopTriggered = hardStopBefore;
      hardStopPhase = hardStopBefore ? "before_rebalance" : undefined;
      const liquidated = executeTargets(
        runKey,
        workingState,
        effectiveTargetWeights,
        [],
        diagnosticResult.priceByCode,
        diagnosticResult.executionByCode,
        diagnosticResult.costRateByCode,
        new Map(),
        "hard_stop_before_rebalance",
      );
      workingState = liquidated.state;
      orders = liquidated.orders;
      executions = liquidated.executions;
    } else {
      const rebalanced = executeTargets(
        runKey,
        workingState,
        benefitGatedTargetWeights,
        benefitGatedRanking.map((asset) => asset.code),
        diagnosticResult.priceByCode,
        diagnosticResult.executionByCode,
        diagnosticResult.costRateByCode,
        benefitGateByCode,
        "rebalance",
      );
      workingState = rebalanced.state;
      orders = rebalanced.orders;
      executions = rebalanced.executions;
      const interimValuation = valuation(workingState, diagnosticResult.priceByCode, beforeHwmAtCutoff)!;
      if (interimValuation.drawdown <= request.config.portfolio.drawdownLimit) {
        hardStopTriggered = true;
        hardStopPhase = "after_cost";
        effectiveTargetWeights = { CASH: 1 };
        const liquidated = executeTargets(
          runKey,
          workingState,
          effectiveTargetWeights,
          [],
          diagnosticResult.priceByCode,
          diagnosticResult.executionByCode,
          diagnosticResult.costRateByCode,
          new Map(),
          "hard_stop_after_cost",
        );
        const orderOffset = orders.length;
        const renumbered = liquidated.orders.map((order, index) => {
          const sequence = orderOffset + index + 1;
          const { orderId: _orderId, ...body } = order;
          const orderBody = { ...body, sequence };
          return { orderId: sha256Canonical({ ...orderBody, runKey }), ...orderBody };
        });
        const renumberedExecutions = renumbered.map((order): VirtualExecution => ({
          ...order,
          executionId: sha256Canonical({ orderId: order.orderId, status: "filled_virtual" }),
          status: "filled_virtual",
          priceSource: "latest_unadjusted_close_proxy",
        }));
        orders.push(...renumbered);
        executions.push(...renumberedExecutions);
        workingState = liquidated.state;
      }
    }
    const provisionalAfter = valuation(workingState, diagnosticResult.priceByCode, beforeHwmAtCutoff)!;
    const afterHwm = Math.max(beforeHwmAtCutoff, provisionalAfter.totalEquityJpy);
    const stoppedAfter = stoppedBefore || hardStopTriggered;
    afterState = withStateMetadata(
      workingState,
      request.asOf,
      afterHwm,
      stoppedAfter,
      stoppedAfter ? request.beforeState.stoppedAt ?? request.asOf : undefined,
    );
    afterValuation = valuation(afterState, diagnosticResult.priceByCode, afterHwm);
  }

  const totalModeledCostJpy = orders.reduce((sum, order) => sum + order.modeledCostJpy, 0);
  const inputFingerprint = sha256Canonical({
    loadedInputIntegrityFingerprint: request.input.integrityFingerprint,
    universeMasterFingerprint: request.universeMaster?.fingerprint,
    universeSnapshotArtifactId: request.universeSnapshotArtifactId,
  });
  return packageWithFingerprint({
    schemaVersion: PRE_FORWARD_DECISION_PACKAGE_SCHEMA_VERSION,
    engineVersion: PRE_FORWARD_DECISION_ENGINE_VERSION,
    mode: PRE_FORWARD_MODE,
    formalForwardClockStarted: false,
    status,
    runKey,
    cycleId,
    asOf: request.asOf,
    asOfDate,
    createdAt: request.createdAt,
    portfolioId: request.strategy.portfolioId,
    strategy: {
      name: request.strategy.strategy,
      strategyVersion: request.strategy.strategyVersion,
      strategyConfigVersion: request.strategy.strategyConfigVersion,
      parameters: request.strategy.parameters,
      parametersFingerprint: sha256Canonical(request.strategy.parameters),
      provisionalResearchParameters: true,
    },
    configFingerprint: request.configFingerprint,
    input: {
      evidenceTier: request.input.evidenceTier,
      disposition: "research_only",
      inputArtifactIds: request.input.inputArtifactIds,
      parentAuditArtifactId: request.input.parentAuditArtifactId,
      loadedInputIntegrityFingerprint: request.input.integrityFingerprint,
      inputFingerprint,
      missingCapabilities: request.input.missingCapabilities,
      limitations: request.input.limitations,
    },
    universe: {
      masterFingerprint: request.universeMaster?.fingerprint,
      snapshotArtifactId: request.universeSnapshotArtifactId,
      allowedStatuses: request.config.universe.allowedStatuses,
      supportedCurrencies: request.config.universe.supportedCurrencies,
    },
    instrumentDiagnostics: diagnosticResult.diagnostics,
    quantDecision: {
      snapshots,
      ranking,
      requestedTargetWeights,
      effectiveTargetWeights,
      selectionMode: "quant_rank_plus_cost_benefit_gate_m2",
      benefitGate: {
        policyVersion: request.config.execution.benefitGate.policyVersion,
        scope: "initial_cash_to_asset_only",
        safetyMarginBps: request.config.execution.benefitGate.safetyMarginBps,
        decisions: benefitGateDecisions,
        replacementPolicy: "blocked_pending_o006",
      },
    },
    committee: {
      status: "not_invoked_for_m2_deterministic_strategy_ab",
      overrideApplied: false,
      limitation: "M2 exercises deterministic Strategy A/B only; no AI committee evidence or override is fabricated.",
    },
    distributionAccounting: {
      policyId: PRE_FORWARD_DISTRIBUTION_POLICY_ID,
      coverage: distributionCoverage,
      openingReceivables: request.beforeState.distributionReceivables,
      createdReceivables: [],
      settlements,
    },
    risk: {
      maxHoldings: request.strategy.maxAssets,
      drawdownLimit: -0.3,
      highWaterMarkJpy: beforeHwmAtCutoff,
      equityBeforeJpy: beforeValuation?.totalEquityJpy,
      drawdownBefore: beforeValuation?.drawdown,
      hardStopTriggered,
      hardStopPhase,
      stoppedBefore,
      stoppedAfter: afterState.stopped,
      valuationEventCoverage,
    },
    execution: {
      policyVersion: request.config.execution.policyVersion,
      priceSource: request.config.execution.priceSource,
      commissionBps: request.config.execution.commissionBps,
      slippageBps: request.config.execution.slippageBps,
      fallbackHalfSpreadBps: request.config.execution.fallbackHalfSpreadBps,
      fxConversionBps: 0,
      orders,
      executions,
      totalModeledCostJpy,
      stateTransitionApplied: status === "executed",
    },
    portfolio: {
      beforeState: request.beforeState,
      beforeValuation,
      afterState,
      afterValuation,
    },
    ledger: { expectedHeadBefore: request.expectedLedgerHead },
    blockedReasons: uniqueBlockedReasons,
  });
}

export function assertPreForwardDecisionPackage(payload: PreForwardDecisionPackage): void {
  if (payload.schemaVersion !== PRE_FORWARD_DECISION_PACKAGE_SCHEMA_VERSION
    || payload.engineVersion !== PRE_FORWARD_DECISION_ENGINE_VERSION
    || payload.mode !== PRE_FORWARD_MODE
    || payload.formalForwardClockStarted !== false) {
    throw new Error("Pre-forward Decision Package identity is invalid.");
  }
  if (!isIsoDateTime(payload.asOf)
    || payload.asOf.slice(0, 10) !== payload.asOfDate
    || !isIsoDate(payload.asOfDate)
    || payload.cycleId !== preForwardCycleId(payload.asOf)
    || !isIsoDateTime(payload.createdAt)
    || Date.parse(payload.createdAt) < Date.parse(payload.asOf)) {
    throw new Error("Pre-forward Decision Package asOf is invalid.");
  }
  if (!ARTIFACT_ID_PATTERN.test(payload.runKey)
    || !ARTIFACT_ID_PATTERN.test(payload.configFingerprint)
    || !ARTIFACT_ID_PATTERN.test(payload.input.loadedInputIntegrityFingerprint)
    || !ARTIFACT_ID_PATTERN.test(payload.input.inputFingerprint)
    || !ARTIFACT_ID_PATTERN.test(payload.strategy.parametersFingerprint)) {
    throw new Error("Pre-forward Decision Package fingerprints are invalid.");
  }
  if (payload.input.inputFingerprint !== sha256Canonical({
    loadedInputIntegrityFingerprint: payload.input.loadedInputIntegrityFingerprint,
    universeMasterFingerprint: payload.universe.masterFingerprint,
    universeSnapshotArtifactId: payload.universe.snapshotArtifactId,
  })) {
    throw new Error("Pre-forward Decision Package input fingerprint is not bound to its loaded inputs.");
  }
  if ((payload.universe.masterFingerprint === undefined) !== (payload.universe.snapshotArtifactId === undefined)
    || payload.universe.masterFingerprint !== undefined
      && !ARTIFACT_ID_PATTERN.test(payload.universe.masterFingerprint)
    || payload.universe.snapshotArtifactId !== undefined
      && !ARTIFACT_ID_PATTERN.test(payload.universe.snapshotArtifactId)) {
    throw new Error("Pre-forward Decision Package Universe is not bound to a retained snapshot artifact.");
  }
  if (payload.runKey !== sha256Canonical({
    mode: PRE_FORWARD_MODE,
    portfolioId: payload.portfolioId,
    strategy: payload.strategy.name,
    cycleId: payload.cycleId,
  })) {
    throw new Error("Pre-forward Decision Package run key is not bound to its monthly cycle.");
  }
  assertVirtualPortfolioState(payload.portfolio.beforeState);
  assertVirtualPortfolioState(payload.portfolio.afterState);
  if (payload.portfolio.beforeState.portfolioId !== payload.portfolioId
    || payload.portfolio.afterState.portfolioId !== payload.portfolioId) {
    throw new Error("Pre-forward Decision Package portfolio states are not bound to portfolioId.");
  }
  const chronological = payload.portfolio.beforeState.lastAsOf === undefined
    || Date.parse(payload.asOf) > Date.parse(payload.portfolio.beforeState.lastAsOf);
  if (!chronological
    && (payload.status !== "blocked" || !payload.blockedReasons.includes("portfolio:as_of_not_after_last_state"))) {
    throw new Error("Pre-forward safety handling must not bypass portfolio chronology.");
  }
  const diagnosticByCode = new Map(payload.instrumentDiagnostics.map((diagnostic) => [diagnostic.code, diagnostic]));
  for (const diagnostic of payload.instrumentDiagnostics) {
    const barCounts = [
      diagnostic.totalBarCount,
      diagnostic.usableBarCount,
      diagnostic.excludedFutureBarCount,
      diagnostic.excludedUnavailableBarCount,
      diagnostic.excludedPreListingBarCount,
      diagnostic.excludedPostEligibilityBarCount,
    ];
    const countedBars = diagnostic.usableBarCount
      + diagnostic.excludedFutureBarCount
      + diagnostic.excludedUnavailableBarCount
      + diagnostic.excludedPreListingBarCount
      + diagnostic.excludedPostEligibilityBarCount;
    if (barCounts.some((count) => !Number.isInteger(count) || count < 0)
      || countedBars !== diagnostic.totalBarCount
      || diagnostic.signalDate !== undefined && (
        diagnostic.signalBarAvailableAt === undefined
          || !isIsoDateTime(diagnostic.signalBarAvailableAt)
          || Date.parse(diagnostic.signalBarAvailableAt) > Date.parse(payload.asOf)
          || diagnostic.universeDecision?.listingDate !== undefined
            && diagnostic.signalDate < diagnostic.universeDecision.listingDate
          || diagnostic.universeDecision?.lastEligibleDate !== undefined
            && diagnostic.signalDate > diagnostic.universeDecision.lastEligibleDate
      )
      || diagnostic.signalDate === undefined && diagnostic.signalBarAvailableAt !== undefined) {
      throw new Error(`Pre-forward bar lifecycle or availability audit is invalid for ${diagnostic.code}.`);
    }
  }
  const completeHeldEventCoverage = payload.portfolio.beforeState.positions.length > 0
    && chronological
    && payload.portfolio.beforeState.lastAsOf !== undefined
    && payload.portfolio.beforeState.positions.every((position) => {
      const diagnostic = diagnosticByCode.get(position.code);
      const coverage = diagnostic?.returnEventCoverage;
      return diagnostic?.signalDate !== undefined
        && coverage?.basis === "synthetic_complete_no_events_v1"
        && coverage.corporateActions === "complete"
        && coverage.distributions === "complete"
        && coverage.startDate <= payload.portfolio.beforeState.lastAsOf!.slice(0, 10)
        && coverage.endDate >= payload.asOfDate
        && Date.parse(coverage.availableAt) <= Date.parse(payload.asOf);
    });
  const expectedValuationEventCoverage = payload.portfolio.beforeState.positions.length === 0
    ? "not_applicable_initial_cash_cycle"
    : completeHeldEventCoverage
      ? "complete_synthetic_no_events"
      : "missing_event_artifacts";
  if (payload.risk.valuationEventCoverage !== expectedValuationEventCoverage
    || payload.distributionAccounting.coverage !== expectedValuationEventCoverage) {
    throw new Error("Pre-forward holding-period event coverage is inconsistent with its diagnostics.");
  }
  if (expectedValuationEventCoverage === "missing_event_artifacts"
    && (payload.status !== "blocked"
      || payload.portfolio.beforeValuation !== undefined
      || payload.risk.hardStopTriggered
      || payload.execution.orders.some((order) => order.reason !== "rebalance")
      || !payload.blockedReasons.includes("portfolio:corporate_action_unit_coverage_missing_for_held_interval")
      || !payload.blockedReasons.includes("portfolio:distribution_event_coverage_missing_for_held_interval"))) {
    throw new Error("Pre-forward must fail closed before valuing held units without complete return-event coverage.");
  }
  if (payload.risk.maxHoldings < 1 || payload.risk.maxHoldings > MAX_PORTFOLIO_ASSETS
    || payload.portfolio.afterState.positions.length > payload.risk.maxHoldings) {
    throw new Error("Pre-forward Decision Package violates the maximum holding constraint.");
  }
  if (payload.risk.drawdownLimit !== -0.3) throw new Error("Pre-forward Decision Package weakens the hard stop.");
  if (payload.risk.hardStopTriggered
    && (!payload.portfolio.afterState.stopped || payload.portfolio.afterState.positions.length !== 0)) {
    throw new Error("A hard-stopped Decision Package must end stopped and fully liquidated.");
  }
  if (payload.status === "blocked") {
    if (payload.blockedReasons.length === 0
      || payload.execution.stateTransitionApplied
      || payload.execution.orders.length > 0
      || payload.execution.executions.length > 0
      || canonicalJson(payload.portfolio.beforeState) !== canonicalJson(payload.portfolio.afterState)) {
      throw new Error("Blocked Decision Package must preserve portfolio state and contain no virtual trade.");
    }
  } else if (!payload.execution.stateTransitionApplied) {
    throw new Error("Executed Decision Package must apply exactly one virtual state transition.");
  }
  if (payload.execution.orders.length !== payload.execution.executions.length) {
    throw new Error("Every virtual order must have exactly one virtual execution.");
  }
  if (payload.quantDecision.selectionMode !== "quant_rank_plus_cost_benefit_gate_m2"
    || payload.quantDecision.benefitGate.scope !== "initial_cash_to_asset_only"
    || payload.quantDecision.benefitGate.replacementPolicy !== "blocked_pending_o006") {
    throw new Error("Pre-forward D-009 benefit-gate identity is invalid.");
  }
  const benefitDecisions = payload.quantDecision.benefitGate.decisions;
  if (benefitDecisions.length !== payload.quantDecision.ranking.length
    || benefitDecisions.some((decision, index) => decision.code !== payload.quantDecision.ranking[index]?.code)
    || new Set(benefitDecisions.map((decision) => decision.code)).size !== benefitDecisions.length) {
    throw new Error("Pre-forward D-009 benefit decisions do not match the ranked candidates.");
  }
  for (const decision of benefitDecisions) {
    const required = normalizedBps(decision.estimatedExecutionCostBps + decision.safetyMarginBps);
    if (decision.action !== "buy_from_cash"
      || decision.policyVersion !== payload.quantDecision.benefitGate.policyVersion
      || decision.evidenceBasis !== "synthetic_fixture_assumption"
      || typeof decision.evidenceId !== "string"
      || decision.evidenceId.length === 0
      || decision.safetyMarginBps !== payload.quantDecision.benefitGate.safetyMarginBps
      || !Number.isFinite(decision.grossExpectedBenefitBps)
      || !Number.isFinite(decision.estimatedExecutionCostBps)
      || decision.estimatedExecutionCostBps < 0
      || decision.requiredGrossBenefitBps !== required
      || decision.passed !== (decision.grossExpectedBenefitBps > required)
      || !isIsoDateTime(decision.evidenceAvailableAt)
      || Date.parse(decision.evidenceAvailableAt) > Date.parse(payload.asOf)) {
      throw new Error(`Pre-forward D-009 benefit decision is invalid for ${decision.code}.`);
    }
  }
  const benefitByCode = new Map(benefitDecisions.map((decision) => [decision.code, decision]));
  const expectedRequestedWeights = inverseVolWeights([...payload.quantDecision.ranking], payload.risk.maxHoldings);
  const expectedEffectiveWeights = inverseVolWeights(
    payload.quantDecision.ranking.filter((asset) => benefitByCode.get(asset.code)?.passed === true),
    payload.risk.maxHoldings,
  );
  if (canonicalJson(payload.quantDecision.requestedTargetWeights) !== canonicalJson(expectedRequestedWeights)
    || canonicalJson(payload.quantDecision.effectiveTargetWeights) !== canonicalJson(
      payload.risk.hardStopTriggered || payload.risk.stoppedBefore ? { CASH: 1 } : expectedEffectiveWeights,
    )) {
    throw new Error("Pre-forward target weights do not match ranking, D-009 gates, and risk overrides.");
  }
  for (const [index, order] of payload.execution.orders.entries()) {
    const execution = payload.execution.executions[index];
    const { orderId: _orderId, ...orderBody } = order;
    const expectedOrderId = sha256Canonical({ runKey: payload.runKey, ...orderBody });
    if (execution === undefined
      || execution.orderId !== order.orderId
      || order.orderId !== expectedOrderId
      || execution.executionId !== sha256Canonical({ orderId: order.orderId, status: "filled_virtual" })
      || order.sequence !== index + 1
      || order.grossJpy !== roundJpy(order.priceJpy * order.units)
      || order.modeledCostJpy !== roundJpy(order.grossJpy * order.costRate)
      || order.cashDeltaJpy !== (order.side === "buy"
        ? -(order.grossJpy + order.modeledCostJpy)
        : order.grossJpy - order.modeledCostJpy)
      || (order.reason === "rebalance"
        ? order.side !== "buy"
          || order.riskOverride !== undefined
          || order.benefitGate === undefined
          || canonicalJson(order.benefitGate) !== canonicalJson(benefitByCode.get(order.code))
          || !order.benefitGate.passed
          || order.benefitGate.code !== order.code
          || order.benefitGate.estimatedExecutionCostBps !== normalizedBps(order.costRate * 10_000)
          || order.benefitGate.grossExpectedBenefitBps
            <= order.benefitGate.estimatedExecutionCostBps + order.benefitGate.safetyMarginBps
        : order.benefitGate !== undefined || order.riskOverride !== "d010_mandatory_liquidation")) {
      throw new Error("Virtual order/execution sequence is inconsistent.");
    }
  }
  if (payload.execution.totalModeledCostJpy
    !== payload.execution.orders.reduce((sum, order) => sum + order.modeledCostJpy, 0)) {
    throw new Error("Pre-forward total modeled cost does not match its virtual orders.");
  }
  const { packageFingerprint, ...body } = payload;
  if (packageFingerprint !== sha256Canonical(body)) {
    throw new Error("Pre-forward Decision Package fingerprint is invalid.");
  }
}

export function buildPreForwardDecisionArtifact(
  payload: PreForwardDecisionPackage,
): VersionedDataArtifact<PreForwardDecisionPackage> {
  assertPreForwardDecisionPackage(payload);
  return buildVersionedDataArtifact({
    artifactKind: "decision_package",
    payload,
    source: "quant-pilot",
    dataset: "pre-forward-decision-package",
    sourceVersion: payload.schemaVersion,
    adapterVersion: payload.engineVersion,
    observedAt: payload.asOf,
    availableAt: payload.createdAt,
    retrievedAt: payload.createdAt,
    request: {
      runKey: payload.runKey,
      cycleId: payload.cycleId,
      createdAt: payload.createdAt,
      configFingerprint: payload.configFingerprint,
      loadedInputIntegrityFingerprint: payload.input.loadedInputIntegrityFingerprint,
      inputFingerprint: payload.input.inputFingerprint,
      universeSnapshotArtifactId: payload.universe.snapshotArtifactId,
      expectedLedgerHead: payload.ledger.expectedHeadBefore,
    },
    recordId: payload.runKey,
  });
}
