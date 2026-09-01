import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EodhdEodResearchProvider } from "../src/data/eodhd-eod.ts";

const request = {
  code: "ETF-1305",
  symbol: "1305.T",
  start: "2025-01-01",
  end: "2025-01-31",
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function validRows() {
  return [
    { date: "2025-01-06", close: 100, adjusted_close: 99.5, volume: 10 },
    { date: "2025-01-07", close: 101, adjusted_close: 100.5, volume: 11 },
  ];
}

test("EODHD captures query-auth request, immutable raw bytes/hash, and missing volume without filling", async () => {
  const token = "secret-eodhd-token";
  let calledUrl: URL | undefined;
  let calledInit: RequestInit | undefined;
  const body = JSON.stringify(validRows());
  const provider = new EodhdEodResearchProvider(
    token,
    async (input, init) => {
      calledUrl = new URL(input instanceof URL ? input.href : input.toString());
      calledInit = init;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", etag: "etag-1" },
      });
    },
    undefined,
    () => "2025-02-01T00:00:00Z",
  );

  const captured = await provider.captureDailyBars(request);
  assert.deepEqual(captured.bars, [
    { code: "ETF-1305", tradingDate: "2025-01-06", close: 100, adjustedClose: 99.5, volume: 10, tradingValue: undefined },
    { code: "ETF-1305", tradingDate: "2025-01-07", close: 101, adjustedClose: 100.5, volume: 11, tradingValue: undefined },
  ]);
  assert.ok(calledUrl);
  assert.equal(calledUrl.searchParams.get("api_token"), token);
  assert.equal(calledUrl.searchParams.get("from"), request.start);
  assert.equal(calledUrl.searchParams.get("to"), request.end);
  assert.equal(calledUrl.searchParams.get("period"), "d");
  assert.equal(calledUrl.searchParams.get("order"), "a");
  assert.equal(calledUrl.searchParams.get("fmt"), "json");
  assert.equal(calledInit?.redirect, "error");

  const responseCapture = captured.responses[0]!;
  assert.equal(responseCapture.request.credential.transport, "query");
  assert.equal(responseCapture.request.credential.field, "api_token");
  assert.equal(responseCapture.request.credential.retainedValue, "omitted");
  assert.equal(Object.keys(responseCapture.request.query).includes("api_token"), false);
  assert.equal(JSON.stringify(responseCapture).includes(token), false);
  assert.equal(responseCapture.response.bodyHash, `sha256:${createHash("sha256").update(body).digest("hex")}`);
  assert.equal(responseCapture.response.bodyBase64, Buffer.from(body).toString("base64"));
});

test("EODHD requires credentials and rejects unsafe hosts or symbols before network", async () => {
  const neverFetch: FetchLike = async () => {
    throw new Error("fetch must not run");
  };
  await assert.rejects(
    // Pass an explicit empty value so the test remains isolated when Bun auto-loads
    // a repository .env file into process.env.
    () => new EodhdEodResearchProvider("", neverFetch).loadDailyBars(request),
    /EODHD_API_TOKEN is required/,
  );
  for (const baseUrl of [
    "http://eodhd.com",
    "https://evil.example",
    "https://eodhd.com/custom",
    "https://user:password@eodhd.com",
    "https://eodhd.com/?redirect=https://evil.example",
  ]) {
    assert.throws(
      () => new EodhdEodResearchProvider("secret-test-eodhd-key", neverFetch, baseUrl),
      /credential destination must be exactly https:\/\/eodhd\.com/,
    );
  }
  for (const symbol of ["1305", "1305..T", "1305.T?x=1", "../evil.T", ""] ) {
    await assert.rejects(
      () => new EodhdEodResearchProvider("secret-test-eodhd-key", neverFetch).loadDailyBars({ ...request, symbol }),
      /allowlisted SYMBOL\.EXCHANGE form/,
    );
  }
});

test("EODHD validates ISO request dates and requested range before network", async () => {
  const neverFetch: FetchLike = async () => {
    throw new Error("fetch must not run");
  };
  const provider = new EodhdEodResearchProvider("secret-test-eodhd-key", neverFetch);
  await assert.rejects(
    () => provider.loadDailyBars({ ...request, start: "2025-02-29" }),
    /Invalid EODHD request dates/,
  );
  await assert.rejects(
    () => provider.loadDailyBars({ ...request, start: "2025-02-01", end: "2025-01-31" }),
    /Invalid EODHD request range/,
  );
});

test("EODHD maps an explicitly null volume to undefined rather than zero or a prior value", async () => {
  const provider = new EodhdEodResearchProvider(
    "secret-test-eodhd-key",
    async () => jsonResponse([{ date: "2025-01-06", close: 100, adjusted_close: 100, volume: null }]),
  );
  const bars = await provider.loadDailyBars(request);
  assert.equal(bars[0]!.volume, undefined);
  assert.equal("volume" in bars[0]!, true);
});

test("EODHD rejects out-of-range, duplicate, and reverse-ordered rows", async () => {
  const cases: { payload: unknown; pattern: RegExp }[] = [
    {
      payload: [{ date: "2024-12-31", close: 100, adjusted_close: 100 }],
      pattern: /outside requested range/,
    },
    {
      payload: [{ date: "2025-01-06", close: 100, adjusted_close: 100 }, { date: "2025-01-06", close: 101, adjusted_close: 101 }],
      pattern: /strictly ascending with no duplicate date/,
    },
    {
      payload: [{ date: "2025-01-07", close: 101, adjusted_close: 101 }, { date: "2025-01-06", close: 100, adjusted_close: 100 }],
      pattern: /strictly ascending with no duplicate date/,
    },
  ];
  for (const scenario of cases) {
    const fetchImpl: FetchLike = async () => jsonResponse(scenario.payload);
    await assert.rejects(
      () => new EodhdEodResearchProvider("secret-test-eodhd-key", fetchImpl).loadDailyBars(request),
      scenario.pattern,
    );
  }
});

test("EODHD rejects empty, malformed, invalid-schema, and invalid-field responses", async () => {
  const cases: { body: string; pattern: RegExp }[] = [
    { body: JSON.stringify([]), pattern: /No market data returned for ETF-1305/ },
    { body: JSON.stringify({ data: validRows() }), pattern: /unexpected daily-bars schema/ },
    { body: JSON.stringify([null]), pattern: /row 1 must be an object/ },
    { body: JSON.stringify([{ date: "2025-01-32", close: 100, adjusted_close: 100 }]), pattern: /row 1 has invalid date/ },
    { body: JSON.stringify([{ date: "2025-01-06", close: 0, adjusted_close: 100 }]), pattern: /row 1 has invalid close/ },
    { body: JSON.stringify([{ date: "2025-01-06", close: 100, adjusted_close: -1 }]), pattern: /row 1 has invalid adjusted_close/ },
    { body: JSON.stringify([{ date: "2025-01-06", close: 100, adjusted_close: 100, volume: -1 }]), pattern: /row 1 has invalid volume/ },
  ];
  for (const scenario of cases) {
    const fetchImpl: FetchLike = async () => new Response(scenario.body, { headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => new EodhdEodResearchProvider("secret-test-eodhd-key", fetchImpl).loadDailyBars(request),
      scenario.pattern,
    );
  }
});

test("EODHD retains no response on network failure, rejects redirect errors, HTTP errors, malformed JSON, and credential echo", async () => {
  const networkFailure: FetchLike = async () => {
    throw new Error("redirected");
  };
  await assert.rejects(
    () => new EodhdEodResearchProvider("secret-test-eodhd-key", networkFailure).loadDailyBars(request),
    /network request failed before a response was captured/,
  );

  let redirectMode: string | undefined;
  const redirectCheck: FetchLike = async (_input, init) => {
    redirectMode = init?.redirect;
    throw new TypeError("unexpected redirect");
  };
  await assert.rejects(
    () => new EodhdEodResearchProvider("secret-test-eodhd-key", redirectCheck).loadDailyBars(request),
    /network request failed before a response was captured/,
  );
  assert.equal(redirectMode, "error");

  await assert.rejects(
    () => new EodhdEodResearchProvider("secret-test-eodhd-key", async () => jsonResponse({ message: "denied" }, 401)).loadDailyBars(request),
    /EODHD request failed: HTTP 401/,
  );
  await assert.rejects(
    () => new EodhdEodResearchProvider("secret-test-eodhd-key", async () => new Response("not-json")).loadDailyBars(request),
    /malformed JSON/,
  );
  await assert.rejects(
    () => new EodhdEodResearchProvider(
      "secret-test-eodhd-key",
      async () => new Response(JSON.stringify([{
        date: "2025-01-06",
        close: 100,
        adjusted_close: 100,
        credential_echo: "secret-test-eodhd-key",
      }])),
    ).loadDailyBars(request),
    /echoed a credential/,
  );
});
