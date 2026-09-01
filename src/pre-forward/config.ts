import { isAbsolute } from "node:path";
import {
  ROTATION_STRATEGY_VERSION,
  validateRotationParameters,
} from "../strategies/rotation.ts";
import {
  TREND_STRATEGY_VERSION,
  validateTrendParameters,
} from "../strategies/trend.ts";
import type {
  RotationStrategyParameters,
  TrendStrategyParameters,
} from "../strategies/types.ts";
import { isIsoDateTime } from "../data/provenance.ts";
import { oneWayCostRate } from "../portfolio/costs.ts";

export const PRE_FORWARD_CONFIG_SCHEMA_VERSION = "pre-forward-config-v2" as const;
export const PRE_FORWARD_MODE = "pre_forward_dry_run" as const;

export interface PreForwardPath {
  kind: "relative" | "absolute";
  path: string;
}

export interface DailyBarsManifestInput {
  kind: "daily_bars_manifest";
  evidenceTier: "synthetic_fixture";
  dailyBarsArtifactIds: readonly string[];
}

export interface CredentialedSampleAuditInput {
  kind: "credentialed_sample_audit";
  auditArtifactId: string;
  sampleConfigPath: string;
  providerId: "jquants_v2" | "eodhd_eod";
}

export type PreForwardInput = DailyBarsManifestInput | CredentialedSampleAuditInput;

export interface PreForwardUniverseConfig {
  masterPath?: string;
  allowedStatuses: readonly string[];
  supportedCurrencies: readonly ["JPY"];
}

export interface PreForwardSignalConfig {
  minHistoryBars: number;
  volatilityWindowDays: number;
  maxDataAgeDays: number;
  priceField: "adjustedClose";
}

export interface PreForwardExecutionInstrumentConfig {
  code: string;
  tradingUnit: number;
  spreadBps?: number;
  expectedBenefit?: {
    basis: "synthetic_fixture_assumption";
    evidenceId: string;
    availableAt: string;
    grossExpectedBenefitBps: number;
  };
}

export interface PreForwardExecutionConfig {
  policyVersion: string;
  benefitGate: {
    policyVersion: string;
    safetyMarginBps: number;
  };
  priceSource: "latest_unadjusted_close_proxy";
  commissionBps: number;
  slippageBps: number;
  fallbackHalfSpreadBps: number;
  fxConversionBps: 0;
  instruments: readonly PreForwardExecutionInstrumentConfig[];
}

interface PreForwardStrategyBase {
  portfolioId: string;
  strategyConfigVersion: string;
  validFrom: string;
  validThrough: string;
  maxAssets: number;
}

export interface PreForwardTrendConfig extends PreForwardStrategyBase {
  strategy: "trend";
  strategyVersion: typeof TREND_STRATEGY_VERSION;
  parameters: TrendStrategyParameters;
}

export interface PreForwardRotationConfig extends PreForwardStrategyBase {
  strategy: "rotation";
  strategyVersion: typeof ROTATION_STRATEGY_VERSION;
  parameters: RotationStrategyParameters;
}

export type PreForwardStrategyConfig = PreForwardTrendConfig | PreForwardRotationConfig;

export interface PreForwardConfig {
  schemaVersion: typeof PRE_FORWARD_CONFIG_SCHEMA_VERSION;
  mode: typeof PRE_FORWARD_MODE;
  artifactRoot: PreForwardPath;
  ledgerPath: PreForwardPath;
  input: PreForwardInput;
  universe: PreForwardUniverseConfig;
  signal: PreForwardSignalConfig;
  execution: PreForwardExecutionConfig;
  portfolio: {
    initialCashJpy: 1_000_000;
    drawdownLimit: -0.3;
  };
  strategies: readonly [PreForwardTrendConfig, PreForwardRotationConfig];
}

const SAFE_RUNTIME_PREFIXES = ["data/raw/", "data/cache/", "data/generated/", "reports/generated/"];
const ARTIFACT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.join(", ")}.`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "" || value.trim() !== value || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty, unpadded string.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return value;
}

function requiredInteger(value: unknown, field: string, min: number, max: number): number {
  const number = requiredNumber(value, field);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function assertArtifactId(value: unknown, field: string): string {
  const id = requiredString(value, field);
  if (!ARTIFACT_ID_PATTERN.test(id)) throw new Error(`${field} must be a canonical SHA-256 artifact id.`);
  return id;
}

function assertSafeRelativeFile(value: unknown, field: string): string {
  const path = requiredString(value, field);
  if (isAbsolute(path) || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`${field} must be repository-relative.`);
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized.split("/").some((segment) => segment === "..") || normalized === ".") {
    throw new Error(`${field} must not traverse outside the repository.`);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) throw new Error(`${field} must be a file path, not a URI.`);
  return path;
}

function validateRuntimePath(value: unknown, field: string, file: boolean): PreForwardPath {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["kind", "path"], field);
  const kind = value.kind;
  if (kind !== "relative" && kind !== "absolute") throw new Error(`${field}.kind must be relative or absolute.`);
  const path = requiredString(value.path, `${field}.path`);
  const looksAbsolute = isAbsolute(path) || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
  if ((kind === "absolute") !== looksAbsolute) throw new Error(`${field}.kind does not match ${field}.path.`);
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.split("/").some((segment) => segment === "..") || normalized === ".") {
    throw new Error(`${field}.path must identify a dedicated runtime location without traversal.`);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`${field}.path must be a filesystem path, not a URI.`);
  }
  if (kind === "relative" && !SAFE_RUNTIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`${field}.path must stay inside an ignored runtime-data directory.`);
  }
  if (file && !/\.(?:sqlite|sqlite3|db)$/.test(normalized)) {
    throw new Error(`${field}.path must use a SQLite file extension.`);
  }
  return { kind, path };
}

function validateInput(value: unknown): PreForwardInput {
  if (!isRecord(value)) throw new Error("input must be an object.");
  if (value.kind === "daily_bars_manifest") {
    assertOnlyKeys(value, ["kind", "evidenceTier", "dailyBarsArtifactIds"], "input");
    if (value.evidenceTier !== "synthetic_fixture") {
      throw new Error("daily_bars_manifest input must remain explicitly synthetic_fixture.");
    }
    if (!Array.isArray(value.dailyBarsArtifactIds) || value.dailyBarsArtifactIds.length === 0) {
      throw new Error("input.dailyBarsArtifactIds must be a non-empty array.");
    }
    const ids = value.dailyBarsArtifactIds.map((id, index) => (
      assertArtifactId(id, `input.dailyBarsArtifactIds[${index}]`)
    ));
    if (new Set(ids).size !== ids.length || [...ids].sort().some((id, index) => id !== ids[index])) {
      throw new Error("input.dailyBarsArtifactIds must be unique and sorted.");
    }
    return { kind: "daily_bars_manifest", evidenceTier: "synthetic_fixture", dailyBarsArtifactIds: ids };
  }
  if (value.kind === "credentialed_sample_audit") {
    assertOnlyKeys(value, ["kind", "auditArtifactId", "sampleConfigPath", "providerId"], "input");
    if (value.providerId !== "jquants_v2" && value.providerId !== "eodhd_eod") {
      throw new Error("input.providerId is unsupported.");
    }
    return {
      kind: "credentialed_sample_audit",
      auditArtifactId: assertArtifactId(value.auditArtifactId, "input.auditArtifactId"),
      sampleConfigPath: assertSafeRelativeFile(value.sampleConfigPath, "input.sampleConfigPath"),
      providerId: value.providerId,
    };
  }
  throw new Error("input.kind must be daily_bars_manifest or credentialed_sample_audit.");
}

function validateUniverse(value: unknown): PreForwardUniverseConfig {
  if (!isRecord(value)) throw new Error("universe must be an object.");
  assertOnlyKeys(value, ["masterPath", "allowedStatuses", "supportedCurrencies"], "universe");
  const masterPath = value.masterPath === undefined
    ? undefined
    : assertSafeRelativeFile(value.masterPath, "universe.masterPath");
  if (!Array.isArray(value.allowedStatuses) || value.allowedStatuses.length === 0) {
    throw new Error("universe.allowedStatuses must be explicitly non-empty.");
  }
  const allowedStatuses = value.allowedStatuses.map((status, index) => {
    const parsed = requiredString(status, `universe.allowedStatuses[${index}]`);
    if (!VERSION_PATTERN.test(parsed)) throw new Error("universe.allowedStatuses contains an unstable identifier.");
    return parsed;
  });
  if (new Set(allowedStatuses).size !== allowedStatuses.length
    || [...allowedStatuses].sort().some((status, index) => status !== allowedStatuses[index])) {
    throw new Error("universe.allowedStatuses must be unique and sorted.");
  }
  if (!Array.isArray(value.supportedCurrencies)
    || value.supportedCurrencies.length !== 1
    || value.supportedCurrencies[0] !== "JPY") {
    throw new Error("M2 pre-forward supports only an explicit [\"JPY\"] currency list.");
  }
  return { masterPath, allowedStatuses, supportedCurrencies: ["JPY"] };
}

function validateSignal(value: unknown): PreForwardSignalConfig {
  if (!isRecord(value)) throw new Error("signal must be an object.");
  assertOnlyKeys(value, ["minHistoryBars", "volatilityWindowDays", "maxDataAgeDays", "priceField"], "signal");
  if (value.priceField !== "adjustedClose") {
    throw new Error("signal.priceField must explicitly be adjustedClose for M2 research signals.");
  }
  return {
    minHistoryBars: requiredInteger(value.minHistoryBars, "signal.minHistoryBars", 253, 5_000),
    volatilityWindowDays: requiredInteger(value.volatilityWindowDays, "signal.volatilityWindowDays", 2, 252),
    maxDataAgeDays: requiredInteger(value.maxDataAgeDays, "signal.maxDataAgeDays", 0, 31),
    priceField: "adjustedClose",
  };
}

function validateBps(value: unknown, field: string): number {
  const bps = requiredNumber(value, field);
  if (bps < 0 || bps >= 10_000) throw new Error(`${field} must be from 0 (inclusive) to 10000 (exclusive).`);
  return bps;
}

function validateExecution(value: unknown): PreForwardExecutionConfig {
  if (!isRecord(value)) throw new Error("execution must be an object.");
  assertOnlyKeys(value, [
    "policyVersion", "benefitGate", "priceSource", "commissionBps", "slippageBps", "fallbackHalfSpreadBps",
    "fxConversionBps", "instruments",
  ], "execution");
  const policyVersion = requiredString(value.policyVersion, "execution.policyVersion");
  if (!VERSION_PATTERN.test(policyVersion)) throw new Error("execution.policyVersion must be a stable lowercase id.");
  if (!isRecord(value.benefitGate)) throw new Error("execution.benefitGate must be an object.");
  assertOnlyKeys(value.benefitGate, ["policyVersion", "safetyMarginBps"], "execution.benefitGate");
  const benefitGatePolicyVersion = requiredString(
    value.benefitGate.policyVersion,
    "execution.benefitGate.policyVersion",
  );
  if (!VERSION_PATTERN.test(benefitGatePolicyVersion)) {
    throw new Error("execution.benefitGate.policyVersion must be a stable lowercase id.");
  }
  if (value.priceSource !== "latest_unadjusted_close_proxy") {
    throw new Error("execution.priceSource must be latest_unadjusted_close_proxy.");
  }
  if (value.fxConversionBps !== 0) throw new Error("M2 JPY-only execution requires execution.fxConversionBps=0.");
  const commissionBps = validateBps(value.commissionBps, "execution.commissionBps");
  const slippageBps = validateBps(value.slippageBps, "execution.slippageBps");
  const fallbackHalfSpreadBps = validateBps(
    value.fallbackHalfSpreadBps,
    "execution.fallbackHalfSpreadBps",
  );
  if (!Array.isArray(value.instruments)) throw new Error("execution.instruments must be an array.");
  const instruments = value.instruments.map((item, index) => {
    const field = `execution.instruments[${index}]`;
    if (!isRecord(item)) throw new Error(`${field} must be an object.`);
    assertOnlyKeys(item, ["code", "tradingUnit", "spreadBps", "expectedBenefit"], field);
    const code = requiredString(item.code, `${field}.code`);
    if (!STABLE_ID_PATTERN.test(code)) throw new Error(`${field}.code contains invalid characters.`);
    let expectedBenefit: PreForwardExecutionInstrumentConfig["expectedBenefit"];
    if (item.expectedBenefit !== undefined) {
      if (!isRecord(item.expectedBenefit)) throw new Error(`${field}.expectedBenefit must be an object.`);
      assertOnlyKeys(
        item.expectedBenefit,
        ["basis", "evidenceId", "availableAt", "grossExpectedBenefitBps"],
        `${field}.expectedBenefit`,
      );
      if (item.expectedBenefit.basis !== "synthetic_fixture_assumption") {
        throw new Error(`${field}.expectedBenefit.basis is unsupported.`);
      }
      const evidenceId = requiredString(item.expectedBenefit.evidenceId, `${field}.expectedBenefit.evidenceId`);
      if (!VERSION_PATTERN.test(evidenceId)) {
        throw new Error(`${field}.expectedBenefit.evidenceId must be a stable lowercase id.`);
      }
      const availableAt = requiredString(item.expectedBenefit.availableAt, `${field}.expectedBenefit.availableAt`);
      if (!isIsoDateTime(availableAt)) {
        throw new Error(`${field}.expectedBenefit.availableAt must be an ISO timestamp with timezone.`);
      }
      expectedBenefit = {
        basis: "synthetic_fixture_assumption",
        evidenceId,
        availableAt,
        grossExpectedBenefitBps: requiredNumber(
          item.expectedBenefit.grossExpectedBenefitBps,
          `${field}.expectedBenefit.grossExpectedBenefitBps`,
        ),
      };
    }
    return {
      code,
      tradingUnit: requiredInteger(item.tradingUnit, `${field}.tradingUnit`, 1, 1_000_000),
      spreadBps: item.spreadBps === undefined ? undefined : validateBps(item.spreadBps, `${field}.spreadBps`),
      expectedBenefit,
    };
  }).sort((left, right) => left.code.localeCompare(right.code));
  if (new Set(instruments.map((item) => item.code)).size !== instruments.length) {
    throw new Error("execution.instruments code values must be unique.");
  }
  for (const instrument of instruments) {
    const costRate = oneWayCostRate(instrument.spreadBps, {
      commissionBps,
      slippageBps,
      fallbackHalfSpreadBps,
      fxConversionBps: 0,
    });
    if (costRate >= 1) {
      throw new Error(`execution aggregate one-way cost for ${instrument.code} must be below 100%.`);
    }
  }
  const safetyMarginBps = validateBps(
    value.benefitGate.safetyMarginBps,
    "execution.benefitGate.safetyMarginBps",
  );
  if (safetyMarginBps <= 0) {
    throw new Error("execution.benefitGate.safetyMarginBps must be positive.");
  }
  return {
    policyVersion,
    benefitGate: {
      policyVersion: benefitGatePolicyVersion,
      safetyMarginBps,
    },
    priceSource: "latest_unadjusted_close_proxy",
    commissionBps,
    slippageBps,
    fallbackHalfSpreadBps,
    fxConversionBps: 0,
    instruments,
  };
}

function validateStrategy(value: unknown, index: number): PreForwardStrategyConfig {
  const field = `strategies[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, [
    "strategy", "portfolioId", "strategyVersion", "strategyConfigVersion", "validFrom", "validThrough",
    "maxAssets", "parameters",
  ], field);
  const portfolioId = requiredString(value.portfolioId, `${field}.portfolioId`);
  const strategyConfigVersion = requiredString(value.strategyConfigVersion, `${field}.strategyConfigVersion`);
  if (!VERSION_PATTERN.test(portfolioId) || !VERSION_PATTERN.test(strategyConfigVersion)) {
    throw new Error(`${field} portfolio and config versions must be stable lowercase identifiers.`);
  }
  if (!isIsoDate(value.validFrom) || !isIsoDate(value.validThrough) || value.validFrom > value.validThrough) {
    throw new Error(`${field} must contain an ordered validFrom/validThrough ISO-date range.`);
  }
  const maxAssets = requiredInteger(value.maxAssets, `${field}.maxAssets`, 1, 3);
  if (!isRecord(value.parameters)) throw new Error(`${field}.parameters must be an object.`);
  if (value.strategy === "trend") {
    if (value.strategyVersion !== TREND_STRATEGY_VERSION) {
      throw new Error(`${field}.strategyVersion is stale or unsupported; expected ${TREND_STRATEGY_VERSION}.`);
    }
    assertOnlyKeys(value.parameters, ["r3mWeight", "r6mWeight", "r12mWeight", "requirePositiveR12m"], `${field}.parameters`);
    const parameters = validateTrendParameters({
      r3mWeight: requiredNumber(value.parameters.r3mWeight, `${field}.parameters.r3mWeight`),
      r6mWeight: requiredNumber(value.parameters.r6mWeight, `${field}.parameters.r6mWeight`),
      r12mWeight: requiredNumber(value.parameters.r12mWeight, `${field}.parameters.r12mWeight`),
      requirePositiveR12m: value.parameters.requirePositiveR12m as boolean,
    });
    return {
      strategy: "trend", portfolioId, strategyVersion: TREND_STRATEGY_VERSION, strategyConfigVersion,
      validFrom: value.validFrom, validThrough: value.validThrough, maxAssets, parameters,
    };
  }
  if (value.strategy === "rotation") {
    if (value.strategyVersion !== ROTATION_STRATEGY_VERSION) {
      throw new Error(`${field}.strategyVersion is stale or unsupported; expected ${ROTATION_STRATEGY_VERSION}.`);
    }
    assertOnlyKeys(value.parameters, ["r6mWeight", "r12mWeight", "volatilityPenalty", "requirePositiveR12m"], `${field}.parameters`);
    const parameters = validateRotationParameters({
      r6mWeight: requiredNumber(value.parameters.r6mWeight, `${field}.parameters.r6mWeight`),
      r12mWeight: requiredNumber(value.parameters.r12mWeight, `${field}.parameters.r12mWeight`),
      volatilityPenalty: requiredNumber(value.parameters.volatilityPenalty, `${field}.parameters.volatilityPenalty`),
      requirePositiveR12m: value.parameters.requirePositiveR12m as boolean,
    });
    return {
      strategy: "rotation", portfolioId, strategyVersion: ROTATION_STRATEGY_VERSION, strategyConfigVersion,
      validFrom: value.validFrom, validThrough: value.validThrough, maxAssets, parameters,
    };
  }
  throw new Error(`${field}.strategy must be trend or rotation.`);
}

export function validatePreForwardConfig(value: unknown): PreForwardConfig {
  if (!isRecord(value)) throw new Error("Pre-forward config must be a JSON object.");
  assertOnlyKeys(value, [
    "schemaVersion", "mode", "artifactRoot", "ledgerPath", "input", "universe", "signal",
    "execution", "portfolio", "strategies",
  ], "Pre-forward config");
  if (value.schemaVersion !== PRE_FORWARD_CONFIG_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${PRE_FORWARD_CONFIG_SCHEMA_VERSION}.`);
  }
  if (value.mode !== PRE_FORWARD_MODE) throw new Error(`mode must be ${PRE_FORWARD_MODE}.`);
  if (!isRecord(value.portfolio)) throw new Error("portfolio must be an object.");
  assertOnlyKeys(value.portfolio, ["initialCashJpy", "drawdownLimit"], "portfolio");
  if (value.portfolio.initialCashJpy !== 1_000_000) {
    throw new Error("M2 pre-forward requires the approved virtual initialCashJpy=1000000.");
  }
  if (value.portfolio.drawdownLimit !== -0.3) {
    throw new Error("M2 pre-forward requires the approved drawdownLimit=-0.3.");
  }
  if (!Array.isArray(value.strategies) || value.strategies.length !== 2) {
    throw new Error("strategies must contain exactly one trend and one rotation configuration.");
  }
  const strategies = value.strategies.map(validateStrategy);
  const sorted = [...strategies].sort((left, right) => left.strategy.localeCompare(right.strategy));
  if (sorted[0]?.strategy !== "rotation" || sorted[1]?.strategy !== "trend") {
    throw new Error("strategies must contain exactly one trend and one rotation configuration.");
  }
  if (new Set(strategies.map((strategy) => strategy.portfolioId)).size !== strategies.length) {
    throw new Error("strategies portfolioId values must be unique.");
  }
  const trend = strategies.find((strategy): strategy is PreForwardTrendConfig => strategy.strategy === "trend")!;
  const rotation = strategies.find((strategy): strategy is PreForwardRotationConfig => strategy.strategy === "rotation")!;
  const input = validateInput(value.input);
  const execution = validateExecution(value.execution);
  if (input.kind === "daily_bars_manifest"
    && execution.instruments.some((instrument) => instrument.expectedBenefit === undefined)) {
    throw new Error("Synthetic pre-forward fixtures require explicit expected-benefit evidence for every instrument.");
  }
  if (input.kind === "credentialed_sample_audit"
    && execution.instruments.some((instrument) => instrument.expectedBenefit !== undefined)) {
    throw new Error("Credentialed pre-forward input cannot use synthetic expected-benefit assumptions.");
  }
  return {
    schemaVersion: PRE_FORWARD_CONFIG_SCHEMA_VERSION,
    mode: PRE_FORWARD_MODE,
    artifactRoot: validateRuntimePath(value.artifactRoot, "artifactRoot", false),
    ledgerPath: validateRuntimePath(value.ledgerPath, "ledgerPath", true),
    input,
    universe: validateUniverse(value.universe),
    signal: validateSignal(value.signal),
    execution,
    portfolio: { initialCashJpy: 1_000_000, drawdownLimit: -0.3 },
    strategies: [trend, rotation],
  };
}

export function assertStrategyConfigCurrent(strategy: PreForwardStrategyConfig, asOfDate: string): void {
  if (!isIsoDate(asOfDate)) throw new Error(`Invalid pre-forward asOf date: ${asOfDate}.`);
  if (asOfDate < strategy.validFrom || asOfDate > strategy.validThrough) {
    throw new Error(
      `${strategy.strategy} strategy config ${strategy.strategyConfigVersion} is not valid on ${asOfDate}; `
      + `valid range is ${strategy.validFrom}..${strategy.validThrough}.`,
    );
  }
}
