import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runRobustnessGrid,
  runRobustnessGridConfig,
  validateRobustnessGridConfig,
} from "../src/backtest/robustness-grid.ts";

const configPath = "tests/fixtures/configs/robustness-grid.json";

test("Strategy A/B robustness grid is deterministic, descriptive, and explicit about unsupported axes", async () => {
  const first = await runRobustnessGrid(configPath);
  const second = await runRobustnessGrid(configPath);
  assert.deepEqual(second, first);
  assert.equal(first.outputSchemaVersion, "robustness-grid-v1");
  assert.equal(first.selectionPolicy, "descriptive_only_no_automatic_winner");
  assert.equal(first.evidenceDisposition, "research_only");
  assert.equal(first.returnBasis, "unadjusted_price");
  assert.equal(first.returnNormalization.status, "not_normalized");
  assert.deepEqual(first.counts, { total: 32, completed: 16, unsupported: 16 });
  assert.equal("bestScenario" in first, false);
  assert.ok(first.inputArtifactIds.length > 0);
  assert.ok(first.inputDataContent.every((item) => /^sha256:[0-9a-f]{64}$/.test(item.contentHash)));
  assert.match(first.universeMasterFingerprint!, /^sha256:[0-9a-f]{64}$/);
  assert.ok(first.universeObservationIds.length > 0);
  assert.equal(first.universeObservationIds.includes("univ-future-v1"), false);

  const completed = first.scenarios.filter((scenario) => scenario.status === "completed");
  assert.ok(completed.every((scenario) => scenario.parameters.rebalanceTiming === "month_end_close"));
  assert.ok(completed.every((scenario) => scenario.result!.maxObservedHoldings <= 3));
  assert.ok(completed.every((scenario) => Number.isFinite(scenario.metrics!.totalTurnover)));
  assert.ok(completed.every((scenario) => scenario.metrics!.worstMonth !== undefined));
  assert.ok(completed.every((scenario) => scenario.metrics!.worstYear !== undefined));

  const unsupported = first.scenarios.filter((scenario) => scenario.status === "unsupported");
  assert.ok(unsupported.every((scenario) => scenario.unsupportedAxes?.some(
    (axis) => axis.code === "FRAME_BUILDER_MONTH_END_ONLY",
  )));
  assert.deepEqual(first.stability.map((group) => [group.strategy, group.completedCount]), [
    ["trend", 8],
    ["rotation", 8],
  ]);
  const costGroups = first.axisStability.filter((group) => group.axis === "costRate");
  assert.deepEqual(costGroups.map((group) => [group.value, group.completedCount]), [[0, 8], [0.001, 8]]);
  assert.ok(costGroups[0]!.metrics.totalCostRate!.median < costGroups[1]!.metrics.totalCostRate!.median);
});

test("an all-unsupported grid reports capabilities without loading missing market data", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "quant-pilot-grid-"));
  try {
    const base = JSON.parse(await readFile("tests/fixtures/configs/trend-universe.json", "utf8"));
    base.csvRoot = join(temporary, "missing-market-data");
    const basePath = join(temporary, "base.json");
    await writeFile(basePath, JSON.stringify(base));
    const grid = validateRobustnessGridConfig({
      schemaVersion: "robustness-grid-config-v1",
      baseConfig: basePath,
      axes: {
        strategies: ["trend"],
        trendParameters: [{ r3mWeight: .2, r6mWeight: .3, r12mWeight: .5, requirePositiveR12m: true }],
        rotationParameters: [{ r6mWeight: .4, r12mWeight: .4, volatilityPenalty: .2, requirePositiveR12m: true }],
        costRates: [.001],
        maxAssets: [3],
        volatilityWindowDays: [63],
        rebalanceTimings: ["calendar_day_25"],
        replacementRules: ["rank_hysteresis"],
      },
    });
    const report = await runRobustnessGridConfig(grid);
    assert.deepEqual(report.counts, { total: 1, completed: 0, unsupported: 1 });
    assert.deepEqual(report.inputDataContent, []);
    assert.deepEqual(report.scenarios[0]!.unsupportedAxes!.map((axis) => axis.axis), [
      "rebalanceTiming",
      "replacementRule",
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("axis input ordering cannot change grid scenarios or fingerprint", async () => {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  const reordered = structuredClone(raw);
  for (const key of Object.keys(reordered.axes)) {
    if (Array.isArray(reordered.axes[key])) reordered.axes[key].reverse();
  }
  const originalReport = await runRobustnessGridConfig(validateRobustnessGridConfig(raw));
  const reorderedReport = await runRobustnessGridConfig(validateRobustnessGridConfig(reordered));
  assert.deepEqual(reorderedReport, originalReport);
});

test("grid validation rejects silent fields, invalid hard constraints, duplicate axes, and malformed weights", () => {
  const base = {
    schemaVersion: "robustness-grid-config-v1",
    baseConfig: "tests/fixtures/configs/trend-universe.json",
    axes: {
      strategies: ["trend"],
      trendParameters: [{ r3mWeight: 0.2, r6mWeight: 0.3, r12mWeight: 0.5, requirePositiveR12m: true }],
      rotationParameters: [{ r6mWeight: 0.4, r12mWeight: 0.4, volatilityPenalty: 0.2, requirePositiveR12m: true }],
      costRates: [0.001],
      maxAssets: [3],
      volatilityWindowDays: [63],
      rebalanceTimings: ["month_end_close"],
      replacementRules: ["immediate_top_n"],
    },
  };
  assert.throws(() => validateRobustnessGridConfig({ ...base, surprise: true }), /unknown fields/);
  assert.throws(
    () => validateRobustnessGridConfig({ ...base, axes: { ...base.axes, maxAssets: [4] } }),
    /Invalid axes.maxAssets/,
  );
  assert.throws(
    () => validateRobustnessGridConfig({ ...base, axes: { ...base.axes, costRates: [0.001, 0.001] } }),
    /must not contain duplicates/,
  );
  assert.throws(
    () => validateRobustnessGridConfig({
      ...base,
      axes: {
        ...base.axes,
        trendParameters: [{ r3mWeight: 0.2, r6mWeight: 0.3, r12mWeight: 0.4, requirePositiveR12m: true }],
      },
    }),
    /must sum to one/,
  );
});
