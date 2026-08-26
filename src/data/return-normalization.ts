import type { DailyBar } from "./models.ts";
import { assertDailyBars } from "./provider.ts";

export const RETURN_NORMALIZATION_VERSION = "return-normalization-v1" as const;

export type NormalizedReturnBasis = "price_return" | "total_return";
export type CoverageStatus = "complete" | "unavailable";
export type DistributionRecognition = "ex_date" | "pay_date";
export type ReinvestmentConvention = "same_day_close";

export interface DataProvenance {
  source: string;
  dataset: string;
  retrievedAt: string;
  sourceVersion?: string;
  recordId?: string;
}

interface BaseReturnEvent {
  eventId: string;
  code: string;
  availableAt: string;
  provenance: DataProvenance;
}

export interface CashDistributionEvent extends BaseReturnEvent {
  type: "cash_distribution";
  exDate: string;
  payDate?: string;
  amountPerUnit: number;
  currency: string;
}

export interface SplitEvent extends BaseReturnEvent {
  type: "split";
  effectiveDate: string;
  newUnitsPerOldUnit: number;
}

export interface UnsupportedCorporateActionEvent extends BaseReturnEvent {
  type: "unsupported_corporate_action";
  effectiveDate: string;
  actionType: string;
}

export type ReturnEvent =
  | CashDistributionEvent
  | SplitEvent
  | UnsupportedCorporateActionEvent;

type SupportedReturnEvent = CashDistributionEvent | SplitEvent;

export interface ReturnEventCoverage {
  code: string;
  startDate: string;
  endDate: string;
  corporateActions: CoverageStatus;
  distributions: CoverageStatus;
  provenance: DataProvenance;
}

export interface TotalReturnPolicy {
  distributionRecognition: DistributionRecognition;
  reinvestment: ReinvestmentConvention;
}

export interface NormalizeReturnSeriesRequest {
  code: string;
  currency: string;
  decisionDate: string;
  bars: DailyBar[];
  events: ReturnEvent[];
  coverage: ReturnEventCoverage;
  basis: NormalizedReturnBasis;
  totalReturnPolicy?: TotalReturnPolicy;
}

export interface NormalizedReturnPoint {
  code: string;
  tradingDate: string;
  indexValue: number;
  dailyReturn?: number;
  volume?: number;
  tradingValue?: number;
}

export interface ReturnNormalizationDiagnostics {
  inputBars: number;
  outputBars: number;
  futureBarsExcluded: number;
  futureEventsExcluded: number;
  eventsOutsideSeries: number;
  ignoredDistributionEvents: number;
  appliedSplitEvents: number;
  appliedDistributionEvents: number;
}

export interface AppliedReturnEvent {
  eventId: string;
  type: "cash_distribution" | "split";
  recognitionDate: string;
  availableAt: string;
  provenance: DataProvenance;
}

export interface NormalizedReturnSeries {
  code: string;
  currency: string;
  basis: NormalizedReturnBasis;
  decisionDate: string;
  normalizationVersion: typeof RETURN_NORMALIZATION_VERSION;
  policy?: TotalReturnPolicy;
  coverage: ReturnEventCoverage;
  appliedEvents: AppliedReturnEvent[];
  points: NormalizedReturnPoint[];
  diagnostics: ReturnNormalizationDiagnostics;
}

export function normalizedReturnSeriesToDailyBars(series: NormalizedReturnSeries): DailyBar[] {
  return series.points.map((point) => ({
    code: point.code,
    tradingDate: point.tradingDate,
    close: point.indexValue,
    adjustedClose: point.indexValue,
    volume: point.volume,
    tradingValue: point.tradingValue,
  }));
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

function eventRecognitionDate(
  event: ReturnEvent,
  policy: TotalReturnPolicy | undefined,
): string {
  if (event.type === "cash_distribution") {
    if (policy?.distributionRecognition === "pay_date") {
      if (!event.payDate) {
        throw new Error(`Distribution ${event.eventId} has no payDate required by the selected policy.`);
      }
      return event.payDate;
    }
    return event.exDate;
  }
  return event.effectiveDate;
}

function assertEvent(event: ReturnEvent, code: string): void {
  assertNonEmpty(event.eventId, "eventId");
  if (event.code !== code) {
    throw new Error(`Unexpected event code ${event.code}; expected ${code}.`);
  }
  if (!isIsoDateTime(event.availableAt)) {
    throw new Error(`Event ${event.eventId} availableAt must be an ISO date-time with an explicit timezone.`);
  }
  assertProvenance(event.provenance, `Event ${event.eventId} provenance`);

  if (event.type === "cash_distribution") {
    if (!isIsoDate(event.exDate)) {
      throw new Error(`Distribution ${event.eventId} has an invalid exDate.`);
    }
    if (event.payDate !== undefined && !isIsoDate(event.payDate)) {
      throw new Error(`Distribution ${event.eventId} has an invalid payDate.`);
    }
    if (event.payDate !== undefined && event.payDate < event.exDate) {
      throw new Error(`Distribution ${event.eventId} payDate must not be before exDate.`);
    }
    if (!Number.isFinite(event.amountPerUnit) || event.amountPerUnit <= 0) {
      throw new Error(`Distribution ${event.eventId} amountPerUnit must be positive.`);
    }
    assertCurrency(event.currency, `Distribution ${event.eventId} currency`);
    return;
  }

  if (!isIsoDate(event.effectiveDate)) {
    throw new Error(`Corporate action ${event.eventId} has an invalid effectiveDate.`);
  }
  if (event.type === "split") {
    if (
      !Number.isFinite(event.newUnitsPerOldUnit)
      || event.newUnitsPerOldUnit <= 0
      || event.newUnitsPerOldUnit === 1
    ) {
      throw new Error(`Split ${event.eventId} newUnitsPerOldUnit must be positive and different from 1.`);
    }
    return;
  }
  assertNonEmpty(event.actionType, `Corporate action ${event.eventId} actionType`);
}

function assertCoverage(
  coverage: ReturnEventCoverage,
  code: string,
  firstDate: string,
  lastDate: string,
  basis: NormalizedReturnBasis,
): void {
  if (coverage.code !== code) {
    throw new Error(`Unexpected coverage code ${coverage.code}; expected ${code}.`);
  }
  if (!isIsoDate(coverage.startDate) || !isIsoDate(coverage.endDate) || coverage.startDate > coverage.endDate) {
    throw new Error("Coverage startDate/endDate must be valid ordered ISO dates.");
  }
  if (coverage.startDate > firstDate || coverage.endDate < lastDate) {
    throw new Error(
      `Event coverage ${coverage.startDate}..${coverage.endDate} does not span normalized bars ${firstDate}..${lastDate}.`,
    );
  }
  if (coverage.corporateActions !== "complete") {
    throw new Error("Complete Corporate Action coverage is required for normalized returns.");
  }
  if (basis === "total_return" && coverage.distributions !== "complete") {
    throw new Error("Complete distribution coverage is required for Total Return normalization.");
  }
  assertProvenance(coverage.provenance, "Coverage provenance");
}

function assertPolicy(
  basis: NormalizedReturnBasis,
  policy: TotalReturnPolicy | undefined,
): void {
  if (basis === "price_return") {
    if (policy !== undefined) {
      throw new Error("totalReturnPolicy must not be supplied for Price Return normalization.");
    }
    return;
  }
  if (!policy) {
    throw new Error("Total Return normalization requires an explicit totalReturnPolicy.");
  }
  if (policy.distributionRecognition !== "ex_date" && policy.distributionRecognition !== "pay_date") {
    throw new Error(`Unsupported distributionRecognition: ${String(policy.distributionRecognition)}.`);
  }
  if (policy.reinvestment !== "same_day_close") {
    throw new Error(`Unsupported reinvestment convention: ${String(policy.reinvestment)}.`);
  }
}

export function normalizeReturnSeries(
  request: NormalizeReturnSeriesRequest,
): NormalizedReturnSeries {
  assertNonEmpty(request.code, "code");
  assertCurrency(request.currency, "currency");
  if (!isIsoDate(request.decisionDate)) {
    throw new Error(`decisionDate must be an ISO date; received ${request.decisionDate}.`);
  }
  if (request.basis !== "price_return" && request.basis !== "total_return") {
    throw new Error(`Unsupported normalized return basis: ${String(request.basis)}.`);
  }
  assertPolicy(request.basis, request.totalReturnPolicy);

  const validatedBars = assertDailyBars(request.bars, request.code);
  const bars = validatedBars.filter((bar) => bar.tradingDate <= request.decisionDate);
  if (bars.length === 0) {
    throw new Error(`No bars for ${request.code} are available on or before ${request.decisionDate}.`);
  }
  const firstDate = bars[0]!.tradingDate;
  const lastDate = bars.at(-1)!.tradingDate;
  const barDates = new Set(bars.map((bar) => bar.tradingDate));
  assertCoverage(request.coverage, request.code, firstDate, lastDate, request.basis);

  const seenEventIds = new Set<string>();
  for (const event of request.events) {
    assertEvent(event, request.code);
    if (seenEventIds.has(event.eventId)) {
      throw new Error(`Duplicate return event id: ${event.eventId}.`);
    }
    seenEventIds.add(event.eventId);
  }

  let futureEventsExcluded = 0;
  let eventsOutsideSeries = 0;
  let ignoredDistributionEvents = 0;
  const applicableEvents: Array<{ event: SupportedReturnEvent; recognitionDate: string }> = [];

  for (const event of request.events) {
    const recognitionDate = eventRecognitionDate(event, request.totalReturnPolicy);
    if (recognitionDate > request.decisionDate) {
      futureEventsExcluded += 1;
      continue;
    }
    if (recognitionDate < firstDate || recognitionDate > lastDate) {
      eventsOutsideSeries += 1;
      continue;
    }
    if (event.type === "cash_distribution" && request.basis === "price_return") {
      ignoredDistributionEvents += 1;
      continue;
    }
    if (Date.parse(event.availableAt) > endOfUtcDate(request.decisionDate)) {
      throw new Error(
        `Event ${event.eventId} was not available by decisionDate ${request.decisionDate}.`,
      );
    }
    if (Date.parse(event.availableAt) > endOfUtcDate(recognitionDate)) {
      throw new Error(
        `Event ${event.eventId} was not available by its recognition date ${recognitionDate}; point-in-time normalization cannot apply it retroactively.`,
      );
    }
    if (recognitionDate === firstDate) {
      throw new Error(
        `Event ${event.eventId} occurs on the first bar ${firstDate}; a prior close is required for normalization.`,
      );
    }
    if (event.type === "unsupported_corporate_action") {
      throw new Error(
        `Unsupported Corporate Action ${event.actionType} for ${event.code} on ${event.effectiveDate}.`,
      );
    }
    if (!barDates.has(recognitionDate)) {
      throw new Error(
        `Event ${event.eventId} recognition date ${recognitionDate} has no bar required by same-day normalization.`,
      );
    }
    if (event.type === "cash_distribution" && event.currency !== request.currency) {
      throw new Error(
        `Distribution ${event.eventId} currency ${event.currency} does not match series currency ${request.currency}; Point-in-Time FX normalization is required first.`,
      );
    }
    applicableEvents.push({ event, recognitionDate });
  }
  applicableEvents.sort((left, right) => (
    left.recognitionDate.localeCompare(right.recognitionDate)
    || left.event.eventId.localeCompare(right.event.eventId)
  ));

  const eventsByDate = new Map<string, SupportedReturnEvent[]>();
  for (const item of applicableEvents) {
    const existing = eventsByDate.get(item.recognitionDate) ?? [];
    existing.push(item.event);
    eventsByDate.set(item.recognitionDate, existing);
  }
  for (const [date, events] of eventsByDate) {
    const hasSplit = events.some((event) => event.type === "split");
    const hasDistribution = events.some((event) => event.type === "cash_distribution");
    if (hasSplit && hasDistribution) {
      throw new Error(
        `Split and distribution events share recognition date ${date}; ordering must be modeled explicitly.`,
      );
    }
  }

  const points: NormalizedReturnPoint[] = [{
    code: request.code,
    tradingDate: firstDate,
    indexValue: 100,
    volume: bars[0]!.volume,
    tradingValue: bars[0]!.tradingValue,
  }];
  let indexValue = 100;
  let appliedSplitEvents = 0;
  let appliedDistributionEvents = 0;

  for (let index = 1; index < bars.length; index++) {
    const previous = bars[index - 1]!;
    const current = bars[index]!;
    let unitsPerPreviousUnit = 1;
    let cashPerPreviousUnit = 0;

    const intervalEvents = applicableEvents
      .filter((item) => item.recognitionDate > previous.tradingDate && item.recognitionDate <= current.tradingDate)
      .sort((left, right) => left.recognitionDate.localeCompare(right.recognitionDate));

    for (const item of intervalEvents) {
      if (item.event.type === "split") {
        unitsPerPreviousUnit *= item.event.newUnitsPerOldUnit;
        appliedSplitEvents += 1;
      } else if (item.event.type === "cash_distribution") {
        cashPerPreviousUnit += item.event.amountPerUnit * unitsPerPreviousUnit;
        appliedDistributionEvents += 1;
      }
    }

    const grossFactor = (
      current.close * unitsPerPreviousUnit
      + (request.basis === "total_return" ? cashPerPreviousUnit : 0)
    ) / previous.close;
    if (!Number.isFinite(grossFactor) || grossFactor <= 0) {
      throw new Error(
        `Invalid normalized return factor for ${request.code} on ${current.tradingDate}: ${grossFactor}.`,
      );
    }
    const dailyReturn = grossFactor - 1;
    indexValue *= grossFactor;
    points.push({
      code: request.code,
      tradingDate: current.tradingDate,
      indexValue,
      dailyReturn,
      volume: current.volume,
      tradingValue: current.tradingValue,
    });
  }

  return {
    code: request.code,
    currency: request.currency,
    basis: request.basis,
    decisionDate: request.decisionDate,
    normalizationVersion: RETURN_NORMALIZATION_VERSION,
    policy: request.totalReturnPolicy,
    coverage: request.coverage,
    appliedEvents: applicableEvents.map(({ event, recognitionDate }) => ({
      eventId: event.eventId,
      type: event.type,
      recognitionDate,
      availableAt: event.availableAt,
      provenance: event.provenance,
    })),
    points,
    diagnostics: {
      inputBars: request.bars.length,
      outputBars: bars.length,
      futureBarsExcluded: request.bars.length - bars.length,
      futureEventsExcluded,
      eventsOutsideSeries,
      ignoredDistributionEvents,
      appliedSplitEvents,
      appliedDistributionEvents,
    },
  };
}
