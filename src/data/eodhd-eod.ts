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

const DEFAULT_BASE_URL = "https://eodhd.com";
export const EODHD_EOD_ADAPTER_VERSION = "eodhd-eod-research-adapter-v1" as const;
export const EODHD_EOD_SOURCE_VERSION = "eodhd-eod-api" as const;
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

function assertCredentialBaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("EODHD credential destination must be exactly https://eodhd.com.");
  }
  if (
    parsed.origin !== DEFAULT_BASE_URL
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.username !== ""
    || parsed.password !== ""
  ) {
    throw new Error("EODHD credential destination must be exactly https://eodhd.com.");
  }
}

function normalizeSymbol(value: string): string {
  const symbol = value.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]*\.[A-Z0-9]{1,10}$/.test(symbol) || symbol.includes("..")) {
    throw new Error(`EODHD symbol must use the allowlisted SYMBOL.EXCHANGE form: ${value}.`);
  }
  return symbol;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredPositiveNumber(value: unknown, field: string, rowNumber: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`EODHD row ${rowNumber} has invalid ${field}.`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, field: string, rowNumber: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`EODHD row ${rowNumber} has invalid ${field}.`);
  }
  return value;
}

function parseRows(payload: unknown, request: MarketDataRequest): DailyBar[] {
  if (!Array.isArray(payload)) throw new Error("EODHD returned an unexpected daily-bars schema.");
  const bars: DailyBar[] = [];
  let previousDate = "";
  for (const [index, row] of payload.entries()) {
    const rowNumber = index + 1;
    if (!isRecord(row)) throw new Error(`EODHD row ${rowNumber} must be an object.`);
    if (!isIsoDate(row.date)) throw new Error(`EODHD row ${rowNumber} has invalid date.`);
    if (row.date < request.start || row.date > request.end) {
      throw new Error(
        `EODHD returned ${request.code} bar ${row.date} outside requested range ${request.start}..${request.end}.`,
      );
    }
    if (previousDate !== "" && row.date <= previousDate) {
      throw new Error(`EODHD rows must be strictly ascending with no duplicate date: ${row.date}.`);
    }
    previousDate = row.date;
    bars.push({
      code: request.code,
      tradingDate: row.date,
      close: requiredPositiveNumber(row.close, "close", rowNumber),
      adjustedClose: requiredPositiveNumber(row.adjusted_close, "adjusted_close", rowNumber),
      volume: optionalNonNegativeNumber(row.volume, "volume", rowNumber),
      tradingValue: undefined,
    });
  }
  return assertDailyBars(bars, request.code);
}

export function parseEodhdCapturedDailyBars(
  responses: readonly CapturedProviderHttpResponse[],
  request: MarketDataRequest,
): DailyBar[] {
  if (responses.length !== 1 || responses[0]!.page !== 1) {
    throw new Error("EODHD EOD replay requires exactly one captured response page.");
  }
  if (!isIsoDate(request.start) || !isIsoDate(request.end) || request.start > request.end) {
    throw new Error(`Invalid EODHD replay range: ${request.start}..${request.end}.`);
  }
  normalizeSymbol(request.symbol);
  return parseRows(parseCapturedJson(responses[0]!), request);
}

/**
 * Read-only EODHD EOD research adapter for a credentialed comparison sample.
 *
 * The provider's adjusted_close is retained as provider-adjusted evidence. It
 * is not classified as an official Total Return series, and missing values are
 * never synthesized.
 */
export class EodhdEodResearchProvider implements CapturingMarketDataProvider {
  readonly name = "eodhd-eod-research";

  private readonly apiToken: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly clock: Clock;
  private readonly credentialEnvVar: string;

  constructor(
    apiToken = process.env.EODHD_API_TOKEN,
    fetchImpl: FetchLike = fetch,
    baseUrl = DEFAULT_BASE_URL,
    clock: Clock = () => new Date().toISOString(),
    credentialEnvVar = "EODHD_API_TOKEN",
  ) {
    assertCredentialBaseUrl(baseUrl);
    this.apiToken = apiToken;
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
      throw new Error(`Invalid EODHD request dates: ${request.start}..${request.end}.`);
    }
    if (request.start > request.end) throw new Error(`Invalid EODHD request range: ${request.start}..${request.end}.`);
    if (typeof this.apiToken !== "string" || this.apiToken.trim() === "") {
      throw new Error(`${this.credentialEnvVar} is required for the EODHD research provider.`);
    }
    const symbol = normalizeSymbol(request.symbol);
    const url = new URL(`/api/eod/${encodeURIComponent(symbol)}`, this.baseUrl);
    url.searchParams.set("api_token", this.apiToken);
    url.searchParams.set("from", request.start);
    url.searchParams.set("to", request.end);
    url.searchParams.set("period", "d");
    url.searchParams.set("order", "a");
    url.searchParams.set("fmt", "json");
    const redactedRequest: RedactedProviderRequest = {
      method: "GET",
      origin: DEFAULT_BASE_URL,
      pathname: url.pathname,
      query: {
        from: request.start,
        to: request.end,
        period: "d",
        order: "a",
        fmt: "json",
      },
      credential: {
        envVar: this.credentialEnvVar,
        transport: "query",
        field: "api_token",
        retainedValue: "omitted",
      },
    };
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "GET", redirect: "error" });
    } catch (error) {
      throw new Error("EODHD network request failed before a response was captured.", { cause: error });
    }
    const captured = await captureJsonResponse(response, {
      request: redactedRequest,
      page: 1,
      retrievedAt: this.clock(),
      credentialValue: this.apiToken,
      providerLabel: "EODHD",
    });
    return { bars: parseEodhdCapturedDailyBars([captured.capture], request), responses: [captured.capture] };
  }
}
