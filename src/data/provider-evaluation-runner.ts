import { readFile } from "node:fs/promises";
import {
  assertProviderEvaluationReportIntegrity,
  evaluateProviderConfig,
  validateProviderEvaluationConfig,
  type ProviderEvaluationConfig,
  type ProviderEvaluationReport,
} from "./provider-evaluation.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export async function loadProviderEvaluationConfig(configPath: string): Promise<ProviderEvaluationConfig> {
  return validateProviderEvaluationConfig(JSON.parse(await readFile(configPath, "utf8")));
}

export async function runProviderEvaluation(configPath: string): Promise<ProviderEvaluationReport> {
  const config = await loadProviderEvaluationConfig(configPath);
  const report = evaluateProviderConfig(config);
  assertProviderEvaluationReportIntegrity(report, config);
  return report;
}

export function providerEvaluationExitCode(
  report: ProviderEvaluationReport,
  requireProduction: boolean,
): 0 | 1 {
  if (!requireProduction) return 0;
  return report.disposition === "pass" && !report.failClosed && report.canEnableEtfRealistic ? 0 : 1;
}

async function main(): Promise<void> {
  const configPath = arg("config") ?? "research/provider-evaluation/o001-candidates.json";
  const report = await runProviderEvaluation(configPath);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = providerEvaluationExitCode(report, hasFlag("require-production"));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
