import { createHash } from "node:crypto";
import { canonicalJson, isIsoDateTime } from "./provenance.ts";

export const PROVIDER_HTTP_CAPTURE_SCHEMA_VERSION = "provider-http-capture-v1" as const;

export interface RedactedProviderRequest {
  method: "GET";
  origin: string;
  pathname: string;
  query: Readonly<Record<string, string>>;
  credential: {
    envVar: string;
    transport: "header" | "query";
    field: string;
    retainedValue: "omitted";
  };
}

export interface CapturedProviderHttpResponse {
  schemaVersion: typeof PROVIDER_HTTP_CAPTURE_SCHEMA_VERSION;
  page: number;
  request: RedactedProviderRequest;
  response: {
    status: number;
    headers: Readonly<Record<string, string>>;
    bodyEncoding: "base64";
    bodyBase64: string;
    bodyHash: string;
  };
  retrievedAt: string;
  availabilityBasis: "retrieval_time_only_not_source_native";
}

const RETAINED_RESPONSE_HEADERS = [
  "content-type",
  "etag",
  "last-modified",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
] as const;

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be non-empty.`);
}

export function assertRedactedProviderRequest(request: RedactedProviderRequest): void {
  if (request.method !== "GET") throw new Error("Provider capture request method must be GET.");
  let origin: URL;
  try {
    origin = new URL(request.origin);
  } catch {
    throw new Error("Provider capture request origin must be an absolute URL origin.");
  }
  if (
    origin.protocol !== "https:"
    || origin.origin !== request.origin
    || origin.pathname !== "/"
    || origin.search !== ""
    || origin.hash !== ""
    || origin.username !== ""
    || origin.password !== ""
  ) {
    throw new Error("Provider capture request origin must be an exact HTTPS origin.");
  }
  if (!request.pathname.startsWith("/") || request.pathname.includes("?") || request.pathname.includes("#")) {
    throw new Error("Provider capture request pathname must be an absolute path without query or fragment data.");
  }
  if (request.query === null || typeof request.query !== "object" || Array.isArray(request.query)) {
    throw new Error("Provider capture request query must be an object.");
  }
  for (const [key, value] of Object.entries(request.query)) {
    assertNonEmpty(key, "Provider capture query key");
    if (typeof value !== "string") throw new Error(`Provider capture query ${key} must be a string.`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(request.credential.envVar)) {
    throw new Error("Provider capture credential envVar must be an uppercase environment-variable name.");
  }
  if (request.credential.transport !== "header" && request.credential.transport !== "query") {
    throw new Error("Provider capture credential transport must be header or query.");
  }
  assertNonEmpty(request.credential.field, "Provider capture credential field");
  if (request.credential.retainedValue !== "omitted") {
    throw new Error("Provider capture credentials must be omitted from retained metadata.");
  }
  if (Object.keys(request.query).some((key) => key.toLowerCase() === request.credential.field.toLowerCase())) {
    throw new Error("Provider capture query must omit the credential field entirely.");
  }
}

export function assertCapturedProviderHttpResponse(capture: CapturedProviderHttpResponse): void {
  if (capture.schemaVersion !== PROVIDER_HTTP_CAPTURE_SCHEMA_VERSION) {
    throw new Error(`Unsupported provider capture schemaVersion: ${String(capture.schemaVersion)}.`);
  }
  if (!Number.isInteger(capture.page) || capture.page < 1) {
    throw new Error("Provider capture page must be a positive integer.");
  }
  assertRedactedProviderRequest(capture.request);
  if (!Number.isInteger(capture.response.status) || capture.response.status < 100 || capture.response.status > 599) {
    throw new Error("Provider capture response status must be a valid HTTP status.");
  }
  if (capture.response.bodyEncoding !== "base64") {
    throw new Error("Provider capture response bodyEncoding must be base64.");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(capture.response.bodyHash)) {
    throw new Error("Provider capture response bodyHash must be a canonical SHA-256 identifier.");
  }
  if (typeof capture.response.bodyBase64 !== "string") {
    throw new Error("Provider capture response bodyBase64 must be a string.");
  }
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(capture.response.bodyBase64, "base64");
  } catch {
    throw new Error("Provider capture response bodyBase64 is invalid.");
  }
  if (Buffer.from(bytes).toString("base64") !== capture.response.bodyBase64) {
    throw new Error("Provider capture response bodyBase64 is not canonical.");
  }
  if (sha256Bytes(bytes) !== capture.response.bodyHash) {
    throw new Error("Provider capture response bodyHash does not match the retained bytes.");
  }
  if (capture.response.headers === null
    || typeof capture.response.headers !== "object"
    || Array.isArray(capture.response.headers)) {
    throw new Error("Provider capture response headers must be an object.");
  }
  for (const [name, value] of Object.entries(capture.response.headers)) {
    if (!RETAINED_RESPONSE_HEADERS.includes(name as typeof RETAINED_RESPONSE_HEADERS[number])) {
      throw new Error(`Provider capture retained an unsupported response header: ${name}.`);
    }
    if (typeof value !== "string") throw new Error(`Provider capture response header ${name} must be a string.`);
  }
  if (!isIsoDateTime(capture.retrievedAt)) {
    throw new Error("Provider capture retrievedAt must be an ISO timestamp with timezone.");
  }
  if (capture.availabilityBasis !== "retrieval_time_only_not_source_native") {
    throw new Error("Provider capture must label retrieval-time-only availability explicitly.");
  }
}

function retainedHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of RETAINED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) output[name] = value;
  }
  return output;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Provider returned a response that is not valid UTF-8 JSON.");
  }
}

export class CapturedProviderResponseError extends Error {
  readonly capture: CapturedProviderHttpResponse;

  constructor(message: string, capture: CapturedProviderHttpResponse, options?: ErrorOptions) {
    super(message, options);
    this.name = "CapturedProviderResponseError";
    this.capture = capture;
  }
}

export async function captureJsonResponse(
  response: Response,
  input: {
    request: RedactedProviderRequest;
    page: number;
    retrievedAt: string;
    credentialValue: string;
    providerLabel: string;
  },
): Promise<{ capture: CapturedProviderHttpResponse; payload: unknown }> {
  assertRedactedProviderRequest(input.request);
  if (!isIsoDateTime(input.retrievedAt)) {
    throw new Error("Provider capture clock must return an ISO timestamp with timezone.");
  }
  assertNonEmpty(input.credentialValue, "Provider credential");
  assertNonEmpty(input.providerLabel, "Provider label");

  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = decodeUtf8(bytes);
  const capture: CapturedProviderHttpResponse = {
    schemaVersion: PROVIDER_HTTP_CAPTURE_SCHEMA_VERSION,
    page: input.page,
    request: input.request,
    response: {
      status: response.status,
      headers: retainedHeaders(response.headers),
      bodyEncoding: "base64",
      bodyBase64: Buffer.from(bytes).toString("base64"),
      bodyHash: sha256Bytes(bytes),
    },
    retrievedAt: input.retrievedAt,
    availabilityBasis: "retrieval_time_only_not_source_native",
  };
  assertCapturedProviderHttpResponse(capture);
  // Provider credentials are long tokens in live mode. Tiny values are used by
  // unit tests and can collide with ordinary JSON field names such as
  // `pagination_key`, so raw substring scanning begins at eight characters.
  const shouldScanCredential = input.credentialValue.length >= 8;
  if (shouldScanCredential && (text.includes(input.credentialValue)
    || Object.values(capture.request.query).some((value) => value.includes(input.credentialValue))
    || Object.values(capture.response.headers).some((value) => value.includes(input.credentialValue)))) {
    throw new Error(`${input.providerLabel} response or retained metadata echoed a credential; refusing to retain it.`);
  }
  if (!response.ok) {
    throw new CapturedProviderResponseError(
      `${input.providerLabel} request failed: HTTP ${response.status}.`,
      capture,
    );
  }
  try {
    return { capture, payload: JSON.parse(text) as unknown };
  } catch (error) {
    throw new CapturedProviderResponseError(`${input.providerLabel} returned malformed JSON.`, capture, { cause: error });
  }
}

export function parseCapturedJson(capture: CapturedProviderHttpResponse): unknown {
  assertCapturedProviderHttpResponse(capture);
  const bytes = Buffer.from(capture.response.bodyBase64, "base64");
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch (error) {
    throw new CapturedProviderResponseError("Retained provider response contains malformed JSON.", capture, { cause: error });
  }
}
