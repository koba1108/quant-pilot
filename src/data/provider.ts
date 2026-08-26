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

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

export function assertDailyBars(bars: DailyBar[], code: string): DailyBar[] {
  if (bars.length === 0) throw new Error(`No market data returned for ${code}`);

  const sorted = [...bars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  let previous = "";
  for (const bar of sorted) {
    if (bar.code !== code) throw new Error(`Unexpected code ${bar.code}; expected ${code}`);
    if (!isIsoDate(bar.tradingDate)) {
      throw new Error(`Invalid tradingDate for ${code}: ${bar.tradingDate}`);
    }
    if (!Number.isFinite(bar.close) || bar.close <= 0) {
      throw new Error(`Invalid close for ${code} on ${bar.tradingDate}`);
    }
    if (!Number.isFinite(bar.adjustedClose) || bar.adjustedClose <= 0) {
      throw new Error(`Invalid adjustedClose for ${code} on ${bar.tradingDate}`);
    }
    if (bar.volume !== undefined && (!Number.isFinite(bar.volume) || bar.volume < 0)) {
      throw new Error(`Invalid volume for ${code} on ${bar.tradingDate}`);
    }
    if (bar.tradingValue !== undefined && (!Number.isFinite(bar.tradingValue) || bar.tradingValue < 0)) {
      throw new Error(`Invalid tradingValue for ${code} on ${bar.tradingDate}`);
    }
    if (previous && bar.tradingDate <= previous) {
      throw new Error(`Duplicate date for ${code}: ${bar.tradingDate}`);
    }
    previous = bar.tradingDate;
  }
  return sorted;
}
