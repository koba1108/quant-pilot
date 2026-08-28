import test from "node:test";
import assert from "node:assert/strict";
import { runDataQualityForBacktest } from "../src/data/data-quality-runner.ts";

const config = "tests/fixtures/configs/data-quality.json";

test("data-quality CLI model is deterministic and never calls one source reconciled", async () => {
  const first = await runDataQualityForBacktest(config);
  const second = await runDataQualityForBacktest(config);
  assert.deepEqual(second, first);
  assert.equal(first.outputSchemaVersion, "data-quality-run-v1");
  assert.equal(first.auditScope, "dataset_at_backtest_end_not_per_signal_frame");
  assert.equal(first.disposition, "research_only");
  assert.equal(first.crossSourceReconciliation, "not_performed");
  assert.equal(first.reports.length, 1);
  assert.equal(first.reports[0]!.inputs.length, 1);
  assert.ok(first.reports[0]!.checks.some((check) => check.checkId === "return_basis.unadjusted_price"));
  assert.ok(first.reports[0]!.checks.some((check) => check.checkId === "reconciliation.not_performed"));
});
