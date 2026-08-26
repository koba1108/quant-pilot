import type { DailyBar } from "./models.ts";
import { assertDailyBars, type MarketDataProvider, type MarketDataRequest } from "./provider.ts";

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function parseCsv(text: string, code: string): DailyBar[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((v) => v.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const date = idx("date");
  const close = idx("close");
  const volume = idx("volume");
  if (date < 0 || close < 0) throw new Error("Unexpected Stooq CSV schema");

  return lines.slice(1).flatMap((line) => {
    const cols = line.split(",");
    const price = Number(cols[close]);
    if (!cols[date] || !Number.isFinite(price) || price <= 0) return [];
    return [{
      code,
      tradingDate: cols[date],
      close: price,
      adjustedClose: price,
      volume: volume >= 0 ? Number(cols[volume]) || 0 : 0,
      tradingValue: 0,
    } satisfies DailyBar];
  });
}

export class StooqMarketDataProvider implements MarketDataProvider {
  readonly name = "stooq";

  constructor(
    private readonly apiKey = process.env.STOOQ_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async loadDailyBars(request: MarketDataRequest): Promise<DailyBar[]> {
    if (!this.apiKey) {
      throw new Error("STOOQ_API_KEY is required. Use CsvMarketDataProvider when no key is available.");
    }
    const params = new URLSearchParams({
      s: request.symbol.toLowerCase(),
      d1: compactDate(request.start),
      d2: compactDate(request.end),
      i: "d",
      apikey: this.apiKey,
    });
    const response = await this.fetchImpl(`https://stooq.com/q/d/l/?${params}`);
    if (!response.ok) throw new Error(`Stooq request failed: HTTP ${response.status}`);
    const text = await response.text();
    if (/error|limit|apikey/i.test(text) && !/^Date,/i.test(text)) {
      throw new Error(`Stooq returned an error for ${request.symbol}: ${text.slice(0, 160)}`);
    }
    return assertDailyBars(parseCsv(text, request.code), request.code);
  }
}
