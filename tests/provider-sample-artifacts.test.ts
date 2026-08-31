import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CapturedProviderResponseError,
  assertCapturedProviderHttpResponse,
  captureJsonResponse,
  parseCapturedJson,
  type CapturedProviderHttpResponse,
  type RedactedProviderRequest,
} from "../src/data/provider-http-capture.ts";
import {
  createProviderHttpFixtureTransport,
  validateProviderHttpFixture,
} from "../src/data/provider-http-fixture.ts";
import {
  assertCapturedDailyBarsArtifact,
  assertRawProviderResponseArtifact,
  buildCapturedDailyBarsArtifact,
  buildDailyBarComparableObservations,
  buildRawProviderResponseArtifact,
  type ProviderSampleArtifactMetadata,
} from "../src/data/provider-sample-artifacts.ts";
import { assertVersionedDataArtifact, buildVersionedDataArtifact } from "../src/data/provenance.ts";

const request: RedactedProviderRequest = {
  method: "GET",
  origin: "https://api.jquants.com",
  pathname: "/v2/equities/bars/daily",
  query: { code: "13080", from: "20250106", to: "20250108" },
  credential: {
    envVar: "JQUANTS_API_KEY",
    transport: "header",
    field: "x-api-key",
    retainedValue: "omitted",
  },
};

const metadata: ProviderSampleArtifactMetadata = {
  providerId: "jquants_v2",
  credentialEnvVar: "JQUANTS_API_KEY",
  source: "jquants-fixture",
  dataset: "jquants-v2-daily-bars",
  sourceVersion: "jquants-api-v2",
  adapterVersion: "jquants-v2-research-adapter-v2",
  stableId: "JPX:1308",
  providerSymbol: "1308",
  currency: "JPY",
  range: { start: "2025-01-06", end: "2025-01-08" },
};

const body = '{"data":[{"Date":"2025-01-06","Code":"13080","C":1000,"AdjFactor":1,"AdjC":1000}]}';

async function capture(bodyText = body): Promise<CapturedProviderHttpResponse> {
  const result = await captureJsonResponse(
    new Response(bodyText, {
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: "etag-1",
        "last-modified": "Wed, 08 Jan 2025 00:00:00 GMT",
        date: "Wed, 08 Jan 2025 00:00:01 GMT",
        "x-provider-secret": "must-not-be-retained",
      },
    }),
    {
      request,
      page: 1,
      retrievedAt: "2025-01-09T00:00:01Z",
      credentialValue: "secret-jquants-token",
      providerLabel: "J-Quants",
    },
  );
  assert.deepEqual(result.payload, JSON.parse(bodyText));
  return result.capture;
}

test("retains exact raw wire bytes and hash while applying response-header allowlist", async () => {
  const captureA = await capture(body);
  const captureB = await capture(`${body}\n`);
  const expectedHash = `sha256:${createHash("sha256").update(body).digest("hex")}`;

  assert.equal(captureA.response.bodyBase64, Buffer.from(body).toString("base64"));
  assert.equal(captureA.response.bodyHash, expectedHash);
  assert.equal(captureA.response.bodyHash === captureB.response.bodyHash, false);
  assert.deepEqual(captureA.response.headers, {
    "content-type": "application/json",
    etag: "etag-1",
    "last-modified": "Wed, 08 Jan 2025 00:00:00 GMT",
  });
  assert.equal(JSON.stringify(captureA).includes("must-not-be-retained"), false);
  assert.deepEqual(parseCapturedJson(captureA), JSON.parse(body));
  assert.equal(captureA.availabilityBasis, "retrieval_time_only_not_source_native");
  assert.equal(captureA.retrievedAt, "2025-01-09T00:00:01Z");
});

test("retains non-UTF-8 HTTP error bytes as captured failure evidence", async () => {
  const responseBytes = new Uint8Array([0xff, 0xfe, 0xfd]);
  const error = await captureJsonResponse(
    new Response(responseBytes, { status: 502, headers: { "content-type": "application/octet-stream" } }),
    {
      request,
      page: 1,
      retrievedAt: "2025-01-09T00:00:01Z",
      credentialValue: "secret-jquants-token",
      providerLabel: "J-Quants",
    },
  ).then(
    () => undefined,
    (caught: unknown) => caught,
  );

  assert.ok(error instanceof CapturedProviderResponseError);
  assert.equal(error.capture.response.status, 502);
  assert.equal(error.capture.response.bodyBase64, Buffer.from(responseBytes).toString("base64"));
  assert.equal(
    error.capture.response.bodyHash,
    `sha256:${createHash("sha256").update(responseBytes).digest("hex")}`,
  );
});

test("rejects non-canonical base64, incorrect hashes, and unsupported retained headers", async () => {
  const original = await capture();
  assert.throws(
    () => assertCapturedProviderHttpResponse({
      ...original,
      response: { ...original.response, bodyBase64: 1 as unknown as string },
    }),
    /bodyBase64 must be a string/,
  );
  assert.throws(
    () => assertCapturedProviderHttpResponse({
      ...original,
      response: { ...original.response, bodyBase64: `${original.response.bodyBase64}=` },
    }),
    /bodyBase64 is not canonical/,
  );
  assert.throws(
    () => assertCapturedProviderHttpResponse({
      ...original,
      response: { ...original.response, bodyHash: `sha256:${"0".repeat(64)}` },
    }),
    /bodyHash does not match/,
  );
  assert.throws(
    () => assertCapturedProviderHttpResponse({
      ...original,
      response: { ...original.response, headers: { ...original.response.headers, date: "not-retained" } },
    }),
    /unsupported response header: date/,
  );
});

test("fixture transport matches redacted requests and requires every fixture response to be consumed", async () => {
  const fixture = validateProviderHttpFixture({
    schemaVersion: "provider-http-fixture-v1",
    providerId: "eodhd_eod",
    responses: [{
      request: {
        origin: "https://eodhd.com",
        pathname: "/api/eod/1308.TSE",
        query: { from: "2025-01-06", to: "2025-01-08" },
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: "[]",
      },
      retrievedAt: "2025-01-09T00:00:01Z",
    }],
  });
  const transport = createProviderHttpFixtureTransport(fixture, {
    value: "fixture-eodhd-token",
    transport: "query",
    field: "api_token",
  });
  const response = await transport.fetch(
    "https://eodhd.com/api/eod/1308.TSE?from=2025-01-06&to=2025-01-08&api_token=fixture-eodhd-token",
    { redirect: "error" },
  );
  assert.equal(await response.text(), "[]");
  assert.equal(transport.clock(), "2025-01-09T00:00:01Z");
  transport.assertConsumed();
});

test("binds raw artifact request metadata and retrieval-time availability", async () => {
  const captured = await capture();
  const raw = buildRawProviderResponseArtifact(captured, metadata);
  assert.doesNotThrow(() => assertRawProviderResponseArtifact(raw));
  assert.equal(raw.provenance.requestHash.startsWith("sha256:"), true);
  assert.equal(raw.provenance.availableAt, "2025-01-09T00:00:01Z");
  assert.equal(raw.provenance.retrievedAt, "2025-01-09T00:00:01Z");

  const mismatchedRequestPayload = { ...raw.payload, request: { ...raw.payload.request, query: { code: "99990" } } };
  const requestMismatched = buildVersionedDataArtifact({
    artifactKind: "provider_raw_response",
    payload: mismatchedRequestPayload,
    source: raw.provenance.source,
    dataset: raw.provenance.dataset,
    sourceVersion: raw.provenance.sourceVersion,
    adapterVersion: raw.provenance.adapterVersion,
    observedAt: raw.provenance.observedAt,
    availableAt: raw.provenance.availableAt,
    retrievedAt: raw.provenance.retrievedAt,
    request: raw.payload.request,
    recordId: raw.provenance.recordId,
  });
  assert.throws(() => assertRawProviderResponseArtifact(requestMismatched), /requestHash does not match/);

  const otherInstrumentCapture = {
    ...captured,
    request: {
      ...captured.request,
      query: { ...captured.request.query, code: "99990" },
    },
  };
  assert.throws(
    () => buildRawProviderResponseArtifact(otherInstrumentCapture, metadata),
    /does not match provider symbol, range, page, or endpoint metadata/,
  );

  const internallyValidWrongRaw = buildVersionedDataArtifact({
    artifactKind: "provider_raw_response",
    payload: otherInstrumentCapture,
    source: metadata.source,
    dataset: `${metadata.dataset}:raw-http`,
    sourceVersion: metadata.sourceVersion,
    adapterVersion: metadata.adapterVersion,
    observedAt: "2025-01-08T00:00:00Z",
    availableAt: otherInstrumentCapture.retrievedAt,
    retrievedAt: otherInstrumentCapture.retrievedAt,
    request: otherInstrumentCapture.request,
    recordId: `${metadata.source}:${metadata.stableId}:${metadata.range.start}:${metadata.range.end}:page-${otherInstrumentCapture.page}`,
  });
  assert.throws(
    () => buildCapturedDailyBarsArtifact(
      [{ code: metadata.stableId, tradingDate: "2025-01-06", close: 1000, adjustedClose: 1000 }],
      [internallyValidWrongRaw],
      metadata,
    ),
    /does not match provider symbol, range, page, or endpoint metadata/,
  );
});

test("keeps raw-to-daily lineage, retrieval-time availability, and adjusted-close classification explicit", async () => {
  const raw = buildRawProviderResponseArtifact(await capture(), metadata);
  const daily = buildCapturedDailyBarsArtifact(
    [{ code: "JPX:1308", tradingDate: "2025-01-06", close: 1000, adjustedClose: 1000 }],
    [raw],
    metadata,
  );
  assert.doesNotThrow(() => assertCapturedDailyBarsArtifact(daily));
  assert.deepEqual(daily.payload.rawArtifactIds, [raw.provenance.artifactId]);
  assert.equal(daily.payload.returnClassification.adjustedClose, "provider_adjusted_not_total_return");
  assert.equal(daily.payload.availabilityBasis, "artifact_retrieved_at_not_source_native_row_availability");
  assert.equal(daily.provenance.availableAt, raw.provenance.availableAt);
  assert.equal(daily.provenance.retrievedAt, raw.provenance.retrievedAt);

  const wrongAdapterRaw = buildVersionedDataArtifact({
    artifactKind: "provider_raw_response",
    payload: raw.payload,
    source: raw.provenance.source,
    dataset: raw.provenance.dataset,
    sourceVersion: raw.provenance.sourceVersion,
    adapterVersion: "forged-adapter-version",
    observedAt: raw.provenance.observedAt,
    availableAt: raw.provenance.availableAt,
    retrievedAt: raw.provenance.retrievedAt,
    request: raw.payload.request,
    recordId: raw.provenance.recordId,
  });
  assert.throws(
    () => buildCapturedDailyBarsArtifact(daily.payload.bars, [wrongAdapterRaw], metadata),
    /raw lineage provenance does not match the provider contract/,
  );

  const observations = buildDailyBarComparableObservations(daily);
  assert.equal(observations.length, 2, "missing optional volume/tradingValue must not create synthetic observations");
  for (const observation of observations) {
    assert.equal(observation.parentArtifactId, daily.provenance.artifactId);
    assert.deepEqual(observation.parentProvenance, daily.provenance);
    assert.equal(observation.availableAt, daily.provenance.availableAt);
    assert.deepEqual(observation.artifact.payload.parentProvenance, daily.provenance);
  }
});

test("rejects normalized bars outside the declared sample range", async () => {
  const raw = buildRawProviderResponseArtifact(await capture(), metadata);
  assert.throws(
    () => buildCapturedDailyBarsArtifact(
      [{ code: "JPX:1308", tradingDate: "2025-01-05", close: 1000, adjustedClose: 1000 }],
      [raw],
      metadata,
    ),
  );
});

test("rejects a captured daily-bars artifact whose provenance predates a contained bar", async () => {
  const raw = buildRawProviderResponseArtifact(await capture(), metadata);
  const daily = buildCapturedDailyBarsArtifact(
    [{ code: "JPX:1308", tradingDate: "2025-01-06", close: 1000, adjustedClose: 1000 }],
    [raw],
    metadata,
  );
  const predating = buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload: daily.payload,
    source: daily.provenance.source,
    dataset: daily.provenance.dataset,
    sourceVersion: daily.provenance.sourceVersion,
    adapterVersion: daily.provenance.adapterVersion,
    observedAt: "2025-01-05T23:59:59Z",
    availableAt: daily.provenance.availableAt,
    retrievedAt: daily.provenance.retrievedAt,
    request: { stableId: metadata.stableId, range: metadata.range },
    recordId: daily.provenance.recordId,
  });
  assert.throws(
    () => assertCapturedDailyBarsArtifact(predating),
    /cannot predate a contained trading date/,
  );
});

test("rejects tampered daily artifact payload and tampered observation parent provenance", async () => {
  const raw = buildRawProviderResponseArtifact(await capture(), metadata);
  const daily = buildCapturedDailyBarsArtifact(
    [{ code: "JPX:1308", tradingDate: "2025-01-06", close: 1000, adjustedClose: 1000, volume: 10 }],
    [raw],
    metadata,
  );
  const tamperedDaily = {
    ...daily,
    payload: { ...daily.payload, bars: [{ ...daily.payload.bars[0]!, close: 999 }] },
  };
  assert.throws(() => assertCapturedDailyBarsArtifact(tamperedDaily), /contentHash/);

  const observation = buildDailyBarComparableObservations(daily)[0]!;
  const tamperedObservation = {
    ...observation,
    parentProvenance: { ...observation.parentProvenance, availableAt: "2025-01-08T00:00:00Z" },
    artifact: {
      ...observation.artifact,
      payload: {
        ...observation.artifact.payload,
        parentProvenance: { ...observation.parentProvenance, availableAt: "2025-01-08T00:00:00Z" },
      },
    },
  };
  assert.throws(() => assertVersionedDataArtifact(tamperedObservation.artifact), /contentHash/);
});
