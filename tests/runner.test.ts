import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const trendNormalizedConfig = "tests/fixtures/configs/trend-normalized.json";
const rotationNormalizedConfig = "tests/fixtures/configs/rotation-normalized.json";

test("Trend and Rotation fixture runs enforce integration guardrails", async () => {
  const [trend, rotation] = await Promise.all([
    runBacktest(trendConfig),
    runBacktest(rotationConfig),
  ]);

  for (const result of [trend, rotation]) {
    assert.equal(result.outputSchemaVersion, "backtest-summary-v3");
    assert.equal(result.start, "2024-01");
    assert.equal(result.end, "2025-06");
    assert.equal(result.signalStart, "2023-12");
    assert.equal(result.signalEnd, "2025-05");
    assert.equal(result.returnBasis, "unadjusted_price");
    assert.equal(result.returnNormalization.status, "not_normalized");
    assert.equal(result.evidenceDisposition, "research_only");
    assert.match(result.returnNormalization.warning, /not normalized/);
    assert.equal(typeof result.cumulativePortfolioReturn, "number");
    assert.equal("totalReturn" in result, false);
    assert.ok(result.months > 0);
    assert.equal(result.stopped, true);
    assert.equal(result.stopLabel, "2025-02");
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

test("Trend and Rotation execute deterministically on separate Point-in-Time normalized snapshots", async () => {
  const [trend, rotation, repeated] = await Promise.all([
    runBacktest(trendNormalizedConfig),
    runBacktest(rotationNormalizedConfig),
    runBacktest(trendNormalizedConfig),
  ]);
  assert.deepEqual(repeated, trend);
  for (const result of [trend, rotation]) {
    assert.equal(result.outputSchemaVersion, "backtest-summary-v3");
    assert.equal(result.returnBasis, "price_return");
    assert.equal(result.returnNormalization.status, "normalized_point_in_time");
    if (result.returnNormalization.status !== "normalized_point_in_time") assert.fail("normalized summary expected");
    assert.equal(result.returnNormalization.snapshotPolicy, "separate_signal_and_forward_endpoint");
    assert.equal(result.returnNormalization.barAvailabilityPolicy, "synthetic_same_day_close_v1");
    assert.deepEqual(result.returnNormalization.policyIds, []);
    assert.deepEqual(result.returnNormalization.fxContractIds, []);
    assert.match(result.returnNormalization.inputFingerprints[0]!.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.months, 18);
    assert.equal(result.finalEquity, 833426);
    assert.equal(result.maxObservedHoldings, 1);
    assert.equal(result.stopped, true);
    assert.equal(result.stopLabel, "2025-02");
    const diagnostic = result.assetDiagnostics[0]!;
    assert.equal(diagnostic.eligibleFrameCount, 18);
    assert.equal(diagnostic.returnNormalizationDecisions?.length, 36);
    assert.ok(diagnostic.returnNormalizationDecisions?.some((decision) => decision.phase === "signal"));
    assert.ok(diagnostic.returnNormalizationDecisions?.some((decision) => decision.phase === "forward_endpoint"));
    assert.ok(diagnostic.returnNormalizationDecisions?.every(
      (decision) => /^sha256:[0-9a-f]{64}$/.test(decision.snapshotFingerprint),
    ));
  }
});

test("normalized runner carries explicit Total Return policy and distribution events", async () => {
  const config = JSON.parse(await readFile(trendNormalizedConfig, "utf8"));
  config.returnBasis = "total_return";
  const normalization = config.assets[0].pointInTimeReturn;
  normalization.totalReturnPolicyId = "research-total-return-d018-v1";
  normalization.totalReturnPolicy = { distributionRecognition: "ex_date", reinvestment: "same_day_close" };
  normalization.events = [{
    type: "cash_distribution",
    eventId: "alpha-distribution-2024-02-01",
    code: "ALPHA",
    exDate: "2024-02-01",
    amountPerUnit: 5,
    currency: "JPY",
    availableAt: "2024-01-31T00:00:00Z",
    provenance: {
      source: "synthetic-fixture",
      dataset: "synthetic-return-events",
      retrievedAt: "2026-08-27T00:00:00Z",
      sourceVersion: "v1",
      recordId: "alpha-distribution-2024-02-01",
    },
  }];

  const totalReturn = await runBacktestConfig(config);
  assert.equal(totalReturn.returnNormalization.status, "normalized_point_in_time");
  if (totalReturn.returnNormalization.status !== "normalized_point_in_time") assert.fail("normalized summary expected");
  assert.deepEqual(totalReturn.returnNormalization.policyIds, ["research-total-return-d018-v1"]);
  assert.ok(totalReturn.assetDiagnostics[0]!.returnNormalizationDecisions?.some(
    (decision) => decision.appliedReturnEventIds.includes("alpha-distribution-2024-02-01"),
  ));
});

test("normalized runner converts a non-JPY source with exact-date Point-in-Time FX", async () => {
  const config = JSON.parse(await readFile(trendNormalizedConfig, "utf8"));
  const normalization = config.assets[0].pointInTimeReturn;
  normalization.currency = "USD";
  const lines = (await readFile("tests/fixtures/market-data/synthetic.csv", "utf8")).trim().split(/\r?\n/).slice(1);
  const dates = lines.map((line) => line.split(",")[0]!);
  const fxProvenance = {
    source: "synthetic-fixture",
    dataset: "synthetic-usd-jpy",
    retrievedAt: "2026-08-27T00:00:00Z",
    sourceVersion: "v1",
  };
  normalization.fxCoverage = {
    sourceCurrency: "USD",
    targetCurrency: "JPY",
    startDate: dates[0],
    endDate: dates.at(-1),
    status: "complete",
    availableAt: "2023-01-01T00:00:00Z",
    provenance: { ...fxProvenance, recordId: "usd-jpy-coverage-v1" },
  };
  normalization.fxObservations = dates.map((date, index) => ({
    observationId: `usd-jpy-${date}`,
    rateDate: date,
    sourceCurrency: "USD",
    targetCurrency: "JPY",
    quoteConvention: "target_currency_per_source_currency",
    targetCurrencyPerSourceUnit: 140 + index / 1000,
    observedAt: `${date}T20:00:00Z`,
    availableAt: `${date}T20:01:00Z`,
    provenance: { ...fxProvenance, recordId: `usd-jpy-${date}` },
  }));

  const result = await runBacktestConfig(config);
  assert.equal(result.returnNormalization.status, "normalized_point_in_time");
  if (result.returnNormalization.status !== "normalized_point_in_time") assert.fail("normalized summary expected");
  assert.deepEqual(result.returnNormalization.fxContractIds, ["point-in-time-jpy-fx-d006-v1"]);
  assert.ok(result.assetDiagnostics[0]!.returnNormalizationDecisions?.every(
    (decision) => decision.fxObservationCount === decision.barObservationCount,
  ));
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
    assert.equal(result.stopLabel, "2025-02");
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
      end: "2024-12-31",
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
    /requires pointInTimeReturn/,
  );
  assert.throws(
    () => validateBacktestConfig({ ...base, provider: "stooq", returnBasis: "provider_adjusted" }),
    /Stooq currently supports only unadjusted_price/,
  );
  assert.throws(
    () => validateBacktestConfig({ ...base, provider: "jquants_v2", returnBasis: "provider_adjusted" }),
    /J-Quants v2 research access currently supports only unadjusted_price/,
  );
  assert.throws(
    () => validateBacktestConfig({ ...base, provider: "jquants_v2", returnBasis: "unadjusted_price" }),
    /must be explicitly labeled researchLayer=proxy/,
  );
  assert.throws(
    () => validateBacktestConfig({ ...base, provider: "stooq", returnBasis: "unadjusted_price" }),
    /provider=stooq must be explicitly labeled researchLayer=proxy/,
  );
  assert.doesNotThrow(() => validateBacktestConfig({
    ...base,
    end: "2025-01-31",
    provider: "stooq",
    returnBasis: "unadjusted_price",
    researchLayer: "proxy",
  }));
  assert.equal(validateBacktestConfig({
    ...base,
    end: "2025-01-31",
    provider: "jquants_v2",
    returnBasis: "unadjusted_price",
    researchLayer: "proxy",
  }).provider, "jquants_v2");
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
    /not executable until production row-level provenance/,
  );
  const { researchLayer: _researchLayer, ...unlabeledLegacy } = base;
  assert.throws(
    () => validateBacktestConfig(unlabeledLegacy),
    /config-only asset path is limited to explicitly labeled/,
  );
});

test("provider overrides cannot replace an explicitly configured provider or escape proxy boundaries", async () => {
  const explicitProvider = {
    strategy: "trend" as const,
    start: "2024-01-01",
    end: "2025-01-31",
    provider: "csv" as const,
    returnBasis: "unadjusted_price" as const,
    researchLayer: "proxy" as const,
    csvRoot: "tests/fixtures/market-data",
    assets: [{ code: "A", symbol: "a" }],
  };
  await assert.rejects(
    () => loadBacktestInputs(explicitProvider, "stooq"),
    /provider override stooq does not match explicitly configured provider csv/,
  );

  const syntheticWithoutProvider = {
    ...explicitProvider,
    provider: undefined,
    researchLayer: "synthetic_fixture" as const,
  };
  await assert.rejects(
    () => loadBacktestInputs(syntheticWithoutProvider, "stooq"),
    /provider=stooq must be explicitly labeled researchLayer=proxy/,
  );
  await assert.rejects(
    () => loadBacktestInputs(syntheticWithoutProvider, "jquants_v2"),
    /provider=jquants_v2 must be explicitly labeled researchLayer=proxy/,
  );
});

test("monthly config validation rejects a partial final month for raw and normalized paths", async () => {
  const [raw, normalized] = await Promise.all([
    loadBacktestConfig(trendConfig),
    loadBacktestConfig(trendNormalizedConfig),
  ]);
  for (const config of [raw, normalized]) {
    assert.throws(
      () => validateBacktestConfig({ ...config, end: "2025-06-15" }),
      /calendar month-end/,
    );
  }
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

  const normalizedConfig = await loadBacktestConfig(trendNormalizedConfig);
  const normalizedLoaded = await loadBacktestInputs(normalizedConfig);
  normalizedLoaded.pointInTimeReturnAssets!.get("ALPHA")!.barObservations[0]!.close += 1;
  assert.throws(() => executeLoadedBacktest(normalizedLoaded), /inputs changed after validation/);
});
