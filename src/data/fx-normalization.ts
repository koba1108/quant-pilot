import type { DailyBar } from "./models.ts";
import type {
  DataProvenance,
  NormalizedReturnSeries,
  TotalReturnPolicy,
} from "./return-normalization.ts";

export const FX_NORMALIZATION_VERSION = "fx-normalization-v1" as const;
export const POINT_IN_TIME_JPY_FX_CONTRACT_ID = "point-in-time-jpy-fx-d006-v1" as const;

export type FxQuoteConvention = "target_currency_per_source_currency";
export type FxDateAlignment = "exact_date";
export type FxMissingRatePolicy = "fail_closed";

export interface PointInTimeJpyFxContract {
  readonly targetCurrency: "JPY";
  readonly quoteConvention: FxQuoteConvention;
  readonly dateAlignment: FxDateAlignment;
  readonly missingRatePolicy: FxMissingRatePolicy;
  readonly referenceRateUse: "valuation_only";
}

export const POINT_IN_TIME_JPY_FX_CONTRACT: PointInTimeJpyFxContract = Object.freeze({
  targetCurrency: "JPY",
  quoteConvention: "target_currency_per_source_currency",
  dateAlignment: "exact_date",
  missingRatePolicy: "fail_closed",
  referenceRateUse: "valuation_only",
});

export interface FxRateObservation {
  observationId: string;
  rateDate: string;
  sourceCurrency: string;
  targetCurrency: string;
  quoteConvention: FxQuoteConvention;
  targetCurrencyPerSourceUnit: number;
  observedAt: string;
  availableAt: string;
  supersedesObservationId?: string;
  provenance: DataProvenance;
}

export type FxCoverageStatus = "complete" | "unavailable";

export interface FxRateCoverage {
  sourceCurrency: string;
  targetCurrency: string;
  startDate: string;
  endDate: string;
  status: FxCoverageStatus;
  availableAt: string;
  provenance: DataProvenance;
}

export interface BuildPointInTimeFxRateBookRequest {
  decisionDate: string;
  sourceCurrency: string;
  targetCurrency: string;
  observations: FxRateObservation[];
  coverage: FxRateCoverage;
}

export interface PointInTimeFxRateBookDiagnostics {
  inputObservations: number;
  selectedObservations: number;
  futureObservationsExcluded: number;
  unavailableObservationsExcluded: number;
  selectedRevisionDates: number;
}

export interface PointInTimeFxRateBook {
  decisionDate: string;
  sourceCurrency: string;
  targetCurrency: string;
  quoteConvention: FxQuoteConvention;
  dateAlignment: FxDateAlignment;
  normalizationVersion: typeof FX_NORMALIZATION_VERSION;
  coverage: FxRateCoverage;
  observations: FxRateObservation[];
  diagnostics: PointInTimeFxRateBookDiagnostics;
}

export interface ConvertedCurrencyAmount {
  sourceAmount: number;
  sourceCurrency: string;
  targetAmount: number;
  targetCurrency: string;
  rateDate: string;
  targetCurrencyPerSourceUnit: number;
  fxObservationId: string;
  fxAvailableAt: string;
  fxProvenance: DataProvenance;
}

export interface JpyNormalizedReturnPoint {
  code: string;
  tradingDate: string;
  indexValue: number;
  dailyReturn?: number;
  localIndexValue: number;
  localDailyReturn?: number;
  fxDailyReturn?: number;
  fxRateJpyPerSourceUnit: number;
  fxObservationId: string;
  volume?: number;
  tradingValueJpy?: number;
}

export interface AppliedFxRate {
  tradingDate: string;
  observationId: string;
  rateJpyPerSourceUnit: number;
  observedAt: string;
  availableAt: string;
  provenance: DataProvenance;
}

export interface JpyNormalizedReturnSeries {
  code: string;
  sourceCurrency: string;
  currency: "JPY";
  basis: NormalizedReturnSeries["basis"];
  decisionDate: string;
  sourceNormalizationVersion: NormalizedReturnSeries["normalizationVersion"];
  sourcePolicy?: TotalReturnPolicy;
  fxNormalizationVersion: typeof FX_NORMALIZATION_VERSION;
  fxContractId: typeof POINT_IN_TIME_JPY_FX_CONTRACT_ID;
  appliedFxRates: AppliedFxRate[];
  points: JpyNormalizedReturnPoint[];
  diagnostics: {
    inputPoints: number;
    outputPoints: number;
    revisedRateDatesUsed: number;
  };
}

export interface ConvertNormalizedReturnSeriesToJpyRequest {
  series: NormalizedReturnSeries;
  fxRateBook: PointInTimeFxRateBook;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function isIsoDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function endOfUtcDate(value: string): number {
  return Date.parse(`${value}T23:59:59.999Z`);
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} must be non-empty.`);
}

function assertCurrency(value: string, field: string): void {
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new Error(`${field} must be an ISO-style three-letter uppercase currency code; received ${value}.`);
  }
}

function assertProvenance(provenance: DataProvenance, field: string): void {
  assertNonEmpty(provenance.source, `${field}.source`);
  assertNonEmpty(provenance.dataset, `${field}.dataset`);
  if (!isIsoDateTime(provenance.retrievedAt)) {
    throw new Error(`${field}.retrievedAt must be an ISO date-time with an explicit timezone.`);
  }
  if (provenance.sourceVersion !== undefined) {
    assertNonEmpty(provenance.sourceVersion, `${field}.sourceVersion`);
  }
  if (provenance.recordId !== undefined) {
    assertNonEmpty(provenance.recordId, `${field}.recordId`);
  }
}

function assertObservation(
  observation: FxRateObservation,
  sourceCurrency: string,
  targetCurrency: string,
): void {
  assertNonEmpty(observation.observationId, "FX observationId");
  if (!isIsoDate(observation.rateDate)) {
    throw new Error(`FX observation ${observation.observationId} has an invalid rateDate.`);
  }
  if (observation.sourceCurrency !== sourceCurrency || observation.targetCurrency !== targetCurrency) {
    throw new Error(
      `FX observation ${observation.observationId} pair ${observation.sourceCurrency}/${observation.targetCurrency} does not match requested ${sourceCurrency}/${targetCurrency}; inverse or cross-rate conversion is never implicit.`,
    );
  }
  if (observation.quoteConvention !== "target_currency_per_source_currency") {
    throw new Error(`FX observation ${observation.observationId} has an unsupported quoteConvention.`);
  }
  if (
    !Number.isFinite(observation.targetCurrencyPerSourceUnit)
    || observation.targetCurrencyPerSourceUnit <= 0
  ) {
    throw new Error(`FX observation ${observation.observationId} rate must be positive.`);
  }
  if (!isIsoDateTime(observation.observedAt) || !isIsoDateTime(observation.availableAt)) {
    throw new Error(
      `FX observation ${observation.observationId} observedAt/availableAt must be ISO date-times with explicit timezones.`,
    );
  }
  if (Date.parse(observation.observedAt) > Date.parse(observation.availableAt)) {
    throw new Error(`FX observation ${observation.observationId} cannot be available before it was observed.`);
  }
  if (observation.supersedesObservationId !== undefined) {
    assertNonEmpty(
      observation.supersedesObservationId,
      `FX observation ${observation.observationId} supersedesObservationId`,
    );
  }
  assertProvenance(observation.provenance, `FX observation ${observation.observationId} provenance`);
}

function assertCoverage(
  coverage: FxRateCoverage,
  sourceCurrency: string,
  targetCurrency: string,
  decisionDate: string,
): void {
  if (coverage.sourceCurrency !== sourceCurrency || coverage.targetCurrency !== targetCurrency) {
    throw new Error(
      `FX coverage pair ${coverage.sourceCurrency}/${coverage.targetCurrency} does not match requested ${sourceCurrency}/${targetCurrency}.`,
    );
  }
  if (!isIsoDate(coverage.startDate) || !isIsoDate(coverage.endDate) || coverage.startDate > coverage.endDate) {
    throw new Error("FX coverage startDate/endDate must be valid ordered ISO dates.");
  }
  if (coverage.status !== "complete") {
    throw new Error(`Complete FX coverage is required for ${sourceCurrency}/${targetCurrency}.`);
  }
  if (!isIsoDateTime(coverage.availableAt)) {
    throw new Error("FX coverage availableAt must be an ISO date-time with an explicit timezone.");
  }
  if (Date.parse(coverage.availableAt) > endOfUtcDate(decisionDate)) {
    throw new Error(`FX coverage was not available by decisionDate ${decisionDate}.`);
  }
  assertProvenance(coverage.provenance, "FX coverage provenance");
}

function sortByAvailability(left: FxRateObservation, right: FxRateObservation): number {
  return Date.parse(left.availableAt) - Date.parse(right.availableAt)
    || left.observationId.localeCompare(right.observationId);
}

export function buildPointInTimeFxRateBook(
  request: BuildPointInTimeFxRateBookRequest,
): PointInTimeFxRateBook {
  if (!isIsoDate(request.decisionDate)) {
    throw new Error(`decisionDate must be an ISO date; received ${request.decisionDate}.`);
  }
  assertCurrency(request.sourceCurrency, "sourceCurrency");
  assertCurrency(request.targetCurrency, "targetCurrency");
  if (request.sourceCurrency === request.targetCurrency) {
    throw new Error("FX sourceCurrency and targetCurrency must differ.");
  }
  if (!Array.isArray(request.observations)) {
    throw new Error("FX observations must be an array.");
  }
  assertCoverage(
    request.coverage,
    request.sourceCurrency,
    request.targetCurrency,
    request.decisionDate,
  );

  const seenObservationIds = new Set<string>();
  const observationsByDate = new Map<string, FxRateObservation[]>();
  for (const observation of request.observations) {
    assertObservation(observation, request.sourceCurrency, request.targetCurrency);
    if (seenObservationIds.has(observation.observationId)) {
      throw new Error(`Duplicate FX observation id: ${observation.observationId}.`);
    }
    seenObservationIds.add(observation.observationId);
    if (
      observation.rateDate < request.coverage.startDate
      || observation.rateDate > request.coverage.endDate
    ) {
      throw new Error(
        `FX observation ${observation.observationId} rateDate ${observation.rateDate} is outside declared coverage ${request.coverage.startDate}..${request.coverage.endDate}.`,
      );
    }
    const sameDate = observationsByDate.get(observation.rateDate) ?? [];
    sameDate.push(observation);
    observationsByDate.set(observation.rateDate, sameDate);
  }

  const orderedChains = [...observationsByDate.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([rateDate, observations]) => {
      const ordered = [...observations].sort(sortByAvailability);
      for (let index = 0; index < ordered.length; index++) {
        const current = ordered[index]!;
        const previous = ordered[index - 1];
        if (previous && Date.parse(current.availableAt) === Date.parse(previous.availableAt)) {
          throw new Error(`FX revisions for ${rateDate} must have distinct availability timestamps.`);
        }
        if (!previous && current.supersedesObservationId !== undefined) {
          throw new Error(
            `Initial FX observation ${current.observationId} for ${rateDate} cannot supersede another observation.`,
          );
        }
        if (previous && current.supersedesObservationId !== previous.observationId) {
          throw new Error(
            `FX revision ${current.observationId} must explicitly supersede ${previous.observationId}.`,
          );
        }
      }
      return { rateDate, observations: ordered };
    });

  const selected: FxRateObservation[] = [];
  let futureObservationsExcluded = 0;
  let unavailableObservationsExcluded = 0;
  let selectedRevisionDates = 0;
  const decisionCutoff = endOfUtcDate(request.decisionDate);
  for (const chain of orderedChains) {
    if (chain.rateDate > request.decisionDate) {
      futureObservationsExcluded += chain.observations.length;
      continue;
    }
    const available = chain.observations.filter(
      (observation) => Date.parse(observation.availableAt) <= decisionCutoff,
    );
    unavailableObservationsExcluded += chain.observations.length - available.length;
    const latest = available.at(-1);
    if (!latest) continue;
    selected.push(latest);
    if (latest.supersedesObservationId !== undefined) selectedRevisionDates += 1;
  }

  return {
    decisionDate: request.decisionDate,
    sourceCurrency: request.sourceCurrency,
    targetCurrency: request.targetCurrency,
    quoteConvention: "target_currency_per_source_currency",
    dateAlignment: "exact_date",
    normalizationVersion: FX_NORMALIZATION_VERSION,
    coverage: request.coverage,
    observations: selected,
    diagnostics: {
      inputObservations: request.observations.length,
      selectedObservations: selected.length,
      futureObservationsExcluded,
      unavailableObservationsExcluded,
      selectedRevisionDates,
    },
  };
}

function assertPointInTimeFxRateBook(rateBook: PointInTimeFxRateBook): void {
  if (!isIsoDate(rateBook.decisionDate)) {
    throw new Error(`FX rate-book decisionDate is invalid: ${rateBook.decisionDate}.`);
  }
  assertCurrency(rateBook.sourceCurrency, "FX rate-book sourceCurrency");
  assertCurrency(rateBook.targetCurrency, "FX rate-book targetCurrency");
  if (rateBook.sourceCurrency === rateBook.targetCurrency) {
    throw new Error("FX rate-book sourceCurrency and targetCurrency must differ.");
  }
  if (
    rateBook.quoteConvention !== "target_currency_per_source_currency"
    || rateBook.dateAlignment !== "exact_date"
    || rateBook.normalizationVersion !== FX_NORMALIZATION_VERSION
  ) {
    throw new Error("FX rate-book contract metadata is invalid or unsupported.");
  }
  if (!Array.isArray(rateBook.observations)) {
    throw new Error("FX rate-book observations must be an array.");
  }
  assertCoverage(
    rateBook.coverage,
    rateBook.sourceCurrency,
    rateBook.targetCurrency,
    rateBook.decisionDate,
  );
  let previousDate = "";
  for (const observation of rateBook.observations) {
    assertObservation(observation, rateBook.sourceCurrency, rateBook.targetCurrency);
    if (
      observation.rateDate < rateBook.coverage.startDate
      || observation.rateDate > rateBook.coverage.endDate
    ) {
      throw new Error(
        `FX rate-book observation ${observation.observationId} is outside declared coverage.`,
      );
    }
    if (observation.rateDate > rateBook.decisionDate) {
      throw new Error(
        `FX rate-book observation ${observation.observationId} is after decisionDate ${rateBook.decisionDate}.`,
      );
    }
    if (Date.parse(observation.availableAt) > endOfUtcDate(rateBook.decisionDate)) {
      throw new Error(
        `FX rate-book observation ${observation.observationId} was unavailable at decisionDate ${rateBook.decisionDate}.`,
      );
    }
    if (previousDate && observation.rateDate <= previousDate) {
      throw new Error(`FX rate-book observations are duplicated or unordered at ${observation.rateDate}.`);
    }
    previousDate = observation.rateDate;
  }
}

function findExactFxRateObservationUnchecked(
  rateBook: PointInTimeFxRateBook,
  rateDate: string,
): FxRateObservation {
  const observation = rateBook.observations.find((candidate) => candidate.rateDate === rateDate);
  if (!observation) {
    throw new Error(
      `Missing exact-date FX rate ${rateBook.sourceCurrency}/${rateBook.targetCurrency} for ${rateDate}; implicit forward-fill, backfill, inversion, and triangulation are forbidden.`,
    );
  }
  return observation;
}

export function findExactFxRateObservation(
  rateBook: PointInTimeFxRateBook,
  rateDate: string,
): FxRateObservation {
  assertPointInTimeFxRateBook(rateBook);
  if (!isIsoDate(rateDate)) {
    throw new Error(`rateDate must be an ISO date; received ${rateDate}.`);
  }
  if (rateDate > rateBook.decisionDate) {
    throw new Error(`FX rateDate ${rateDate} is after rate-book decisionDate ${rateBook.decisionDate}.`);
  }
  return findExactFxRateObservationUnchecked(rateBook, rateDate);
}

export function convertCurrencyAmountAtExactRate(
  rateBook: PointInTimeFxRateBook,
  sourceAmount: number,
  rateDate: string,
): ConvertedCurrencyAmount {
  if (!Number.isFinite(sourceAmount)) throw new Error("sourceAmount must be finite.");
  assertPointInTimeFxRateBook(rateBook);
  if (!isIsoDate(rateDate)) {
    throw new Error(`rateDate must be an ISO date; received ${rateDate}.`);
  }
  if (rateDate > rateBook.decisionDate) {
    throw new Error(`FX rateDate ${rateDate} is after rate-book decisionDate ${rateBook.decisionDate}.`);
  }
  const observation = findExactFxRateObservationUnchecked(rateBook, rateDate);
  return {
    sourceAmount,
    sourceCurrency: rateBook.sourceCurrency,
    targetAmount: sourceAmount * observation.targetCurrencyPerSourceUnit,
    targetCurrency: rateBook.targetCurrency,
    rateDate,
    targetCurrencyPerSourceUnit: observation.targetCurrencyPerSourceUnit,
    fxObservationId: observation.observationId,
    fxAvailableAt: observation.availableAt,
    fxProvenance: observation.provenance,
  };
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-12;
}

function assertNormalizedSeries(series: NormalizedReturnSeries): void {
  assertNonEmpty(series.code, "normalized series code");
  assertCurrency(series.currency, "normalized series currency");
  if (!isIsoDate(series.decisionDate)) {
    throw new Error(`Normalized series decisionDate is invalid: ${series.decisionDate}.`);
  }
  if (series.points.length === 0) throw new Error("Normalized return series has no points.");
  let previousDate = "";
  let previousIndexValue: number | undefined;
  for (const point of series.points) {
    if (point.code !== series.code) {
      throw new Error(`Unexpected normalized point code ${point.code}; expected ${series.code}.`);
    }
    if (!isIsoDate(point.tradingDate) || point.tradingDate > series.decisionDate) {
      throw new Error(`Invalid normalized point date ${point.tradingDate}.`);
    }
    if (previousDate && point.tradingDate <= previousDate) {
      throw new Error(`Normalized return points are duplicated or unordered at ${point.tradingDate}.`);
    }
    if (!Number.isFinite(point.indexValue) || point.indexValue <= 0) {
      throw new Error(`Invalid normalized index value on ${point.tradingDate}.`);
    }
    if (previousIndexValue === undefined) {
      if (point.dailyReturn !== undefined) {
        throw new Error("The first normalized point must not have a dailyReturn.");
      }
    } else {
      const expectedReturn = point.indexValue / previousIndexValue - 1;
      if (point.dailyReturn === undefined || !approximatelyEqual(point.dailyReturn, expectedReturn)) {
        throw new Error(`Normalized dailyReturn does not match index values on ${point.tradingDate}.`);
      }
    }
    if (point.tradingValue !== undefined && (!Number.isFinite(point.tradingValue) || point.tradingValue < 0)) {
      throw new Error(`Invalid normalized tradingValue on ${point.tradingDate}.`);
    }
    previousDate = point.tradingDate;
    previousIndexValue = point.indexValue;
  }
}

export function convertNormalizedReturnSeriesToJpy(
  request: ConvertNormalizedReturnSeriesToJpyRequest,
): JpyNormalizedReturnSeries {
  assertNormalizedSeries(request.series);
  assertPointInTimeFxRateBook(request.fxRateBook);
  if (request.series.currency === "JPY") {
    throw new Error("The normalized return series is already JPY-denominated.");
  }
  if (
    request.fxRateBook.sourceCurrency !== request.series.currency
    || request.fxRateBook.targetCurrency !== "JPY"
  ) {
    throw new Error(
      `FX rate book ${request.fxRateBook.sourceCurrency}/${request.fxRateBook.targetCurrency} cannot convert ${request.series.currency} to JPY.`,
    );
  }
  if (request.fxRateBook.decisionDate !== request.series.decisionDate) {
    throw new Error(
      `FX rate-book decisionDate ${request.fxRateBook.decisionDate} must match normalized series decisionDate ${request.series.decisionDate}.`,
    );
  }

  const firstPoint = request.series.points[0]!;
  const lastPoint = request.series.points.at(-1)!;
  if (
    request.fxRateBook.coverage.startDate > firstPoint.tradingDate
    || request.fxRateBook.coverage.endDate < lastPoint.tradingDate
  ) {
    throw new Error(
      `FX coverage ${request.fxRateBook.coverage.startDate}..${request.fxRateBook.coverage.endDate} does not span normalized points ${firstPoint.tradingDate}..${lastPoint.tradingDate}.`,
    );
  }

  const points: JpyNormalizedReturnPoint[] = [];
  const appliedFxRates: AppliedFxRate[] = [];
  let previousLocalIndex: number | undefined;
  let previousJpyIndex: number | undefined;
  let previousFxRate: number | undefined;

  for (const point of request.series.points) {
    const observation = findExactFxRateObservationUnchecked(request.fxRateBook, point.tradingDate);
    const fxRate = observation.targetCurrencyPerSourceUnit;
    const localDailyReturn = previousLocalIndex === undefined
      ? undefined
      : point.indexValue / previousLocalIndex - 1;
    const fxDailyReturn = previousFxRate === undefined ? undefined : fxRate / previousFxRate - 1;
    const dailyReturn = localDailyReturn === undefined || fxDailyReturn === undefined
      ? undefined
      : (1 + localDailyReturn) * (1 + fxDailyReturn) - 1;
    const indexValue = previousJpyIndex === undefined
      ? point.indexValue
      : previousJpyIndex * (1 + dailyReturn!);

    points.push({
      code: point.code,
      tradingDate: point.tradingDate,
      indexValue,
      dailyReturn,
      localIndexValue: point.indexValue,
      localDailyReturn,
      fxDailyReturn,
      fxRateJpyPerSourceUnit: fxRate,
      fxObservationId: observation.observationId,
      volume: point.volume,
      tradingValueJpy: point.tradingValue === undefined ? undefined : point.tradingValue * fxRate,
    });
    appliedFxRates.push({
      tradingDate: point.tradingDate,
      observationId: observation.observationId,
      rateJpyPerSourceUnit: fxRate,
      observedAt: observation.observedAt,
      availableAt: observation.availableAt,
      provenance: observation.provenance,
    });
    previousLocalIndex = point.indexValue;
    previousJpyIndex = indexValue;
    previousFxRate = fxRate;
  }

  return {
    code: request.series.code,
    sourceCurrency: request.series.currency,
    currency: "JPY",
    basis: request.series.basis,
    decisionDate: request.series.decisionDate,
    sourceNormalizationVersion: request.series.normalizationVersion,
    sourcePolicy: request.series.policy,
    fxNormalizationVersion: FX_NORMALIZATION_VERSION,
    fxContractId: POINT_IN_TIME_JPY_FX_CONTRACT_ID,
    appliedFxRates,
    points,
    diagnostics: {
      inputPoints: request.series.points.length,
      outputPoints: points.length,
      revisedRateDatesUsed: new Set(
        appliedFxRates
          .filter((rate) => request.fxRateBook.observations.find(
            (observation) => observation.observationId === rate.observationId,
          )?.supersedesObservationId !== undefined)
          .map((rate) => rate.tradingDate),
      ).size,
    },
  };
}

export function jpyNormalizedReturnSeriesToDailyBars(
  series: JpyNormalizedReturnSeries,
): DailyBar[] {
  return series.points.map((point) => ({
    code: point.code,
    tradingDate: point.tradingDate,
    close: point.indexValue,
    adjustedClose: point.indexValue,
    volume: point.volume,
    tradingValue: point.tradingValueJpy,
  }));
}
