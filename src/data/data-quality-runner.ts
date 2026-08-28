import {
  buildDailyBarDataQualityReport,
  type DataQualityDisposition,
  type DataQualityPolicy,
  type DataQualityReport,
} from "./data-quality.ts";
import { sha256Canonical } from "./provenance.ts";
import { loadBacktestConfig, loadBacktestInputs } from "../backtest/runner.ts";
import { compareText } from "../determinism.ts";

export const DATA_QUALITY_RUN_SCHEMA_VERSION = "data-quality-run-v1" as const;
export const BACKTEST_RESEARCH_QUALITY_POLICY: DataQualityPolicy = {
  version: "backtest-daily-bars-research-v1",
  requiredHistoryBars: 253,
  requireProvenance: true,
  requireVolume: false,
  requireTradingValue: false,
  requireQuoteQuality: false,
  reconciliationMode: "advisory",
};

export interface DataQualityRunReport {
  outputSchemaVersion: typeof DATA_QUALITY_RUN_SCHEMA_VERSION;
  policyVersion: string;
  provider: string;
  returnBasis: "unadjusted_price" | "provider_adjusted";
  researchLayer: "synthetic_fixture" | "proxy" | "etf_realistic" | "unspecified";
  auditScope: "dataset_at_backtest_end_not_per_signal_frame";
  disposition: DataQualityDisposition;
  crossSourceReconciliation: "not_performed";
  reports: readonly DataQualityReport[];
  unloadedAssets: readonly { code: string; reason: string }[];
  fingerprint: string;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function overallDisposition(reports: readonly DataQualityReport[], unloadedCount: number): DataQualityDisposition {
  if (unloadedCount > 0 || reports.some((report) => report.disposition === "blocked")) return "blocked";
  if (reports.some((report) => report.disposition === "research_only")) return "research_only";
  return "pass";
}

export async function runDataQualityForBacktest(
  configPath: string,
  policy: DataQualityPolicy = BACKTEST_RESEARCH_QUALITY_POLICY,
): Promise<DataQualityRunReport> {
  const config = await loadBacktestConfig(configPath);
  const loaded = await loadBacktestInputs(config);
  const returnBasis = config.returnBasis ?? "provider_adjusted";
  const reports = loaded.assets.map((asset) => buildDailyBarDataQualityReport({
    code: asset.code,
    bars: asset.bars,
    decisionDate: config.end,
    requestedStart: asset.requestedStart,
    requestedEnd: asset.requestedEnd,
    returnBasis,
    provenance: asset.provenance,
  }, policy)).sort((left, right) => compareText(left.code, right.code));
  const loadedCodes = new Set(loaded.assets.map((asset) => asset.code));
  const unloadedAssets = config.assets
    .filter((asset) => !loadedCodes.has(asset.code))
    .map((asset) => ({
      code: asset.code,
      reason: loaded.baseDiagnostics.get(asset.code)?.reason ?? "No data artifact was loaded.",
    }))
    .sort((left, right) => compareText(left.code, right.code));
  const reportWithoutFingerprint = {
    outputSchemaVersion: DATA_QUALITY_RUN_SCHEMA_VERSION,
    policyVersion: policy.version,
    provider: loaded.providerName,
    returnBasis,
    researchLayer: config.researchLayer ?? "unspecified" as const,
    auditScope: "dataset_at_backtest_end_not_per_signal_frame" as const,
    disposition: overallDisposition(reports, unloadedAssets.length),
    crossSourceReconciliation: "not_performed" as const,
    reports,
    unloadedAssets,
  };
  return { ...reportWithoutFingerprint, fingerprint: sha256Canonical(reportWithoutFingerprint) };
}

async function main(): Promise<void> {
  const configPath = arg("config") ?? "backtest.config.json";
  const report = await runDataQualityForBacktest(configPath);
  console.log(JSON.stringify(report, null, 2));
  if (report.disposition === "blocked") process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
