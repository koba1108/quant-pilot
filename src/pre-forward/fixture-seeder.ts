import { resolve } from "node:path";
import { CsvMarketDataProvider } from "../data/csv.ts";
import { FileArtifactStore } from "../data/artifact-store.ts";
import { canonicalJson } from "../data/provenance.ts";
import { compareText } from "../determinism.ts";
import { loadPreForwardConfigContext } from "./runner.ts";
import { buildPreForwardDailyBarsFixture } from "./market-input.ts";
import { resolvePreForwardArtifactRoot } from "./runtime-paths.ts";

export const PRE_FORWARD_FIXTURE_START = "2023-01-02" as const;
export const PRE_FORWARD_FIXTURE_END = "2025-01-06" as const;
export const PRE_FORWARD_FIXTURE_AS_OF = "2025-01-07T00:00:00Z" as const;

export interface SeedPreForwardFixtureOptions {
  cwd?: string;
  csvRoot?: string;
  symbol?: string;
}

export async function seedPreForwardFixture(
  configPath: string,
  options: SeedPreForwardFixtureOptions = {},
): Promise<readonly string[]> {
  const context = await loadPreForwardConfigContext(configPath, options.cwd ?? process.cwd());
  const config = context.config;
  if (config.input.kind !== "daily_bars_manifest" || config.input.evidenceTier !== "synthetic_fixture") {
    throw new Error("Fixture seeding requires a synthetic daily_bars_manifest config.");
  }
  const artifactRoot = await resolvePreForwardArtifactRoot(config.artifactRoot, context.repositoryRoot);
  const store = new FileArtifactStore(artifactRoot);
  await store.prepare();
  const csvRoot = options.csvRoot === undefined
    ? resolve(import.meta.dirname, "../../tests/fixtures/market-data")
    : resolve(context.repositoryRoot, options.csvRoot);
  const provider = new CsvMarketDataProvider(csvRoot, true);
  const codes = config.execution.instruments.map((instrument) => instrument.code).sort(compareText);
  if (codes.length === 0) throw new Error("Fixture config must declare at least one execution instrument.");
  const artifacts = await Promise.all(codes.map(async (code) => {
    const bars = await provider.loadDailyBars({
      code,
      symbol: options.symbol ?? "synthetic",
      start: PRE_FORWARD_FIXTURE_START,
      end: PRE_FORWARD_FIXTURE_END,
    });
    return buildPreForwardDailyBarsFixture({
      code,
      bars,
      observedAt: "2025-01-06T15:00:00Z",
      availableAt: PRE_FORWARD_FIXTURE_AS_OF,
      retrievedAt: PRE_FORWARD_FIXTURE_AS_OF,
      returnEventCoverageEndDate: PRE_FORWARD_FIXTURE_AS_OF.slice(0, 10),
    });
  }));
  const ids = artifacts.map((artifact) => artifact.provenance.artifactId).sort(compareText);
  if (canonicalJson(ids) !== canonicalJson(config.input.dailyBarsArtifactIds)) {
    throw new Error(`Fixture config artifact manifest does not match deterministic seed ids: ${canonicalJson(ids)}.`);
  }
  for (const artifact of artifacts) await store.put(artifact);
  return ids;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const configPath = arg("config");
  if (configPath === undefined) throw new Error("pre-forward fixture seeding requires --config=<path>.");
  const ids = await seedPreForwardFixture(configPath, {
    csvRoot: arg("csv-root"),
    symbol: arg("symbol"),
  });
  console.log(JSON.stringify({
    schemaVersion: "pre-forward-fixture-seed-report-v1",
    evidenceTier: "synthetic_fixture",
    artifactIds: ids,
  }, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
