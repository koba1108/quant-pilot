import type { DailyBar } from "./models.ts";
import {
  isIsoDateTime,
  sha256Canonical,
} from "./provenance.ts";
import {
  APPROVED_RESEARCH_TOTAL_RETURN_POLICY,
  APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID,
  normalizeReturnSeries,
  normalizedReturnSeriesToDailyBars,
  type DataProvenance,
  type NormalizedReturnBasis,
  type ReturnEvent,
  type ReturnEventCoverage,
  type TotalReturnPolicy,
} from "./return-normalization.ts";
import {
  buildPointInTimeFxRateBook,
  convertNormalizedReturnSeriesToJpy,
  jpyNormalizedReturnSeriesToDailyBars,
  FX_NORMALIZATION_VERSION,
  POINT_IN_TIME_JPY_FX_CONTRACT_ID,
  type FxRateCoverage,
  type FxRateObservation,
} from "./fx-normalization.ts";

export const POINT_IN_TIME_RETURN_SOURCE_VERSION = "point-in-time-return-source-v1" as const;

export interface PointInTimeBarObservation extends DailyBar {
  observationId: string;
  supersedesObservationId?: string;
  observedAt: string;
  availableAt: string;
  provenance: DataProvenance;
}

export interface PointInTimeReturnAsset {
  code: string;
  currency: string;
  basis: NormalizedReturnBasis;
  barObservations: readonly PointInTimeBarObservation[];
  events: readonly ReturnEvent[];
  coverage: ReturnEventCoverage;
  totalReturnPolicyId?: string;
  totalReturnPolicy?: TotalReturnPolicy;
  fxObservations?: readonly FxRateObservation[];
  fxCoverage?: FxRateCoverage;
}

export interface PointInTimeReturnResolution {
  sourceVersion: typeof POINT_IN_TIME_RETURN_SOURCE_VERSION;
  code: string;
  sourceCurrency: string;
  currency: "JPY";
  basis: NormalizedReturnBasis;
  decisionDate: string;
  bars: DailyBar[];
  appliedBarObservationIds: readonly string[];
  appliedEventIds: readonly string[];
  appliedFxObservationIds: readonly string[];
  normalization: {
    returnNormalizationVersion: string;
    totalReturnPolicyId?: string;
    fxNormalizationVersion?: typeof FX_NORMALIZATION_VERSION;
    fxContractId?: typeof POINT_IN_TIME_JPY_FX_CONTRACT_ID;
  };
  diagnostics: {
    inputBarObservations: number;
    selectedBarObservations: number;
    futureBarObservationsExcluded: number;
    revisedBarDatesUsed: number;
  };
  inputFingerprint: string;
  pinnedPrefixFingerprint?: string;
  fingerprint: string;
}

interface SelectedBars {
  bars: DailyBar[];
  observationIds: string[];
  futureExcluded: number;
  revisedDatesUsed: number;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function cutoff(decisionDate: string): number {
  if (!isIsoDate(decisionDate)) throw new Error(`decisionDate must be an ISO date; received ${decisionDate}.`);
  return Date.parse(`${decisionDate}T23:59:59.999Z`);
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be non-empty.`);
}

function assertCurrency(value: unknown, field: string): asserts value is string {
  assertNonEmpty(value, field);
  if (!/^[A-Z]{3}$/.test(value)) throw new Error(`${field} must be an ISO-style three-letter uppercase currency code.`);
}

function assertProvenance(provenance: DataProvenance, field: string): void {
  assertNonEmpty(provenance.source, `${field}.source`);
  assertNonEmpty(provenance.dataset, `${field}.dataset`);
  if (!isIsoDateTime(provenance.retrievedAt)) {
    throw new Error(`${field}.retrievedAt must be an ISO timestamp with timezone.`);
  }
  for (const optionalField of ["sourceVersion", "recordId"] as const) {
    const value = provenance[optionalField];
    if (value !== undefined) assertNonEmpty(value, `${field}.${optionalField}`);
  }
}

function assertBarObservation(observation: PointInTimeBarObservation, code: string): void {
  assertNonEmpty(observation.observationId, "bar observationId");
  if (observation.code !== code) throw new Error(`Unexpected bar code ${observation.code}; expected ${code}.`);
  if (!isIsoDate(observation.tradingDate)) throw new Error(`Invalid bar tradingDate for ${observation.observationId}.`);
  if (!Number.isFinite(observation.close) || observation.close <= 0) {
    throw new Error(`Invalid close for bar observation ${observation.observationId}.`);
  }
  if (!Number.isFinite(observation.adjustedClose) || observation.adjustedClose <= 0) {
    throw new Error(`Invalid adjustedClose for bar observation ${observation.observationId}.`);
  }
  for (const [field, value] of [["volume", observation.volume], ["tradingValue", observation.tradingValue]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Invalid ${field} for bar observation ${observation.observationId}.`);
    }
  }
  if (!isIsoDateTime(observation.observedAt) || !isIsoDateTime(observation.availableAt)) {
    throw new Error(`Bar observation ${observation.observationId} observedAt/availableAt must be ISO timestamps with timezone.`);
  }
  if (Date.parse(observation.observedAt) > Date.parse(observation.availableAt)) {
    throw new Error(`Bar observation ${observation.observationId} cannot be available before it was observed.`);
  }
  if (observation.supersedesObservationId !== undefined) {
    assertNonEmpty(observation.supersedesObservationId, `bar observation ${observation.observationId}.supersedesObservationId`);
    if (observation.supersedesObservationId === observation.observationId) {
      throw new Error(`Bar observation ${observation.observationId} cannot supersede itself.`);
    }
  }
  assertProvenance(observation.provenance, `Bar observation ${observation.observationId} provenance`);
}

function validateBarRevisionChains(
  observations: readonly PointInTimeBarObservation[],
  code: string,
): Map<string, PointInTimeBarObservation[]> {
  const byDate = new Map<string, PointInTimeBarObservation[]>();
  const ids = new Set<string>();
  for (const observation of observations) {
    assertBarObservation(observation, code);
    if (ids.has(observation.observationId)) throw new Error(`Duplicate bar observation id: ${observation.observationId}.`);
    ids.add(observation.observationId);
    const sameDate = byDate.get(observation.tradingDate) ?? [];
    sameDate.push(observation);
    byDate.set(observation.tradingDate, sameDate);
  }

  for (const [tradingDate, sameDate] of byDate) {
    const ordered = [...sameDate].sort(
      (left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt)
        || left.observationId.localeCompare(right.observationId),
    );
    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index]!;
      const previous = ordered[index - 1];
      if (previous && Date.parse(current.availableAt) === Date.parse(previous.availableAt)) {
        throw new Error(`Bar revisions for ${tradingDate} must have distinct availability timestamps.`);
      }
      if (previous === undefined && current.supersedesObservationId !== undefined) {
        throw new Error(`Initial bar observation ${current.observationId} cannot supersede another observation.`);
      }
      if (previous !== undefined && current.supersedesObservationId !== previous.observationId) {
        throw new Error(`Bar revision ${current.observationId} must explicitly supersede ${previous.observationId}.`);
      }
    }
    byDate.set(tradingDate, ordered);
  }
  return byDate;
}

function selectBarsAsOf(
  byDate: Map<string, PointInTimeBarObservation[]>,
  decisionDate: string,
  pinnedPrefix?: PointInTimeReturnResolution,
): SelectedBars {
  const decisionCutoff = cutoff(decisionDate);
  const pinnedObservationByDate = pinnedPrefix === undefined
    ? undefined
    : new Map(pinnedPrefix.bars.map((bar, index) => [
      bar.tradingDate,
      pinnedPrefix.appliedBarObservationIds[index]!,
    ]));
  const bars: DailyBar[] = [];
  const observationIds: string[] = [];
  let futureExcluded = 0;
  let revisedDatesUsed = 0;
  for (const [tradingDate, observations] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (tradingDate > decisionDate) {
      futureExcluded += observations.length;
      continue;
    }
    const available = observations.filter((observation) => Date.parse(observation.availableAt) <= decisionCutoff);
    if (available.length === 0) {
      throw new Error(`Bar observation for ${tradingDate} was not available by decisionDate ${decisionDate}.`);
    }
    const pinnedObservationId = tradingDate <= (pinnedPrefix?.decisionDate ?? "")
      ? pinnedObservationByDate?.get(tradingDate)
      : undefined;
    if (pinnedPrefix !== undefined
      && tradingDate <= pinnedPrefix.decisionDate
      && pinnedObservationId === undefined) {
      throw new Error(
        `Pinned Point-in-Time prefix for ${pinnedPrefix.code} has no bar observation for ${tradingDate}.`,
      );
    }
    const selected = pinnedObservationId === undefined
      ? available.at(-1)!
      : available.find((observation) => observation.observationId === pinnedObservationId);
    if (selected === undefined) {
      throw new Error(
        `Pinned bar observation ${pinnedObservationId} for ${tradingDate} is unavailable in the forward snapshot.`,
      );
    }
    bars.push({
      code: selected.code,
      tradingDate: selected.tradingDate,
      close: selected.close,
      adjustedClose: selected.adjustedClose,
      volume: selected.volume,
      tradingValue: selected.tradingValue,
    });
    observationIds.push(selected.observationId);
    if (selected.supersedesObservationId !== undefined) revisedDatesUsed += 1;
  }
  if (bars.length === 0) throw new Error(`No bar observations are available on or before ${decisionDate}.`);
  return { bars, observationIds, futureExcluded, revisedDatesUsed };
}

function assertPinnedPrefix(
  asset: PointInTimeReturnAsset,
  decisionDate: string,
  pinnedPrefix: PointInTimeReturnResolution,
): void {
  assertPointInTimeReturnResolutionIntegrity(pinnedPrefix);
  if (pinnedPrefix.code !== asset.code
    || pinnedPrefix.sourceCurrency !== asset.currency
    || pinnedPrefix.basis !== asset.basis) {
    throw new Error(`Pinned Point-in-Time prefix does not match return source asset ${asset.code}.`);
  }
  if (pinnedPrefix.currency !== "JPY") {
    throw new Error(`Pinned Point-in-Time prefix for ${asset.code} is not JPY-normalized.`);
  }
  if (pinnedPrefix.decisionDate >= decisionDate) {
    throw new Error(
      `Pinned Point-in-Time prefix date ${pinnedPrefix.decisionDate} must precede forward decisionDate ${decisionDate}.`,
    );
  }
  if (pinnedPrefix.inputFingerprint !== pointInTimeReturnAssetFingerprint(asset)) {
    throw new Error(`Pinned Point-in-Time prefix input fingerprint does not match ${asset.code}.`);
  }
  if (pinnedPrefix.appliedBarObservationIds.length !== pinnedPrefix.bars.length) {
    throw new Error(`Pinned Point-in-Time prefix bar observations are not aligned for ${asset.code}.`);
  }
  if (asset.currency !== "JPY"
    && pinnedPrefix.appliedFxObservationIds.length !== pinnedPrefix.bars.length) {
    throw new Error(`Pinned Point-in-Time prefix FX observations are not aligned for ${asset.code}.`);
  }
}

function fxObservationsWithPinnedPrefix(
  asset: PointInTimeReturnAsset,
  pinnedPrefix: PointInTimeReturnResolution | undefined,
): FxRateObservation[] {
  const observations = [...asset.fxObservations!];
  if (pinnedPrefix === undefined) return observations;

  const pinnedIdByDate = new Map(pinnedPrefix.bars.map((bar, index) => [
    bar.tradingDate,
    pinnedPrefix.appliedFxObservationIds[index]!,
  ]));
  const byDate = new Map<string, FxRateObservation[]>();
  for (const observation of observations) {
    const sameDate = byDate.get(observation.rateDate) ?? [];
    sameDate.push(observation);
    byDate.set(observation.rateDate, sameDate);
  }

  const selected: FxRateObservation[] = [];
  for (const [rateDate, sameDate] of byDate) {
    const ordered = [...sameDate].sort(
      (left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt)
        || left.observationId.localeCompare(right.observationId),
    );
    if (rateDate > pinnedPrefix.decisionDate || !pinnedIdByDate.has(rateDate)) {
      selected.push(...ordered);
      continue;
    }
    const pinnedId = pinnedIdByDate.get(rateDate)!;
    const pinnedIndex = ordered.findIndex((observation) => observation.observationId === pinnedId);
    if (pinnedIndex < 0) {
      throw new Error(`Pinned FX observation ${pinnedId} for ${rateDate} is unavailable in the return source.`);
    }
    selected.push(...ordered.slice(0, pinnedIndex + 1));
  }
  return selected;
}

function assertNoAmbiguousEvents(events: readonly ReturnEvent[]): void {
  const keys = new Set<string>();
  for (const event of events) {
    const key = event.type === "cash_distribution"
      ? `${event.type}:${event.exDate}:${event.currency}`
      : `${event.type}:${event.effectiveDate}`;
    if (keys.has(key)) {
      throw new Error(`Ambiguous duplicate economic event ${key}; distribution revision semantics are not defined.`);
    }
    keys.add(key);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.join(", ")}.`);
}

function parseProvenance(value: unknown, field: string): DataProvenance {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["source", "dataset", "retrievedAt", "sourceVersion", "recordId"], field);
  const provenance = {
    source: value.source as string,
    dataset: value.dataset as string,
    retrievedAt: value.retrievedAt as string,
    sourceVersion: value.sourceVersion as string | undefined,
    recordId: value.recordId as string | undefined,
  } satisfies DataProvenance;
  assertProvenance(provenance, field);
  return provenance;
}

function parseEvent(value: unknown, index: number): ReturnEvent {
  const field = `asset.events[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  if (value.type === "cash_distribution") {
    assertOnlyKeys(value, ["type", "eventId", "code", "availableAt", "provenance", "exDate", "payDate", "amountPerUnit", "currency"], field);
    const event = value as unknown as ReturnEvent;
    assertNonEmpty(value.eventId, `${field}.eventId`);
    assertNonEmpty(value.code, `${field}.code`);
    assertNonEmpty(value.availableAt, `${field}.availableAt`);
    assertNonEmpty(value.exDate, `${field}.exDate`);
    assertCurrency(value.currency, `${field}.currency`);
    if (typeof value.amountPerUnit !== "number" || !Number.isFinite(value.amountPerUnit) || value.amountPerUnit <= 0) {
      throw new Error(`${field}.amountPerUnit must be positive.`);
    }
    parseProvenance(value.provenance, `${field}.provenance`);
    if (value.payDate !== undefined) assertNonEmpty(value.payDate, `${field}.payDate`);
    return event;
  }
  if (value.type === "split") {
    assertOnlyKeys(value, ["type", "eventId", "code", "availableAt", "provenance", "effectiveDate", "newUnitsPerOldUnit"], field);
    const event = value as unknown as ReturnEvent;
    assertNonEmpty(value.eventId, `${field}.eventId`);
    assertNonEmpty(value.code, `${field}.code`);
    assertNonEmpty(value.availableAt, `${field}.availableAt`);
    assertNonEmpty(value.effectiveDate, `${field}.effectiveDate`);
    if (typeof value.newUnitsPerOldUnit !== "number" || !Number.isFinite(value.newUnitsPerOldUnit) || value.newUnitsPerOldUnit <= 0 || value.newUnitsPerOldUnit === 1) {
      throw new Error(`${field}.newUnitsPerOldUnit must be positive and different from one.`);
    }
    parseProvenance(value.provenance, `${field}.provenance`);
    return event;
  }
  if (value.type === "unsupported_corporate_action") {
    assertOnlyKeys(value, ["type", "eventId", "code", "availableAt", "provenance", "effectiveDate", "actionType"], field);
    const event = value as unknown as ReturnEvent;
    assertNonEmpty(value.eventId, `${field}.eventId`);
    assertNonEmpty(value.code, `${field}.code`);
    assertNonEmpty(value.availableAt, `${field}.availableAt`);
    assertNonEmpty(value.effectiveDate, `${field}.effectiveDate`);
    assertNonEmpty(value.actionType, `${field}.actionType`);
    parseProvenance(value.provenance, `${field}.provenance`);
    return event;
  }
  throw new Error(`${field}.type must be a supported return event type.`);
}

function parseBarObservation(value: unknown, index: number): PointInTimeBarObservation {
  const field = `asset.barObservations[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["code", "tradingDate", "close", "adjustedClose", "volume", "tradingValue", "observationId", "supersedesObservationId", "observedAt", "availableAt", "provenance"], field);
  const observation = value as unknown as PointInTimeBarObservation;
  assertNonEmpty(value.observationId, `${field}.observationId`);
  assertNonEmpty(value.code, `${field}.code`);
  assertNonEmpty(value.tradingDate, `${field}.tradingDate`);
  assertNonEmpty(value.observedAt, `${field}.observedAt`);
  assertNonEmpty(value.availableAt, `${field}.availableAt`);
  parseProvenance(value.provenance, `${field}.provenance`);
  return observation;
}

function parseCoverage(value: unknown): ReturnEventCoverage {
  if (!isRecord(value)) throw new Error("asset.coverage must be an object.");
  assertOnlyKeys(value, ["code", "startDate", "endDate", "corporateActions", "distributions", "availableAt", "provenance"], "asset.coverage");
  assertNonEmpty(value.code, "asset.coverage.code");
  assertNonEmpty(value.startDate, "asset.coverage.startDate");
  assertNonEmpty(value.endDate, "asset.coverage.endDate");
  assertNonEmpty(value.availableAt, "asset.coverage.availableAt");
  parseProvenance(value.provenance, "asset.coverage.provenance");
  return value as unknown as ReturnEventCoverage;
}

function parseFxObservation(value: unknown, index: number): FxRateObservation {
  const field = `asset.fxObservations[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  assertOnlyKeys(value, ["observationId", "rateDate", "sourceCurrency", "targetCurrency", "quoteConvention", "targetCurrencyPerSourceUnit", "observedAt", "availableAt", "supersedesObservationId", "provenance"], field);
  assertNonEmpty(value.observationId, `${field}.observationId`);
  assertNonEmpty(value.rateDate, `${field}.rateDate`);
  assertNonEmpty(value.sourceCurrency, `${field}.sourceCurrency`);
  assertCurrency(value.sourceCurrency, `${field}.sourceCurrency`);
  assertCurrency(value.targetCurrency, `${field}.targetCurrency`);
  assertNonEmpty(value.observedAt, `${field}.observedAt`);
  assertNonEmpty(value.availableAt, `${field}.availableAt`);
  parseProvenance(value.provenance, `${field}.provenance`);
  return value as unknown as FxRateObservation;
}

function parseFxCoverage(value: unknown): FxRateCoverage {
  if (!isRecord(value)) throw new Error("asset.fxCoverage must be an object.");
  assertOnlyKeys(value, ["sourceCurrency", "targetCurrency", "startDate", "endDate", "status", "availableAt", "provenance"], "asset.fxCoverage");
  assertCurrency(value.sourceCurrency, "asset.fxCoverage.sourceCurrency");
  assertCurrency(value.targetCurrency, "asset.fxCoverage.targetCurrency");
  assertNonEmpty(value.startDate, "asset.fxCoverage.startDate");
  assertNonEmpty(value.endDate, "asset.fxCoverage.endDate");
  assertNonEmpty(value.availableAt, "asset.fxCoverage.availableAt");
  parseProvenance(value.provenance, "asset.fxCoverage.provenance");
  return value as unknown as FxRateCoverage;
}

/** Parse a JSON-facing asset while rejecting unknown fields before resolution. */
export function validatePointInTimeReturnSourceAsset(value: unknown): PointInTimeReturnAsset {
  if (!isRecord(value)) throw new Error("Point-in-time return source asset must be an object.");
  assertOnlyKeys(value, ["code", "currency", "basis", "barObservations", "events", "coverage", "totalReturnPolicyId", "totalReturnPolicy", "fxObservations", "fxCoverage"], "asset");
  assertNonEmpty(value.code, "asset.code");
  assertCurrency(value.currency, "asset.currency");
  if (!Array.isArray(value.barObservations)) throw new Error("asset.barObservations must be an array.");
  if (!Array.isArray(value.events)) throw new Error("asset.events must be an array.");
  const parsed: PointInTimeReturnAsset = {
    code: value.code,
    currency: value.currency,
    basis: value.basis as NormalizedReturnBasis,
    barObservations: value.barObservations.map(parseBarObservation),
    events: value.events.map(parseEvent),
    coverage: parseCoverage(value.coverage),
    totalReturnPolicyId: value.totalReturnPolicyId as string | undefined,
    totalReturnPolicy: value.totalReturnPolicy as TotalReturnPolicy | undefined,
    fxObservations: value.fxObservations === undefined ? undefined : Array.isArray(value.fxObservations)
      ? value.fxObservations.map(parseFxObservation)
      : (() => { throw new Error("asset.fxObservations must be an array when provided."); })(),
    fxCoverage: value.fxCoverage === undefined ? undefined : parseFxCoverage(value.fxCoverage),
  };
  assertAsset(parsed);
  return structuredClone(parsed);
}

function assertAsset(asset: PointInTimeReturnAsset): void {
  assertNonEmpty(asset.code, "asset.code");
  assertCurrency(asset.currency, "asset.currency");
  if (asset.basis !== "price_return" && asset.basis !== "total_return") {
    throw new Error(`Unsupported asset basis: ${String(asset.basis)}.`);
  }
  if (!Array.isArray(asset.barObservations) || asset.barObservations.length === 0) {
    throw new Error("asset.barObservations must be a non-empty array.");
  }
  if (!Array.isArray(asset.events)) throw new Error("asset.events must be an array.");
  validateBarRevisionChains(asset.barObservations, asset.code);
  assertNoAmbiguousEvents(asset.events);
  if (asset.basis === "total_return") {
    if (asset.totalReturnPolicyId !== APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID) {
      throw new Error(`Total Return requires approved policy ID ${APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID}.`);
    }
    if (asset.totalReturnPolicy === undefined
      || sha256Canonical(asset.totalReturnPolicy) !== sha256Canonical(APPROVED_RESEARCH_TOTAL_RETURN_POLICY)) {
      throw new Error("Total Return requires the explicit approved research policy.");
    }
  } else if (asset.totalReturnPolicyId !== undefined || asset.totalReturnPolicy !== undefined) {
    throw new Error("Total Return policy must not be supplied for Price Return.");
  }
  if (asset.currency === "JPY") {
    if (asset.fxObservations !== undefined || asset.fxCoverage !== undefined) {
      throw new Error("JPY assets must not supply an FX rate book.");
    }
  } else if (!Array.isArray(asset.fxObservations) || asset.fxObservations.length === 0 || asset.fxCoverage === undefined) {
    throw new Error(`Non-JPY asset ${asset.code} requires FX observations and coverage.`);
  }
}

function canonicalAsset(asset: PointInTimeReturnAsset): unknown {
  return {
    code: asset.code,
    currency: asset.currency,
    basis: asset.basis,
    barObservations: [...asset.barObservations].sort(
      (left, right) => left.tradingDate.localeCompare(right.tradingDate)
        || Date.parse(left.availableAt) - Date.parse(right.availableAt)
        || left.observationId.localeCompare(right.observationId),
    ),
    events: [...asset.events].sort((left, right) => left.eventId.localeCompare(right.eventId)),
    coverage: asset.coverage,
    totalReturnPolicyId: asset.totalReturnPolicyId,
    totalReturnPolicy: asset.totalReturnPolicy,
    fxObservations: asset.fxObservations === undefined ? undefined : [...asset.fxObservations].sort(
      (left, right) => left.rateDate.localeCompare(right.rateDate)
        || Date.parse(left.availableAt) - Date.parse(right.availableAt)
        || left.observationId.localeCompare(right.observationId),
    ),
    fxCoverage: asset.fxCoverage,
  };
}

export function pointInTimeReturnAssetFingerprint(asset: PointInTimeReturnAsset): string {
  assertAsset(asset);
  return sha256Canonical(canonicalAsset(asset));
}

function resolutionBody(resolution: PointInTimeReturnResolution): Omit<PointInTimeReturnResolution, "fingerprint"> {
  const { fingerprint: _fingerprint, ...body } = resolution;
  return body;
}

export function assertPointInTimeReturnResolutionIntegrity(
  resolution: PointInTimeReturnResolution,
): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(resolution.fingerprint)) {
    throw new Error("Point-in-time return resolution fingerprint is invalid.");
  }
  if (sha256Canonical(resolutionBody(resolution)) !== resolution.fingerprint) {
    throw new Error(`Point-in-time return resolution fingerprint is invalid for ${resolution.code}.`);
  }
}

export function resolvePointInTimeReturn(
  asset: PointInTimeReturnAsset,
  decisionDate: string,
  pinnedPrefix?: PointInTimeReturnResolution,
): PointInTimeReturnResolution {
  cutoff(decisionDate);
  assertAsset(asset);
  if (pinnedPrefix !== undefined) assertPinnedPrefix(asset, decisionDate, pinnedPrefix);
  const byDate = validateBarRevisionChains(asset.barObservations, asset.code);
  const selected = selectBarsAsOf(byDate, decisionDate, pinnedPrefix);
  const normalized = normalizeReturnSeries({
    code: asset.code,
    currency: asset.currency,
    decisionDate,
    bars: selected.bars,
    events: [...asset.events],
    coverage: asset.coverage,
    basis: asset.basis,
    totalReturnPolicy: asset.totalReturnPolicy,
  });

  let bars: DailyBar[];
  let appliedFxObservationIds: string[] = [];
  let fxMetadata: Pick<
    PointInTimeReturnResolution["normalization"],
    "fxNormalizationVersion" | "fxContractId"
  > = {};
  if (asset.currency === "JPY") {
    bars = normalizedReturnSeriesToDailyBars(normalized);
  } else {
    const fxRateBook = buildPointInTimeFxRateBook({
      decisionDate,
      sourceCurrency: asset.currency,
      targetCurrency: "JPY",
      observations: fxObservationsWithPinnedPrefix(asset, pinnedPrefix),
      coverage: asset.fxCoverage!,
    });
    const jpy = convertNormalizedReturnSeriesToJpy({ series: normalized, fxRateBook });
    bars = jpyNormalizedReturnSeriesToDailyBars(jpy);
    appliedFxObservationIds = jpy.appliedFxRates.map((rate) => rate.observationId);
    fxMetadata = {
      fxNormalizationVersion: jpy.fxNormalizationVersion,
      fxContractId: jpy.fxContractId,
    };
  }

  const inputFingerprint = pointInTimeReturnAssetFingerprint(asset);
  const resultWithoutFingerprint: Omit<PointInTimeReturnResolution, "fingerprint"> = {
    sourceVersion: POINT_IN_TIME_RETURN_SOURCE_VERSION,
    code: asset.code,
    sourceCurrency: asset.currency,
    currency: "JPY",
    basis: asset.basis,
    decisionDate,
    bars,
    appliedBarObservationIds: selected.observationIds,
    appliedEventIds: normalized.appliedEvents.map((event) => event.eventId),
    appliedFxObservationIds,
    normalization: {
      returnNormalizationVersion: normalized.normalizationVersion,
      totalReturnPolicyId: asset.totalReturnPolicyId,
      ...fxMetadata,
    },
    diagnostics: {
      inputBarObservations: asset.barObservations.length,
      selectedBarObservations: selected.observationIds.length,
      futureBarObservationsExcluded: asset.barObservations.length - selected.observationIds.length,
      revisedBarDatesUsed: selected.revisedDatesUsed,
    },
    inputFingerprint,
    pinnedPrefixFingerprint: pinnedPrefix?.fingerprint,
  };
  const resolution = {
    ...resultWithoutFingerprint,
    fingerprint: sha256Canonical(resultWithoutFingerprint),
  } satisfies PointInTimeReturnResolution;
  // Keep the check in the production path so callers never receive a self-inconsistent result.
  assertPointInTimeReturnResolutionIntegrity(resolution);
  if (pinnedPrefix !== undefined) {
    const resolvedPrefix = resolution.bars.filter((bar) => bar.tradingDate <= pinnedPrefix.decisionDate);
    if (sha256Canonical(resolvedPrefix) !== sha256Canonical(pinnedPrefix.bars)
      || sha256Canonical(resolution.appliedBarObservationIds.slice(0, pinnedPrefix.bars.length))
        !== sha256Canonical(pinnedPrefix.appliedBarObservationIds)
      || sha256Canonical(resolution.appliedFxObservationIds.slice(0, pinnedPrefix.bars.length))
        !== sha256Canonical(pinnedPrefix.appliedFxObservationIds)) {
      throw new Error(
        `Forward Point-in-Time resolution for ${asset.code} did not preserve the pinned signal prefix.`,
      );
    }
  }
  return resolution;
}

export function resolve(
  asset: PointInTimeReturnAsset,
  decisionDate: string,
  pinnedPrefix?: PointInTimeReturnResolution,
): PointInTimeReturnResolution {
  return resolvePointInTimeReturn(asset, decisionDate, pinnedPrefix);
}

export class PointInTimeReturnSource {
  resolve(
    asset: PointInTimeReturnAsset,
    decisionDate: string,
    pinnedPrefix?: PointInTimeReturnResolution,
  ): PointInTimeReturnResolution {
    return resolvePointInTimeReturn(asset, decisionDate, pinnedPrefix);
  }
}
