import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest, validateBacktestConfig } from "../src/backtest/runner.ts";

const trendConfig = "tests/fixtures/configs/trend.json";
const rotationConfig = "tests/fixtures/configs/rotation.json";

test("Trend and Rotation fixture runs enforce integration guardrails", async () => {
  const [trend, rotation] = await Promise.all([
    runBacktest(trendConfig),
    runBacktest(rotationConfig),
  ]);

  for (const result of [trend, rotation]) {
    assert.equal(result.outputSchemaVersion, "backtest-summary-v2");
    assert.equal(result.returnBasis, "unadjusted_price");
    assert.equal(result.returnNormalization.status, "not_normalized");
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

test("CLI config validation rejects relaxed hard constraints", () => {
  const base = {
    strategy: "trend",
    start: "2024-01-01",
    end: "2025-01-01",
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
});
