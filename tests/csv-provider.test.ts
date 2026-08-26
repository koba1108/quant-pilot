import test from "node:test";
import assert from "node:assert/strict";
import { CsvMarketDataProvider } from "../src/data/csv.ts";

const provider = new CsvMarketDataProvider("tests/fixtures/market-data");

test("CSV provider enforces requested listing and delisting bounds", async () => {
  const bars = await provider.loadDailyBars({
    code: "BOUNDED",
    symbol: "synthetic",
    start: "2025-04-01",
    end: "2025-04-30",
  });

  assert.equal(bars[0]!.tradingDate, "2025-04-01");
  assert.equal(bars.at(-1)!.tradingDate, "2025-04-30");
  assert.ok(bars.every((bar) => bar.tradingDate >= "2025-04-01" && bar.tradingDate <= "2025-04-30"));
});

test("CSV provider fails loudly when an in-range price is missing", async () => {
  await assert.rejects(
    provider.loadDailyBars({
      code: "INVALID",
      symbol: "invalid-missing",
      start: "2025-01-01",
      end: "2025-01-31",
    }),
    /Missing Close/,
  );
});

test("CSV provider preserves unavailable optional fields instead of substituting zero", async () => {
  const bars = await provider.loadDailyBars({
    code: "MINIMAL",
    symbol: "minimal",
    start: "2025-01-01",
    end: "2025-01-31",
  });

  assert.equal(bars[0]!.volume, undefined);
  assert.equal(bars[0]!.tradingValue, undefined);
});
