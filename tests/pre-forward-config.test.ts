import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertStrategyConfigCurrent,
  validatePreForwardConfig,
} from "../src/pre-forward/config.ts";

const fixturePath = resolve(import.meta.dirname, "fixtures/pre-forward/config.json");

async function fixture(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, any>;
}

test("pre-forward config strictly binds both strategies and approved hard limits", async () => {
  const config = validatePreForwardConfig(await fixture());
  assert.equal(config.mode, "pre_forward_dry_run");
  assert.deepEqual(config.strategies.map((strategy) => strategy.strategy), ["trend", "rotation"]);
  assert.equal(config.portfolio.initialCashJpy, 1_000_000);
  assert.equal(config.portfolio.drawdownLimit, -0.3);
  assert.ok(config.strategies.every((strategy) => strategy.maxAssets <= 3));
});

test("pre-forward config rejects stale versions, weaker guardrails, unknown fields, and ambiguous artifacts", async () => {
  for (const [mutate, pattern] of [
    [(value: Record<string, any>) => { value.strategies[0].strategyVersion = "trend-v0"; }, /stale or unsupported/],
    [(value: Record<string, any>) => { value.strategies[0].maxAssets = 4; }, /integer from 1 to 3/],
    [(value: Record<string, any>) => { value.portfolio.drawdownLimit = -0.4; }, /drawdownLimit=-0.3/],
    [(value: Record<string, any>) => { value.unapproved = true; }, /unknown fields/],
    [(value: Record<string, any>) => {
      value.input.dailyBarsArtifactIds[1] = value.input.dailyBarsArtifactIds[0];
    }, /unique and sorted/],
    [(value: Record<string, any>) => { value.execution.fxConversionBps = 1; }, /JPY-only execution/],
    [(value: Record<string, any>) => { value.execution.benefitGate.safetyMarginBps = -1; }, /0 \(inclusive\)/],
    [(value: Record<string, any>) => { value.execution.benefitGate.safetyMarginBps = 0; }, /must be positive/],
    [(value: Record<string, any>) => {
      value.execution.commissionBps = 9_000;
      value.execution.slippageBps = 9_000;
    }, /aggregate one-way cost.*below 100%/],
    [(value: Record<string, any>) => { delete value.execution.instruments[0].expectedBenefit; }, /explicit expected-benefit evidence/],
    [(value: Record<string, any>) => {
      value.execution.instruments[0].expectedBenefit.availableAt = "2025-01-01";
    }, /ISO timestamp with timezone/],
  ] as const) {
    const value = await fixture();
    mutate(value);
    assert.throws(() => validatePreForwardConfig(value), pattern);
  }
});

test("pre-forward strategy validity window fails closed", async () => {
  const config = validatePreForwardConfig(await fixture());
  assert.doesNotThrow(() => assertStrategyConfigCurrent(config.strategies[0], "2025-01-07"));
  assert.throws(
    () => assertStrategyConfigCurrent(config.strategies[0], "2026-01-01"),
    /is not valid.*valid range/,
  );
});
