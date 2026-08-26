import { readFile } from "node:fs/promises";
import type { DailyBar } from "./models.ts";
import { assertDailyBars, type MarketDataProvider, type MarketDataRequest } from "./provider.ts";

export class CsvMarketDataProvider implements MarketDataProvider {
  readonly name = "csv";

  constructor(private readonly rootDir = "data/raw") {}

  async loadDailyBars(request: MarketDataRequest): Promise<DailyBar[]> {
    const path = `${this.rootDir}/${request.symbol}.csv`;
    const text = await readFile(path, "utf8");
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error(`CSV has no rows: ${path}`);
    const header = lines[0].split(",").map((v) => v.trim().toLowerCase());
    const pos = (name: string) => header.indexOf(name);
    const date = pos("date");
    const close = pos("close");
    const adjusted = pos("adjustedclose");
    const volume = pos("volume");
    const tradingValue = pos("tradingvalue");
    if (date < 0 || close < 0) throw new Error(`CSV must contain Date and Close: ${path}`);

    const bars: DailyBar[] = lines.slice(1).flatMap((line) => {
      const cols = line.split(",");
      const tradingDate = cols[date];
      if (tradingDate < request.start || tradingDate > request.end) return [];
      const rawClose = Number(cols[close]);
      const adjustedClose = adjusted >= 0 ? Number(cols[adjusted]) : rawClose;
      if (!Number.isFinite(rawClose) || !Number.isFinite(adjustedClose)) return [];
      return [{
        code: request.code,
        tradingDate,
        close: rawClose,
        adjustedClose,
        volume: volume >= 0 ? Number(cols[volume]) || 0 : 0,
        tradingValue: tradingValue >= 0 ? Number(cols[tradingValue]) || 0 : 0,
      }];
    });
    return assertDailyBars(bars, request.code);
  }
}
