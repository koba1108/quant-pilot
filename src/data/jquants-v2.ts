import type { DailyBar } from "./models.ts";
import {
  assertDailyBars,
  type CapturedDailyBars,
  type CapturingMarketDataProvider,
  type MarketDataRequest,
} from "./provider.ts";
import {
  captureJsonResponse,
  parseCapturedJson,
  type CapturedProviderHttpResponse,
  type RedactedProviderRequest,
} from "./provider-http-capture.ts";

const DEFAULT_BASE_URL = "https://api.jquants.com";
const MAX_PAGES = 10_000;
export const JQUANTS_V2_ADAPTER_VERSION = "jquants-v2-research-adapter-v2" as const;
export const JQUANTS_V2_SOURCE_VERSION = "jquants-api-v2" as const;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Clock = () => string;

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

export function parseJQuantsCapturedDailyBars(
  responses: readonly CapturedProviderHttpResponse[],
  request: MarketDataRequest,
): DailyBar[] {
  if (responses.length === 0) throw new Error("J-Quants replay requires at least one captured response.");
  if (!isIsoDate(request.start) || !isIsoDate(request.end) || request.start > request.end) {
    throw new Error(`Invalid J-Quants replay range: ${request.start}..${request.end}.`);
  }
  const symbol = normalizeProviderCode(request.symbol);
  const pages = [...responses].sort((left, right) => left.page - right.page);
  if (pages.some((page, index) => page.page !== index + 1)) {
    throw new Error("J-Quants replay pages must be complete and sequential.");
  }
  const bars: DailyBar[] = [];
  const seenTradingDates = new Set<string>();
  const seenPaginationKeys = new Set<string>();
  let rowsSeen = 0;
  for (const [index, response] of pages.entries()) {
    const parsed = parsePage(parseCapturedJson(response), request, symbol, rowsSeen);
    rowsSeen += parsed.rowCount;
    for (const tradingDate of parsed.tradingDates) {
      if (seenTradingDates.has(tradingDate)) throw new Error(`Duplicate date for ${request.code}: ${tradingDate}`);
      seenTradingDates.add(tradingDate);
    }
    bars.push(...parsed.bars);
    const next = pages[index + 1];
    if (parsed.paginationKey === undefined) {
      if (next !== undefined) throw new Error("J-Quants replay contains a response after the terminal page.");
      continue;
    }
    if (seenPaginationKeys.has(parsed.paginationKey)) {
      throw new Error(`J-Quants repeated pagination_key ${parsed.paginationKey}.`);
    }
    seenPaginationKeys.add(parsed.paginationKey);
    if (next === undefined || next.request.query.pagination_key !== parsed.paginationKey) {
      throw new Error("J-Quants replay pagination lineage is incomplete or mismatched.");
    }
  }
  return assertDailyBars(bars, request.code);
}

/**
 * Read-only J-Quants API v2 adapter spike.
 *
 * It intentionally exposes only the existing raw DailyBar contract. J-Quants
 * adjusted prices are not treated as Total Return, and this adapter does not
 * invent source-native row availability or revision history.
 */
export class JQuantsV2ResearchProvider implements CapturingMarketDataProvider {
  readonly name = "jquants-v2-research";

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly clock: Clock;
  private readonly credentialEnvVar: string;

  constructor(
    apiKey = process.env.JQUANTS_API_KEY,
    fetchImpl: FetchLike = fetch,
    baseUrl = DEFAULT_BASE_URL,
    clock: Clock = () => new Date().toISOString(),
    credentialEnvVar = "JQUANTS_API_KEY",
  ) {
    assertCredentialBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.clock = clock;
    this.credentialEnvVar = credentialEnvVar;
  }

  async loadDailyBars(request: MarketDataRequest): Promise<DailyBar[]> {
    return [...(await this.captureDailyBars(request)).bars];
  }

  async captureDailyBars(request: MarketDataRequest): Promise<CapturedDailyBars> {
    if (!isIsoDate(request.start) || !isIsoDate(request.end)) {
      throw new Error(`Invalid J-Quants request dates: ${request.start}..${request.end}.`);
    }
    if (request.start > request.end) throw new Error(`Invalid J-Quants request range: ${request.start}..${request.end}.`);
    if (typeof this.apiKey !== "string" || this.apiKey.trim() === "") {
      throw new Error(`${this.credentialEnvVar} is required for the J-Quants v2 research provider.`);
    }
    const symbol = normalizeProviderCode(request.symbol);

    const bars: DailyBar[] = [];
    const responses: CapturedProviderHttpResponse[] = [];
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
      const redactedRequest: RedactedProviderRequest = {
        method: "GET",
        origin: DEFAULT_BASE_URL,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        credential: {
          envVar: this.credentialEnvVar,
          transport: "header",
          field: "x-api-key",
          retainedValue: "omitted",
        },
      };
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { "x-api-key": this.apiKey },
          redirect: "error",
        });
      } catch (error) {
        throw new Error("J-Quants network request failed before a response was captured.", { cause: error });
      }
      const captured = await captureJsonResponse(response, {
        request: redactedRequest,
        page: page + 1,
        retrievedAt: this.clock(),
        credentialValue: this.apiKey,
        providerLabel: "J-Quants",
      });
      responses.push(captured.capture);
      const payload = captured.payload;
      const parsed = parsePage(payload, request, symbol, rowsSeen);
      rowsSeen += parsed.rowCount;
      for (const tradingDate of parsed.tradingDates) {
        if (seenTradingDates.has(tradingDate)) {
          throw new Error(`Duplicate date for ${request.code}: ${tradingDate}`);
        }
        seenTradingDates.add(tradingDate);
      }
      bars.push(...parsed.bars);
      if (parsed.paginationKey === undefined) {
        return { bars: parseJQuantsCapturedDailyBars(responses, request), responses };
      }
      if (seenPaginationKeys.has(parsed.paginationKey)) {
        throw new Error(`J-Quants repeated pagination_key ${parsed.paginationKey}.`);
      }
      seenPaginationKeys.add(parsed.paginationKey);
      paginationKey = parsed.paginationKey;
    }
    throw new Error(`J-Quants response exceeded ${MAX_PAGES} pages.`);
  }
}
