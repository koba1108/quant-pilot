import test from "node:test";
import assert from "node:assert/strict";
import { JQuantsV2ResearchProvider } from "../src/data/jquants-v2.ts";

const request = {
  code: "ETF",
  symbol: "13050",
  start: "2025-01-01",
  end: "2025-01-31",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("J-Quants v2 adapter paginates with header auth and preserves optional missing values", async () => {
  const calls: { url: URL; apiKey: string | null }[] = [];
  const pages = [
    {
      data: [{ Date: "2025-01-06", Code: "13050", C: 100, AdjFactor: 1, AdjC: 100, Vo: 10, Va: 1000 }],
      pagination_key: "page-2",
    },
    {
      data: [
        { Date: "2025-01-02", Code: "13050", C: null, AdjFactor: 1, AdjC: null, Vo: null, Va: null },
        { Date: "2025-01-07", Code: "13050", C: 101, AdjFactor: 1, AdjC: 101, Vo: null, Va: null },
      ],
    },
  ];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(input instanceof URL ? input.href : input.toString()),
      apiKey: new Headers(init?.headers).get("x-api-key"),
    });
    return jsonResponse(pages.shift());
  };
  const provider = new JQuantsV2ResearchProvider("secret-test-key", fetchImpl);

  const bars = await provider.loadDailyBars(request);
  assert.deepEqual(bars, [
    { code: "ETF", tradingDate: "2025-01-06", close: 100, adjustedClose: 100, volume: 10, tradingValue: 1000 },
    { code: "ETF", tradingDate: "2025-01-07", close: 101, adjustedClose: 101, volume: undefined, tradingValue: undefined },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.apiKey, "secret-test-key");
  assert.equal(calls[0]!.url.pathname, "/v2/equities/bars/daily");
  assert.equal(calls[0]!.url.searchParams.get("code"), "13050");
  assert.equal(calls[0]!.url.searchParams.get("from"), "20250101");
  assert.equal(calls[0]!.url.searchParams.get("to"), "20250131");
  assert.equal(calls[0]!.url.searchParams.has("pagination_key"), false);
  assert.equal(calls[1]!.url.searchParams.get("pagination_key"), "page-2");
  assert.equal(calls[0]!.url.search.includes("secret-test-key"), false);
});

test("J-Quants v2 adapter requires credentials and a valid provider code", async () => {
  const neverFetch = async () => {
    throw new Error("fetch must not run");
  };
  // Pass an explicit empty value so the test remains isolated when Bun auto-loads
  // a repository .env file into process.env.
  await assert.rejects(() => new JQuantsV2ResearchProvider("", neverFetch).loadDailyBars(request), /JQUANTS_API_KEY/);
  await assert.rejects(
    () => new JQuantsV2ResearchProvider("key", neverFetch).loadDailyBars({ ...request, symbol: "130" }),
    /four-digit numeric or five-character alphanumeric security code/,
  );
});

test("J-Quants v2 adapter normalizes four-digit numeric and preserves five-character codes", async () => {
  const calls: URL[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(input instanceof URL ? input.href : input.toString());
    calls.push(url);
    return jsonResponse({
      data: [{ Date: "2025-01-06", Code: url.searchParams.get("code"), C: 100, AdjFactor: 1, AdjC: 100 }],
    });
  };
  const provider = new JQuantsV2ResearchProvider("key", fetchImpl);

  await provider.loadDailyBars({ ...request, symbol: "1305" });
  await provider.loadDailyBars({ ...request, symbol: "233A0" });
  assert.equal(calls[0]!.searchParams.get("code"), "13050");
  assert.equal(calls[1]!.searchParams.get("code"), "233A0");
});

test("J-Quants v2 adapter rejects unsafe credential destinations before fetch", () => {
  const neverFetch = async () => {
    throw new Error("fetch must not run");
  };
  for (const baseUrl of [
    "http://api.jquants.com",
    "https://evil.example",
    "https://api.jquants.com/custom",
    "https://user:password@api.jquants.com",
  ]) {
    assert.throws(
      () => new JQuantsV2ResearchProvider("key", neverFetch, baseUrl),
      /credential destination must be exactly https:\/\/api\.jquants\.com/,
    );
  }
});

test("J-Quants v2 adapter validates real ISO dates before fetch", async () => {
  const neverFetch = async () => {
    throw new Error("fetch must not run");
  };
  const provider = new JQuantsV2ResearchProvider("key", neverFetch);
  await assert.rejects(
    () => provider.loadDailyBars({ ...request, start: "2025-02-29" }),
    /Invalid J-Quants request dates/,
  );
  await assert.rejects(
    () => provider.loadDailyBars({ ...request, start: "2025-02-01", end: "2025-01-31" }),
    /Invalid J-Quants request range/,
  );
});

test("J-Quants v2 adapter rejects malformed, inconsistent, or unsafe rows", async () => {
  const cases: { payload: unknown; pattern: RegExp }[] = [
    { payload: {}, pattern: /unexpected daily-bars schema/ },
    {
      payload: { data: [{ Date: "2025-01-06", Code: "99990", C: 100, AdjFactor: 1, AdjC: 100 }] },
      pattern: /returned Code 99990/,
    },
    {
      payload: { data: [{ Date: "2024-12-31", Code: "13050", C: 100, AdjFactor: 1, AdjC: 100 }] },
      pattern: /outside requested range/,
    },
    {
      payload: { data: [{ Date: "2025-01-06", Code: "13050", C: null, AdjFactor: 1, AdjC: 100 }] },
      pattern: /inconsistent null C\/AdjC/,
    },
    {
      payload: { data: [{ Date: "2025-01-06", Code: "13050", C: 100, AdjFactor: 0, AdjC: 100 }] },
      pattern: /invalid AdjFactor/,
    },
  ];
  for (const scenario of cases) {
    const fetchImpl = async () => jsonResponse(scenario.payload);
    await assert.rejects(
      () => new JQuantsV2ResearchProvider("key", fetchImpl).loadDailyBars(request),
      scenario.pattern,
    );
  }
});

test("J-Quants v2 adapter omits no-trade rows without zero filling and rejects inconsistent nulls", async () => {
  const provider = new JQuantsV2ResearchProvider("key", async () => jsonResponse({
    data: [
      { Date: "2025-01-06", Code: "13050", C: null, AdjFactor: 1, AdjC: null, Vo: null, Va: null },
      { Date: "2025-01-07", Code: "13050", C: 101, AdjFactor: 1, AdjC: 101 },
    ],
  }));
  await assert.deepEqual(await provider.loadDailyBars(request), [
    { code: "ETF", tradingDate: "2025-01-07", close: 101, adjustedClose: 101, volume: undefined, tradingValue: undefined },
  ]);

  const allNoTrade = new JQuantsV2ResearchProvider("key", async () => jsonResponse({
    data: [{ Date: "2025-01-06", Code: "13050", C: null, AdjFactor: 1, AdjC: null, Vo: null, Va: null }],
  }));
  await assert.rejects(() => allNoTrade.loadDailyBars(request), /No market data returned for ETF/);

  const inconsistent = new JQuantsV2ResearchProvider("key", async () => jsonResponse({
    data: [{ Date: "2025-01-06", Code: "13050", C: null, AdjFactor: 1, AdjC: 100 }],
  }));
  await assert.rejects(() => inconsistent.loadDailyBars(request), /inconsistent null C\/AdjC/);

  const missingAdjusted = new JQuantsV2ResearchProvider("key", async () => jsonResponse({
    data: [{ Date: "2025-01-06", Code: "13050", C: null, AdjFactor: 1 }],
  }));
  await assert.rejects(() => missingAdjusted.loadDailyBars(request), /missing C or AdjC/);

  const duplicateNullAndTraded = new JQuantsV2ResearchProvider("key", async () => jsonResponse({
    data: [
      { Date: "2025-01-06", Code: "13050", C: null, AdjFactor: 1, AdjC: null },
      { Date: "2025-01-06", Code: "13050", C: 100, AdjFactor: 1, AdjC: 100 },
    ],
  }));
  await assert.rejects(() => duplicateNullAndTraded.loadDailyBars(request), /Duplicate date/);

  const invalidNullDate = new JQuantsV2ResearchProvider("key", async () => jsonResponse({
    data: [{ Date: "2025-01-32", Code: "13050", C: null, AdjFactor: 1, AdjC: null }],
  }));
  await assert.rejects(() => invalidNullDate.loadDailyBars({ ...request, end: "2025-02-28" }), /invalid Date/);
});

test("J-Quants v2 adapter rejects malformed JSON, HTTP errors, repeated pages, and duplicate dates", async () => {
  const malformed = async () => new Response("not-json");
  await assert.rejects(
    () => new JQuantsV2ResearchProvider("key", malformed).loadDailyBars(request),
    /malformed JSON/,
  );

  const httpError = async () => jsonResponse({ message: "denied" }, 401);
  await assert.rejects(
    () => new JQuantsV2ResearchProvider("key", httpError).loadDailyBars(request),
    /HTTP 401/,
  );

  let repeatedCall = 0;
  const repeated = async () => {
    repeatedCall += 1;
    return jsonResponse({
      data: [{
        Date: repeatedCall === 1 ? "2025-01-06" : "2025-01-07",
        Code: "13050",
        C: 100,
        AdjFactor: 1,
        AdjC: 100,
      }],
      pagination_key: "same-page",
    });
  };
  await assert.rejects(
    () => new JQuantsV2ResearchProvider("key", repeated).loadDailyBars(request),
    /repeated pagination_key/,
  );

  let duplicateCall = 0;
  const duplicate = async () => {
    duplicateCall += 1;
    return jsonResponse({
      data: [{ Date: "2025-01-06", Code: "13050", C: 100, AdjFactor: 1, AdjC: 100 }],
      ...(duplicateCall === 1 ? { pagination_key: "next" } : {}),
    });
  };
  await assert.rejects(
    () => new JQuantsV2ResearchProvider("key", duplicate).loadDailyBars(request),
    /Duplicate date/,
  );
});
