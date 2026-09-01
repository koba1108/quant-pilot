import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  annualizedReturn,
  cumulativeReturn,
  sharpe,
  worstMonth,
  worstYear,
} from "../src/backtest/metrics.ts";

test("return metrics reject non-finite values and losses below negative one", () => {
  assert.throws(() => cumulativeReturn([0.1, Number.NaN]), /Invalid monthly return/);
  assert.throws(() => annualizedReturn([0.1, -1.01]), /Invalid monthly return/);
  assert.throws(() => sharpe([0.1], Number.POSITIVE_INFINITY), /Invalid monthly cash return/);
});

test("labeled metrics reject malformed, duplicate, unordered, and gapped annual labels", () => {
  assert.throws(() => worstMonth(["2025-13"], [0]), /Invalid monthly return label/);
  assert.throws(() => worstMonth(["2025-01", "2025-01"], [0, 0]), /unique and ordered/);
  assert.throws(() => worstMonth(["2025-02", "2025-01"], [0, 0]), /unique and ordered/);
  assert.throws(() => worstYear(["2025-01", "2025-03"], [0, 0]), /require consecutive monthly frames/);
});

test("worst-year metrics disclose whether the calendar year is complete", () => {
  assert.deepEqual(worstYear(["2025-01", "2025-02"], [-0.1, -0.1]), {
    label: "2025",
    return: -0.18999999999999995,
    observedMonths: 2,
    complete: false,
  });
  assert.deepEqual(
    worstYear(
      Array.from({ length: 12 }, (_, index) => `2024-${String(index + 1).padStart(2, "0")}`),
      Array.from({ length: 12 }, () => 0),
    ),
    { label: "2024", return: 0, observedMonths: 12, complete: true },
  );
});
