import type { DailyBar } from "./models.ts";
import { assertDailyBars, type MarketDataProvider, type MarketDataRequest } from "./provider.ts";

const DEFAULT_BASE_URL = "https://api.jquants.com";
const MAX_PAGES = 10_000;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function compactDate(value: string): string {
  if (!isIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  return value.replaceAll("-", "");
}

function assertCredentialBaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("J-Quants credential destination must be exactly https://api.jquants.com.");
  }
  if (
    parsed.origin !== DEFAULT_BASE_URL
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.username !== ""
    || parsed.password !== ""
  ) {
    throw new Error("J-Quants credential destination must be exactly https://api.jquants.com.");
  }
}

function normalizeProviderCode(value: string): string {
  if (/^\d{4}$/.test(value)) return `${value}0`;
  if (/^[0-9A-Z]{5}$/.test(value)) return value;
  throw new Error(
    `J-Quants v2 symbol must be a four-digit numeric or five-character alphanumeric security code: ${value}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, rowNumber: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`J-Quants row ${rowNumber} has invalid ${field}.`);
  }
  return value;
}

function requiredPositiveNumber(value: unknown, field: string, rowNumber: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`J-Quants row ${rowNumber} has invalid ${field}.`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, field: string, rowNumber: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`J-Quants row ${rowNumber} has invalid ${field}.`);
  }
  return value;
}

function parsePage(
  payload: unknown,
  request: MarketDataRequest,
  expectedSymbol: string,
  rowOffset: number,
): { bars: DailyBar[]; paginationKey?: string; rowCount: number; tradingDates: string[] } {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("J-Quants returned an unexpected daily-bars schema.");
  }
  const paginationKey = payload.pagination_key;
  if (paginationKey !== undefined && (typeof paginationKey !== "string" || paginationKey === "")) {
    throw new Error("J-Quants returned an invalid pagination_key.");
  }
  const bars: DailyBar[] = [];
  const tradingDates: string[] = [];
  for (const [index, rawRow] of payload.data.entries()) {
    const rowNumber = rowOffset + index + 1;
    if (!isRecord(rawRow)) throw new Error(`J-Quants row ${rowNumber} must be an object.`);
    const tradingDate = requiredText(rawRow.Date, "Date", rowNumber);
    if (!isIsoDate(tradingDate)) throw new Error(`J-Quants row ${rowNumber} has invalid Date.`);
    tradingDates.push(tradingDate);
    const providerCode = requiredText(rawRow.Code, "Code", rowNumber).toUpperCase();
    if (providerCode !== expectedSymbol) {
      throw new Error(`J-Quants row ${rowNumber} returned Code ${providerCode}; expected ${expectedSymbol}.`);
    }
    if (tradingDate < request.start || tradingDate > request.end) {
      throw new Error(
        `J-Quants returned ${request.code} bar ${tradingDate} outside requested range ${request.start}..${request.end}.`,
      );
    }
    if (rawRow.C === undefined || rawRow.AdjC === undefined) {
      throw new Error(`J-Quants row ${rowNumber} is missing C or AdjC.`);
    }
    const closeIsNull = rawRow.C === null;
    const adjustedCloseIsNull = rawRow.AdjC === null;
    if (closeIsNull !== adjustedCloseIsNull) {
      throw new Error(`J-Quants row ${rowNumber} has inconsistent null C/AdjC values.`);
    }
    if (closeIsNull) {
      if (rawRow.Vo !== undefined && rawRow.Vo !== null) {
        throw new Error(`J-Quants row ${rowNumber} has inconsistent no-trade Vo.`);
      }
      if (rawRow.Va !== undefined && rawRow.Va !== null) {
        throw new Error(`J-Quants row ${rowNumber} has inconsistent no-trade Va.`);
      }
      if (rawRow.AdjFactor !== undefined && rawRow.AdjFactor !== null) {
        requiredPositiveNumber(rawRow.AdjFactor, "AdjFactor", rowNumber);
      }
      // J-Quants explicitly returns no-trade dates with null prices. They are
      // missing observations, not zero-price bars, so omit them from the
      // normalized DailyBar contract.
      continue;
    }
    requiredPositiveNumber(rawRow.AdjFactor, "AdjFactor", rowNumber);
    bars.push({
      code: request.code,
      tradingDate,
      close: requiredPositiveNumber(rawRow.C, "C", rowNumber),
      adjustedClose: requiredPositiveNumber(rawRow.AdjC, "AdjC", rowNumber),
      volume: optionalNonNegativeNumber(rawRow.Vo, "Vo", rowNumber),
      tradingValue: optionalNonNegativeNumber(rawRow.Va, "Va", rowNumber),
    });
  }
  return { bars, paginationKey, rowCount: payload.data.length, tradingDates };
}

/**
 * Read-only J-Quants API v2 adapter spike.
 *
 * It intentionally exposes only the existing raw DailyBar contract. J-Quants
 * adjusted prices are not treated as Total Return, and this adapter does not
 * invent source-native row availability or revision history.
 */
export class JQuantsV2ResearchProvider implements MarketDataProvider {
  readonly name = "jquants-v2-research";

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(apiKey = process.env.JQUANTS_API_KEY, fetchImpl: FetchLike = fetch, baseUrl = DEFAULT_BASE_URL) {
    assertCredentialBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async loadDailyBars(request: MarketDataRequest): Promise<DailyBar[]> {
    if (!isIsoDate(request.start) || !isIsoDate(request.end)) {
      throw new Error(`Invalid J-Quants request dates: ${request.start}..${request.end}.`);
    }
    if (request.start > request.end) throw new Error(`Invalid J-Quants request range: ${request.start}..${request.end}.`);
    if (typeof this.apiKey !== "string" || this.apiKey.trim() === "") {
      throw new Error("JQUANTS_API_KEY is required for the J-Quants v2 research provider.");
    }
    const symbol = normalizeProviderCode(request.symbol);

    const bars: DailyBar[] = [];
    const seenTradingDates = new Set<string>();
    const seenPaginationKeys = new Set<string>();
    let rowsSeen = 0;
    let paginationKey: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL("/v2/equities/bars/daily", this.baseUrl);
      url.searchParams.set("code", symbol);
      url.searchParams.set("from", compactDate(request.start));
      url.searchParams.set("to", compactDate(request.end));
      if (paginationKey !== undefined) url.searchParams.set("pagination_key", paginationKey);
      const response = await this.fetchImpl(url, { headers: { "x-api-key": this.apiKey } });
      if (!response.ok) throw new Error(`J-Quants request failed: HTTP ${response.status}.`);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("J-Quants returned malformed JSON.");
      }
      const parsed = parsePage(payload, request, symbol, rowsSeen);
      rowsSeen += parsed.rowCount;
      for (const tradingDate of parsed.tradingDates) {
        if (seenTradingDates.has(tradingDate)) {
          throw new Error(`Duplicate date for ${request.code}: ${tradingDate}`);
        }
        seenTradingDates.add(tradingDate);
      }
      bars.push(...parsed.bars);
      if (parsed.paginationKey === undefined) return assertDailyBars(bars, request.code);
      if (seenPaginationKeys.has(parsed.paginationKey)) {
        throw new Error(`J-Quants repeated pagination_key ${parsed.paginationKey}.`);
      }
      seenPaginationKeys.add(parsed.paginationKey);
      paginationKey = parsed.paginationKey;
    }
    throw new Error(`J-Quants response exceeded ${MAX_PAGES} pages.`);
  }
}
