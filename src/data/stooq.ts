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

  const bars: DailyBar[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const lineNumber = index + 2;
    const cols = line.split(",").map((value) => value.trim());
    if (!cols[date]) throw new Error(`Missing Date in Stooq response at line ${lineNumber}`);
    if (!cols[close]) throw new Error(`Missing Close in Stooq response at line ${lineNumber}`);
    const price = Number(cols[close]);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid Close in Stooq response at line ${lineNumber}`);
    }
    const rawVolume = volume >= 0 ? cols[volume]?.trim() : undefined;
    const parsedVolume = rawVolume ? Number(rawVolume) : undefined;
    if (parsedVolume !== undefined && (!Number.isFinite(parsedVolume) || parsedVolume < 0)) {
      throw new Error(`Invalid Volume in Stooq response at line ${lineNumber}`);
    }
    bars.push({
      code,
      tradingDate: cols[date],
      close: price,
      adjustedClose: price,
      volume: parsedVolume,
      tradingValue: undefined,
    });
  }
  return bars;
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
