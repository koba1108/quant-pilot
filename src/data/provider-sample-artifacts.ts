import type { DailyBar } from "./models.ts";
import { assertDailyBars } from "./provider.ts";
import {
  assertVersionedDataArtifact,
  buildVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type VersionedDataArtifact,
} from "./provenance.ts";
import {
  assertCapturedProviderHttpResponse,
  type CapturedProviderHttpResponse,
} from "./provider-http-capture.ts";
import type {
  ComparableObservation,
  ComparableObservationEvidence,
  ComparableObservationKey,
} from "./reconciliation.ts";

export const CAPTURED_DAILY_BARS_SCHEMA_VERSION = "captured-daily-bars-v1" as const;

export interface CapturedDailyBarsPayload {
  schemaVersion: typeof CAPTURED_DAILY_BARS_SCHEMA_VERSION;
  providerId: "jquants_v2" | "eodhd_eod";
  stableId: string;
  providerSymbol: string;
  currency: "JPY";
  returnClassification: {
    close: "unadjusted_price";
    adjustedClose: "provider_adjusted_not_total_return";
  };
  availabilityBasis: "artifact_retrieved_at_not_source_native_row_availability";
  rawArtifactIds: readonly string[];
  bars: readonly DailyBar[];
}

export interface ProviderSampleArtifactMetadata {
  providerId: "jquants_v2" | "eodhd_eod";
  credentialEnvVar: string;
  source: string;
  dataset: string;
  sourceVersion: string;
  adapterVersion: string;
  stableId: string;
  providerSymbol: string;
  currency: "JPY";
  range: { start: string; end: string };
}

export function assertRawProviderResponseArtifact(
  artifact: VersionedDataArtifact<CapturedProviderHttpResponse>,
): void {
  assertVersionedDataArtifact(artifact);
  if (artifact.provenance.artifactKind !== "provider_raw_response") {
    throw new Error("Raw provider response artifact must use artifactKind=provider_raw_response.");
  }
  assertCapturedProviderHttpResponse(artifact.payload);
  if (artifact.provenance.availableAt !== artifact.payload.retrievedAt
    || artifact.provenance.retrievedAt !== artifact.payload.retrievedAt) {
    throw new Error("Raw provider response provenance must bind availability and retrieval to the captured response.");
  }
  if (artifact.provenance.requestHash !== sha256Canonical(artifact.payload.request)) {
    throw new Error("Raw provider response requestHash does not match its redacted request metadata.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function assertMetadataRange(metadata: ProviderSampleArtifactMetadata): void {
  if (!isIsoDate(metadata.range.start) || !isIsoDate(metadata.range.end) || metadata.range.start > metadata.range.end) {
    throw new Error("Provider sample artifact metadata must contain a valid ISO date range.");
  }
}

function expectedJquantsSymbol(value: string): string {
  if (/^\d{4}$/.test(value)) return `${value}0`;
  if (/^[0-9A-Z]{5}$/.test(value)) return value;
  throw new Error("J-Quants providerSymbol is invalid for artifact lineage.");
}

function assertRawRequestMatchesMetadata(
  capture: CapturedProviderHttpResponse,
  metadata: ProviderSampleArtifactMetadata,
): void {
  const request = capture.request;
  if (request.credential.envVar !== metadata.credentialEnvVar) {
    throw new Error("Raw provider request credential environment does not match sample metadata.");
  }
  if (metadata.providerId === "jquants_v2") {
    const expectedQuery = {
      code: expectedJquantsSymbol(metadata.providerSymbol.toUpperCase()),
      from: metadata.range.start.replaceAll("-", ""),
      to: metadata.range.end.replaceAll("-", ""),
    };
    const { pagination_key: paginationKey, ...baseQuery } = request.query;
    if (request.origin !== "https://api.jquants.com"
      || request.pathname !== "/v2/equities/bars/daily"
      || request.credential.transport !== "header"
      || request.credential.field.toLowerCase() !== "x-api-key"
      || canonicalJson(baseQuery) !== canonicalJson(expectedQuery)
      || (capture.page === 1 && paginationKey !== undefined)
      || (capture.page > 1 && (typeof paginationKey !== "string" || paginationKey === ""))) {
      throw new Error("Raw J-Quants request does not match provider symbol, range, page, or endpoint metadata.");
    }
  } else {
    const expectedQuery = {
      from: metadata.range.start,
      to: metadata.range.end,
      period: "d",
      order: "a",
      fmt: "json",
    };
    if (request.origin !== "https://eodhd.com"
      || request.pathname !== `/api/eod/${encodeURIComponent(metadata.providerSymbol.toUpperCase())}`
      || request.credential.transport !== "query"
      || request.credential.field !== "api_token"
      || capture.page !== 1
      || canonicalJson(request.query) !== canonicalJson(expectedQuery)) {
      throw new Error("Raw EODHD request does not match provider symbol, range, page, or endpoint metadata.");
    }
  }
}

export function assertCapturedDailyBarsArtifact(
  artifact: VersionedDataArtifact<CapturedDailyBarsPayload>,
): void {
  assertVersionedDataArtifact(artifact);
  if (artifact.provenance.artifactKind !== "daily_bars") {
    throw new Error("Captured daily-bars artifact must use artifactKind=daily_bars.");
  }
  const payload: unknown = artifact.payload;
  if (!isRecord(payload) || payload.schemaVersion !== CAPTURED_DAILY_BARS_SCHEMA_VERSION) {
    throw new Error("Captured daily-bars artifact has an unsupported payload schema.");
  }
  if (typeof payload.stableId !== "string" || payload.stableId.trim() === "") {
    throw new Error("Captured daily-bars stableId must be non-empty.");
  }
  if (payload.providerId !== "jquants_v2" && payload.providerId !== "eodhd_eod") {
    throw new Error("Captured daily-bars providerId is unsupported.");
  }
  if (typeof payload.providerSymbol !== "string" || payload.providerSymbol.trim() === "") {
    throw new Error("Captured daily-bars providerSymbol must be non-empty.");
  }
  if (payload.currency !== "JPY") throw new Error("Captured JPX daily bars must use currency=JPY.");
  if (!isRecord(payload.returnClassification)
    || payload.returnClassification.close !== "unadjusted_price"
    || payload.returnClassification.adjustedClose !== "provider_adjusted_not_total_return") {
    throw new Error("Captured daily-bars return classifications are invalid.");
  }
  if (payload.availabilityBasis !== "artifact_retrieved_at_not_source_native_row_availability") {
    throw new Error("Captured daily-bars availability basis must remain explicitly retrieval-time-only.");
  }
  if (!Array.isArray(payload.rawArtifactIds) || payload.rawArtifactIds.length === 0
    || payload.rawArtifactIds.some((id) => typeof id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(id))) {
    throw new Error("Captured daily-bars rawArtifactIds must contain canonical artifact identifiers.");
  }
  const rawArtifactIds = payload.rawArtifactIds as string[];
  const sortedIds = [...rawArtifactIds].sort();
  if (new Set(sortedIds).size !== sortedIds.length || sortedIds.some((id, index) => id !== rawArtifactIds[index])) {
    throw new Error("Captured daily-bars rawArtifactIds must be unique and sorted.");
  }
  if (!Array.isArray(payload.bars)) throw new Error("Captured daily-bars bars must be an array.");
  const bars = assertDailyBars(payload.bars as DailyBar[], payload.stableId);
  const lastTradingDate = bars.at(-1)!.tradingDate;
  const lastTradingDateStart = Date.parse(`${lastTradingDate}T00:00:00Z`);
  if (Date.parse(artifact.provenance.observedAt) < lastTradingDateStart
    || Date.parse(artifact.provenance.availableAt) < lastTradingDateStart) {
    throw new Error("Captured daily-bars artifact cannot predate a contained trading date.");
  }
}

function observedAtForDate(date: string): string {
  return `${date}T00:00:00Z`;
}

export function buildRawProviderResponseArtifact(
  capture: CapturedProviderHttpResponse,
  metadata: ProviderSampleArtifactMetadata,
): VersionedDataArtifact<CapturedProviderHttpResponse> {
  assertMetadataRange(metadata);
  assertCapturedProviderHttpResponse(capture);
  assertRawRequestMatchesMetadata(capture, metadata);
  const artifact = buildVersionedDataArtifact({
    artifactKind: "provider_raw_response",
    payload: capture,
    source: metadata.source,
    dataset: `${metadata.dataset}:raw-http`,
    sourceVersion: metadata.sourceVersion,
    adapterVersion: metadata.adapterVersion,
    observedAt: observedAtForDate(metadata.range.end),
    availableAt: capture.retrievedAt,
    retrievedAt: capture.retrievedAt,
    request: capture.request,
    recordId: `${metadata.source}:${metadata.stableId}:${metadata.range.start}:${metadata.range.end}:page-${capture.page}`,
  });
  assertRawProviderResponseArtifact(artifact);
  return artifact;
}

export function buildCapturedDailyBarsArtifact(
  bars: readonly DailyBar[],
  rawArtifacts: readonly VersionedDataArtifact<CapturedProviderHttpResponse>[],
  metadata: ProviderSampleArtifactMetadata,
): VersionedDataArtifact<CapturedDailyBarsPayload> {
  assertMetadataRange(metadata);
  if (bars.length === 0) throw new Error(`Cannot build a captured daily-bars artifact without bars for ${metadata.stableId}.`);
  if (rawArtifacts.length === 0) throw new Error(`Cannot build a captured daily-bars artifact without raw lineage for ${metadata.stableId}.`);
  for (const artifact of rawArtifacts) {
    assertRawProviderResponseArtifact(artifact);
    if (artifact.provenance.source !== metadata.source) {
      throw new Error("Captured daily-bars lineage source does not match the normalized source.");
    }
    const expectedRawRecordId = `${metadata.source}:${metadata.stableId}:${metadata.range.start}:${metadata.range.end}:page-${artifact.payload.page}`;
    if (artifact.provenance.dataset !== `${metadata.dataset}:raw-http`
      || artifact.provenance.sourceVersion !== metadata.sourceVersion
      || artifact.provenance.adapterVersion !== metadata.adapterVersion
      || artifact.provenance.observedAt !== observedAtForDate(metadata.range.end)
      || artifact.provenance.recordId !== expectedRawRecordId) {
      throw new Error("Captured daily-bars raw lineage provenance does not match the provider contract.");
    }
    assertRawRequestMatchesMetadata(artifact.payload, metadata);
    if (artifact.payload.response.status < 200 || artifact.payload.response.status > 299) {
      throw new Error("Normalized daily bars cannot descend from a non-success provider response.");
    }
  }
  const pages = rawArtifacts.map((artifact) => artifact.payload.page).sort((left, right) => left - right);
  if (new Set(pages).size !== pages.length || pages.some((page, index) => page !== index + 1)) {
    throw new Error("Captured daily-bars raw lineage must contain each response page exactly once.");
  }
  const sortedBars = [...bars].sort((left, right) => left.tradingDate.localeCompare(right.tradingDate));
  if (sortedBars.some((bar) => bar.code !== metadata.stableId)) {
    throw new Error(`Captured daily-bars code does not match stableId ${metadata.stableId}.`);
  }
  const outsideRange = sortedBars.find((bar) => (
    bar.tradingDate < metadata.range.start || bar.tradingDate > metadata.range.end
  ));
  if (outsideRange !== undefined) {
    throw new Error(
      `Captured daily bar ${outsideRange.tradingDate} is outside declared range ${metadata.range.start}..${metadata.range.end}.`,
    );
  }
  const availableAt = rawArtifacts
    .map((artifact) => artifact.provenance.retrievedAt)
    .sort()
    .at(-1)!;
  const rawArtifactIds = rawArtifacts.map((artifact) => artifact.provenance.artifactId).sort();
  const payload: CapturedDailyBarsPayload = {
    schemaVersion: CAPTURED_DAILY_BARS_SCHEMA_VERSION,
    providerId: metadata.providerId,
    stableId: metadata.stableId,
    providerSymbol: metadata.providerSymbol,
    currency: metadata.currency,
    returnClassification: {
      close: "unadjusted_price",
      adjustedClose: "provider_adjusted_not_total_return",
    },
    availabilityBasis: "artifact_retrieved_at_not_source_native_row_availability",
    rawArtifactIds,
    bars: sortedBars,
  };
  const artifact = buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload,
    source: metadata.source,
    dataset: metadata.dataset,
    sourceVersion: metadata.sourceVersion,
    adapterVersion: metadata.adapterVersion,
    observedAt: observedAtForDate(sortedBars.at(-1)!.tradingDate),
    availableAt,
    retrievedAt: availableAt,
    request: {
      stableId: metadata.stableId,
      providerSymbol: metadata.providerSymbol,
      range: metadata.range,
      rawArtifactIds,
    },
    recordId: `${metadata.source}:${metadata.stableId}:${metadata.range.start}:${metadata.range.end}`,
  });
  assertCapturedDailyBarsArtifact(artifact);
  return artifact;
}

function comparableValues(bar: DailyBar, currency: "JPY"): readonly { key: ComparableObservationKey; value: number }[] {
  const values: { key: ComparableObservationKey; value: number }[] = [
    {
      key: {
        code: bar.code,
        date: bar.tradingDate,
        field: "close",
        basis: "unadjusted_price",
        currency,
      },
      value: bar.close,
    },
    {
      key: {
        code: bar.code,
        date: bar.tradingDate,
        field: "adjustedClose",
        basis: "provider_adjusted_not_total_return",
        currency,
      },
      value: bar.adjustedClose,
    },
  ];
  if (bar.volume !== undefined) {
    values.push({
      key: { code: bar.code, date: bar.tradingDate, field: "volume", unit: "provider_reported_volume_units" },
      value: bar.volume,
    });
  }
  if (bar.tradingValue !== undefined) {
    values.push({
      key: { code: bar.code, date: bar.tradingDate, field: "tradingValue", currency },
      value: bar.tradingValue,
    });
  }
  return values;
}

export function buildDailyBarComparableObservations(
  parentArtifact: VersionedDataArtifact<CapturedDailyBarsPayload>,
): ComparableObservation[] {
  assertCapturedDailyBarsArtifact(parentArtifact);
  const observations: ComparableObservation[] = [];
  for (const bar of parentArtifact.payload.bars) {
    for (const item of comparableValues(bar, parentArtifact.payload.currency)) {
      const recordId = `${parentArtifact.provenance.source}:${bar.code}:${bar.tradingDate}:${item.key.field}`;
      const evidence: ComparableObservationEvidence = {
        key: item.key,
        value: item.value,
        source: parentArtifact.provenance.source,
        availableAt: parentArtifact.provenance.availableAt,
        recordId,
        parentArtifactId: parentArtifact.provenance.artifactId,
        parentProvenance: parentArtifact.provenance,
      };
      const artifact = buildVersionedDataArtifact({
        artifactKind: "reconciliation_observation",
        payload: evidence,
        source: parentArtifact.provenance.source,
        dataset: `${parentArtifact.provenance.dataset}:reconciliation`,
        sourceVersion: parentArtifact.provenance.sourceVersion,
        adapterVersion: parentArtifact.provenance.adapterVersion,
        observedAt: observedAtForDate(bar.tradingDate),
        availableAt: parentArtifact.provenance.availableAt,
        retrievedAt: parentArtifact.provenance.retrievedAt,
        request: {
          parentArtifactId: parentArtifact.provenance.artifactId,
          key: item.key,
        },
        recordId,
      });
      observations.push({ ...evidence, artifact });
    }
  }
  return observations;
}
