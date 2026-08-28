import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBarsWithinRequest,
  executeLoadedBacktest,
  loadBacktestConfig,
  loadBacktestInputs,
  runBacktest,
  runBacktestConfig,
  validateBacktestConfig,
} from "../src/backtest/runner.ts";

const trendConfig = "tests/fixtures/configs/trend.json";
const rotationConfig = "tests/fixtures/configs/rotation.json";
const trendUniverseConfig = "tests/fixtures/configs/trend-universe.json";
const rotationUniverseConfig = "tests/fixtures/configs/rotation-universe.json";

test("Trend and Rotation fixture runs enforce integration guardrails", async () => {
  const [trend, rotation] = await Promise.all([
    runBacktest(trendConfig),
    runBacktest(rotationConfig),
  ]);

  for (const result of [trend, rotation]) {
    assert.equal(result.outputSchemaVersion, "backtest-summary-v2");
    assert.equal(result.returnBasis, "unadjusted_price");
    assert.equal(result.returnNormalization.status, "not_normalized");
    assert.equal(result.evidenceDisposition, "research_only");
    assert.match(result.returnNormalization.warning, /not normalized/);
    assert.equal(typeof result.cumulativePortfolioReturn, "number");
    assert.equal("totalReturn" in result, false);
    assert.ok(result.months > 0);
    assert.equal(result.stopped, true);
    assert.equal(result.stopLabel, "2025-01");
    assert.ok(result.maxDrawdown <= -.3);
    assert.equal(result.maxObservedHoldings, 3);
    assert.deepEqual(result.latestWeights, { CASH: 1 });
    assert.ok(Math.abs(result.totalCostRate - .002) < 1e-12);

    const ended = result.assetDiagnostics.find((asset) => asset.code === "ENDED")!;
    assert.equal(ended.requestedEnd, "2025-01-15");
    assert.equal(ended.loadedEnd, "2025-01-15");

    const late = result.assetDiagnostics.find((asset) => asset.code === "LATE")!;
    assert.equal(late.status, "excluded");
    assert.match(late.reason!, /Insufficient history/);

    const future = result.assetDiagnostics.find((asset) => asset.code === "FUTURE")!;
    assert.equal(future.status, "excluded");
    assert.equal(future.loadedBars, 0);
    assert.match(future.reason!, /do not overlap/);
  }
});

test("fixture-backed backtest is exactly reproducible", async () => {
  const first = await runBacktest(trendConfig);
  const second = await runBacktest(trendConfig);
  assert.deepEqual(second, first);
});

test("versioned Point-in-Time universe master drives both Strategy A and B deterministically", async () => {
  const [trend, rotation, repeated] = await Promise.all([
    runBacktest(trendUniverseConfig),
    runBacktest(rotationUniverseConfig),
    runBacktest(trendUniverseConfig),
  ]);
  assert.deepEqual(repeated, trend);
  for (const result of [trend, rotation]) {
    assert.equal(result.months, 18);
    assert.equal(result.finalEquity, 833426);
    assert.equal(result.maxObservedHoldings, 3);
    assert.equal(result.stopLabel, "2025-01");
    assert.match(result.universeMaster!.fingerprint, /^sha256:[0-9a-f]{64}$/);
    const alpha = result.assetDiagnostics.find((asset) => asset.code === "ALPHA")!;
    assert.deepEqual(alpha.universeObservationIds, ["univ-alpha-v1"]);
    assert.match(alpha.dataArtifactId!, /^sha256:/);
    assert.ok(alpha.universeDecisions!.some((decision) => decision.phase === "forward_endpoint"));
    assert.ok(alpha.universeDecisions!.every((decision) => decision.sourceVersion === "v1"
      && decision.retrievedAt === "2026-08-27T00:00:00Z"
      && decision.instrumentType === "etf"
      && decision.currency === "JPY"));
    const ended = result.assetDiagnostics.find((asset) => asset.code === "ENDED")!;
    assert.equal(ended.requestedEnd, "2025-01-15");
    assert.equal(ended.loadedEnd, "2025-01-15");
    assert.equal(ended.universeDecisions!.some((decision) => decision.date > "2025-01-15"), false);
    const late = result.assetDiagnostics.find((asset) => asset.code === "LATE")!;
    assert.equal(late.status, "excluded");
    assert.match(late.reason!, /Insufficient history/);
    const future = result.assetDiagnostics.find((asset) => asset.code === "FUTURE")!;
    assert.deepEqual(future.universeObservationIds, []);
    assert.deepEqual(future.universeDecisions, undefined);
  }
});

test("legacy candidate catalog cannot masquerade as a Point-in-Time master", async () => {
  await assert.rejects(
    () => runBacktestConfig({
      strategy: "trend",
      start: "2024-01-01",
      end: "2025-01-01",
      returnBasis: "unadjusted_price",
      provider: "csv",
      csvRoot: "tests/fixtures/market-data",
      universeMasterPath: "universe_master.csv",
      universeStatuses: ["candidate"],
      assets: [{ code: "1308" }],
    }),
    /exact universe-master-v1 header/,
  );
});

test("CLI config validation rejects relaxed hard constraints", () => {
  const base = {
    strategy: "trend",
    start: "2024-01-01",
    end: "2025-01-01",
    researchLayer: "synthetic_fixture",
    assets: [{ code: "A", symbol: "a" }],
  };

  assert.throws(() => validateBacktestConfig({ ...base, maxAssets: 4 }), /Invalid maxAssets/);
  assert.throws(() => validateBacktestConfig({ ...base, ddLimit: -.31 }), /Invalid ddLimit/);
  assert.throws(
    () => validateBacktestConfig({ ...base, returnBasis: "total_return" }),
    /returnBasis must be/,
  );
  assert.throws(
    () => validateBacktestConfig({ ...base, provider: "stooq", returnBasis: "provider_adjusted" }),
    /Stooq currently supports only unadjusted_price/,
  );
  assert.throws(() => validateBacktestConfig({ ...base, unexpected: true }), /unknown fields/);
  assert.throws(
    () => validateBacktestConfig({ ...base, universeMasterPath: "master.csv" }),
    /universeStatuses must be an explicitly non-empty array/,
  );
  assert.throws(
    () => validateBacktestConfig({
      ...base,
      universeMasterPath: "master.csv",
      universeStatuses: ["candidate"],
      assets: [{ code: "A", symbol: "must-not-override" }],
    }),
    /must get symbol and lifecycle dates only from universeMasterPath/,
  );
  assert.throws(
    () => validateBacktestConfig({ ...base, researchLayer: "etf_realistic" }),
    /not executable until normalized returns/,
  );
  const { researchLayer: _researchLayer, ...unlabeledLegacy } = base;
  assert.throws(
    () => validateBacktestConfig(unlabeledLegacy),
    /config-only asset path is limited to explicitly labeled/,
  );
});

test("object API revalidates config and provider bars cannot escape the requested range", async () => {
  await assert.rejects(
    () => runBacktestConfig({
      strategy: "trend",
      start: "2024-01-01",
      end: "2025-01-01",
      returnBasis: "bogus" as never,
      researchLayer: "synthetic_fixture",
      assets: [{ code: "A", symbol: "a" }],
    }),
    /returnBasis must be/,
  );
  assert.throws(() => assertBarsWithinRequest([
    { code: "A", tradingDate: "2023-12-31", close: 1, adjustedClose: 1 },
  ], { code: "A", start: "2024-01-01", end: "2024-12-31" }), /outside requested range/);
});

test("execution rejects Universe, bar, policy, or audit mutations after input validation", async () => {
  const config = await loadBacktestConfig(trendUniverseConfig);
  const universeLoaded = await loadBacktestInputs(config);
  (universeLoaded.universeMaster!.records[0] as { currency: string }).currency = "USD";
  assert.throws(() => executeLoadedBacktest(universeLoaded), /Universe master fingerprint/);

  const barsLoaded = await loadBacktestInputs(config);
  barsLoaded.assets[0]!.bars[0]!.close += 1;
  assert.throws(() => executeLoadedBacktest(barsLoaded), /market-data content changed/);

  const statusLoaded = await loadBacktestInputs(config);
  (statusLoaded.universeStatuses as Set<string>).clear();
  assert.throws(() => executeLoadedBacktest(statusLoaded), /inputs changed after validation/);

  const diagnosticLoaded = await loadBacktestInputs(config);
  diagnosticLoaded.baseDiagnostics.get("ALPHA")!.dataArtifactId = "sha256:" + "0".repeat(64);
  assert.throws(() => executeLoadedBacktest(diagnosticLoaded), /inputs changed after validation/);

  const configLoaded = await loadBacktestInputs(config);
  assert.throws(
    () => executeLoadedBacktest(configLoaded, { ...config, start: "2024-01-01", end: "2024-12-31" }),
    /changes data-loading fields/,
  );
});
