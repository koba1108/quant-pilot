import type { DailyBar } from "./models.ts";

export interface MarketDataRequest {
  code: string;
  symbol: string;
  start: string;
  end: string;
}

export interface MarketDataProvider {
  readonly name: string;
  loadDailyBars(request: MarketDataRequest): Promise<DailyBar[]>;
}

export function assertDailyBars(bars: DailyBar[], code: string): DailyBar[] {
  if (bars.length === 0) throw new Error(`No market data returned for ${code}`);

  const sorted = [...bars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  let previous = "";
  for (const bar of sorted) {
    if (bar.code !== code) throw new Error(`Unexpected code ${bar.code}; expected ${code}`);
    if (!Number.isFinite(bar.adjustedClose) || bar.adjustedClose <= 0) {
      throw new Error(`Invalid adjustedClose for ${code} on ${bar.tradingDate}`);
    }
    if (previous && bar.tradingDate <= previous) {
      throw new Error(`Duplicate or unsorted date for ${code}: ${bar.tradingDate}`);
    }
    previous = bar.tradingDate;
  }
  return sorted;
}
