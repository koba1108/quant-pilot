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

    const requiredNumber = (value: string | undefined, field: string, lineNumber: number): number => {
      if (value === undefined || value.trim() === "") {
        throw new Error(`Missing ${field} in ${path} at line ${lineNumber}`);
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${field} in ${path} at line ${lineNumber}`);
      }
      return parsed;
    };
    const optionalNumber = (value: string | undefined, field: string, lineNumber: number): number | undefined => {
      if (value === undefined || value.trim() === "") return undefined;
      return requiredNumber(value, field, lineNumber);
    };

    const bars: DailyBar[] = [];
    for (const [index, line] of lines.slice(1).entries()) {
      const lineNumber = index + 2;
      const cols = line.split(",").map((value) => value.trim());
      const tradingDate = cols[date];
      if (!tradingDate) throw new Error(`Missing Date in ${path} at line ${lineNumber}`);
      if (tradingDate < request.start || tradingDate > request.end) continue;
      const rawClose = requiredNumber(cols[close], "Close", lineNumber);
      const adjustedClose = adjusted >= 0
        ? requiredNumber(cols[adjusted], "AdjustedClose", lineNumber)
        : rawClose;
      bars.push({
        code: request.code,
        tradingDate,
        close: rawClose,
        adjustedClose,
        volume: volume >= 0 ? optionalNumber(cols[volume], "Volume", lineNumber) : undefined,
        tradingValue: tradingValue >= 0
          ? optionalNumber(cols[tradingValue], "TradingValue", lineNumber)
          : undefined,
      });
    }
    return assertDailyBars(bars, request.code);
  }
}
