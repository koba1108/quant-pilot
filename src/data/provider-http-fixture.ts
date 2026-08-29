import { readFile } from "node:fs/promises";
import { canonicalJson, isIsoDateTime } from "./provenance.ts";

export const PROVIDER_HTTP_FIXTURE_SCHEMA_VERSION = "provider-http-fixture-v1" as const;

export interface ProviderHttpFixtureResponse {
  request: {
    origin: string;
    pathname: string;
    query: Readonly<Record<string, string>>;
  };
  response: {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: string;
  };
  retrievedAt: string;
}

export interface ProviderHttpFixture {
  schemaVersion: typeof PROVIDER_HTTP_FIXTURE_SCHEMA_VERSION;
  providerId: "jquants_v2" | "eodhd_eod";
  responses: readonly ProviderHttpFixtureResponse[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.sort().join(", ")}.`);
}

function parseStringRecord(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim() === "" || typeof item !== "string") throw new Error(`${field} must contain string values.`);
    output[key] = item;
  }
  return output;
}

export function validateProviderHttpFixture(value: unknown): ProviderHttpFixture {
  if (!isRecord(value)) throw new Error("Provider HTTP fixture must be an object.");
  assertOnlyKeys(value, ["schemaVersion", "providerId", "responses"], "Provider HTTP fixture");
  if (value.schemaVersion !== PROVIDER_HTTP_FIXTURE_SCHEMA_VERSION) {
    throw new Error(`Provider HTTP fixture schemaVersion must be ${PROVIDER_HTTP_FIXTURE_SCHEMA_VERSION}.`);
  }
  if (value.providerId !== "jquants_v2" && value.providerId !== "eodhd_eod") {
    throw new Error("Provider HTTP fixture providerId is unsupported.");
  }
  if (!Array.isArray(value.responses) || value.responses.length === 0) {
    throw new Error("Provider HTTP fixture responses must be a non-empty array.");
  }
  const responses = value.responses.map((item, index) => {
    const field = `Provider HTTP fixture responses[${index}]`;
    if (!isRecord(item)) throw new Error(`${field} must be an object.`);
    assertOnlyKeys(item, ["request", "response", "retrievedAt"], field);
    if (!isRecord(item.request)) throw new Error(`${field}.request must be an object.`);
    assertOnlyKeys(item.request, ["origin", "pathname", "query"], `${field}.request`);
    if (typeof item.request.origin !== "string" || typeof item.request.pathname !== "string") {
      throw new Error(`${field}.request origin and pathname must be strings.`);
    }
    let origin: URL;
    try {
      origin = new URL(item.request.origin);
    } catch {
      throw new Error(`${field}.request.origin must be an exact HTTPS origin.`);
    }
    if (origin.protocol !== "https:"
      || origin.origin !== item.request.origin
      || origin.pathname !== "/"
      || origin.search !== ""
      || origin.hash !== "") {
      throw new Error(`${field}.request.origin must be an exact HTTPS origin.`);
    }
    if (!item.request.pathname.startsWith("/")
      || item.request.pathname.includes("?")
      || item.request.pathname.includes("#")) {
      throw new Error(`${field}.request.pathname is invalid.`);
    }
    if (!isRecord(item.response)) throw new Error(`${field}.response must be an object.`);
    assertOnlyKeys(item.response, ["status", "headers", "body"], `${field}.response`);
    if (!Number.isInteger(item.response.status)
      || (item.response.status as number) < 100
      || (item.response.status as number) > 599) {
      throw new Error(`${field}.response.status is invalid.`);
    }
    if (typeof item.response.body !== "string") throw new Error(`${field}.response.body must be a string.`);
    if (typeof item.retrievedAt !== "string" || !isIsoDateTime(item.retrievedAt)) {
      throw new Error(`${field}.retrievedAt must be an ISO timestamp with timezone.`);
    }
    return {
      request: {
        origin: item.request.origin,
        pathname: item.request.pathname,
        query: parseStringRecord(item.request.query, `${field}.request.query`),
      },
      response: {
        status: item.response.status as number,
        headers: parseStringRecord(item.response.headers, `${field}.response.headers`),
        body: item.response.body,
      },
      retrievedAt: item.retrievedAt,
    };
  });
  const signatures = responses.map((item) => canonicalJson(item.request));
  if (new Set(signatures).size !== signatures.length) {
    throw new Error("Provider HTTP fixture contains duplicate request matches.");
  }
  return {
    schemaVersion: PROVIDER_HTTP_FIXTURE_SCHEMA_VERSION,
    providerId: value.providerId,
    responses,
  };
}

export async function loadProviderHttpFixture(path: string): Promise<ProviderHttpFixture> {
  return validateProviderHttpFixture(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export function createProviderHttpFixtureTransport(
  fixture: ProviderHttpFixture,
  credential: { value: string; transport: "header" | "query"; field: string },
): {
  fetch: typeof fetch;
  clock: () => string;
  assertConsumed: () => void;
} {
  const validated = validateProviderHttpFixture(fixture);
  if (credential.value.trim() === "") throw new Error("Fixture credential must be non-empty.");
  const consumed = new Set<number>();
  let currentRetrievedAt: string | undefined;
  const fixtureFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = input instanceof Request ? input.method : init?.method ?? "GET";
    if (method !== "GET") throw new Error("Provider fixture expected a GET request.");
    if (init?.redirect !== "error") throw new Error("Provider fixture requires redirect=error.");
    const query = Object.fromEntries(url.searchParams.entries());
    if (credential.transport === "header") {
      const headerValue = new Headers(input instanceof Request ? input.headers : init?.headers).get(credential.field);
      if (headerValue !== credential.value) throw new Error("Provider fixture did not receive the expected header credential.");
    } else {
      if (query[credential.field] !== credential.value) {
        throw new Error("Provider fixture did not receive the expected query credential.");
      }
      delete query[credential.field];
    }
    const request = { origin: url.origin, pathname: url.pathname, query };
    const signature = canonicalJson(request);
    const index = validated.responses.findIndex((item, candidateIndex) => (
      !consumed.has(candidateIndex) && canonicalJson(item.request) === signature
    ));
    if (index < 0) throw new Error(`Provider fixture has no response for ${url.origin}${url.pathname}.`);
    consumed.add(index);
    const matched = validated.responses[index]!;
    currentRetrievedAt = matched.retrievedAt;
    return new Response(matched.response.body, {
      status: matched.response.status,
      headers: matched.response.headers,
    });
  };
  return {
    fetch: fixtureFetch as typeof fetch,
    clock: () => {
      if (currentRetrievedAt === undefined) throw new Error("Provider fixture clock was read before a response matched.");
      return currentRetrievedAt;
    },
    assertConsumed: () => {
      if (consumed.size !== validated.responses.length) {
        throw new Error(`Provider fixture left ${validated.responses.length - consumed.size} response(s) unused.`);
      }
    },
  };
}
