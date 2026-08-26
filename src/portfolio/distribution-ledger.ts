import type { DataProvenance } from "../data/return-normalization.ts";

export const DISTRIBUTION_LEDGER_VERSION = "distribution-ledger-v1" as const;

export type DistributionAmountStatus = "estimated" | "final";

interface BaseDistributionLedgerEvent {
  ledgerEventId: string;
  distributionId: string;
  availableAt: string;
  provenance: DataProvenance;
}

export interface DistributionEntitlementEvent extends BaseDistributionLedgerEvent {
  type: "distribution_entitlement";
  code: string;
  exDate: string;
  payDate: string;
  entitledUnits: number;
  amountPerUnit: number;
  amountStatus: DistributionAmountStatus;
  currency: string;
}

export interface DistributionRevisionEvent extends BaseDistributionLedgerEvent {
  type: "distribution_revision";
  revisedAmountPerUnit: number;
  amountStatus: DistributionAmountStatus;
}

export interface DistributionPaymentEvent extends BaseDistributionLedgerEvent {
  type: "distribution_payment";
  payDate: string;
  grossAmount: number;
  currency: string;
}

export type DistributionLedgerEvent =
  | DistributionEntitlementEvent
  | DistributionRevisionEvent
  | DistributionPaymentEvent;

export interface BuildDistributionLedgerRequest {
  decisionDate: string;
  events: DistributionLedgerEvent[];
}

export interface DistributionLedgerLine {
  distributionId: string;
  code: string;
  exDate: string;
  payDate: string;
  entitledUnits: number;
  amountPerUnit: number;
  amountStatus: DistributionAmountStatus;
  currency: string;
  grossEntitlement: number;
  status: "receivable" | "paid";
  paymentEventId?: string;
  appliedRevisionIds: string[];
}

export interface DistributionLedgerEntry {
  ledgerEventId: string;
  distributionId: string;
  code: string;
  type: DistributionLedgerEvent["type"];
  recognitionDate: string;
  availableAt: string;
  currency: string;
  economicIncomeDelta: number;
  receivableDelta: number;
  cashDelta: number;
  provenance: DataProvenance;
}

export interface DistributionLedgerDiagnostics {
  inputEvents: number;
  appliedEntitlements: number;
  appliedRevisions: number;
  appliedPayments: number;
  futureEntitlementsExcluded: number;
  futureRevisionsExcluded: number;
  futurePaymentsExcluded: number;
}

export interface DistributionLedgerResult {
  decisionDate: string;
  ledgerVersion: typeof DISTRIBUTION_LEDGER_VERSION;
  lines: DistributionLedgerLine[];
  entries: DistributionLedgerEntry[];
  recognizedIncomeByCurrency: Record<string, number>;
  receivablesByCurrency: Record<string, number>;
  paidDistributionsByCurrency: Record<string, number>;
  diagnostics: DistributionLedgerDiagnostics;
}

export interface DistributionCashForRebalanceRequest {
  currency: string;
  previousRebalanceDate?: string;
  rebalanceDate: string;
}

export interface DistributionCashForRebalance {
  currency: string;
  previousRebalanceDate?: string;
  rebalanceDate: string;
  amount: number;
  paymentEventIds: string[];
}

export interface PositiveForecastScoreRequest {
  code: string;
  currency: string;
  horizonStartExclusive: string;
  horizonEndInclusive: string;
  startingEquity: number;
  pricePnl: number;
  cashReturnPnl?: number;
  transactionCosts: number;
  fxConversionCosts: number;
  distributionLedger: DistributionLedgerResult;
}

export interface PositiveForecastScore {
  code: string;
  currency: string;
  pricePnl: number;
  distributionIncome: number;
  cashReturnPnl: number;
  grossPnlBeforeCosts: number;
  transactionCosts: number;
  fxConversionCosts: number;
  totalModeledCosts: number;
  netPnl: number;
  netReturn: number;
  outcome: "hit" | "miss";
}

interface MutableLedgerLine extends DistributionLedgerLine {
  paid: boolean;
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

function utcDateOf(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} must be non-empty.`);
}

function assertCurrency(value: string, field: string): void {
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new Error(`${field} must be an ISO-style three-letter uppercase currency code; received ${value}.`);
  }
}

function assertPositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive.`);
}

function assertNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative.`);
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

function assertBaseEvent(event: DistributionLedgerEvent): void {
  assertNonEmpty(event.ledgerEventId, "ledgerEventId");
  assertNonEmpty(event.distributionId, "distributionId");
  if (!isIsoDateTime(event.availableAt)) {
    throw new Error(`Event ${event.ledgerEventId} availableAt must be an ISO date-time with an explicit timezone.`);
  }
  assertProvenance(event.provenance, `Event ${event.ledgerEventId} provenance`);
}

function assertEntitlement(event: DistributionEntitlementEvent): void {
  assertNonEmpty(event.code, `Entitlement ${event.ledgerEventId} code`);
  if (!isIsoDate(event.exDate) || !isIsoDate(event.payDate) || event.payDate < event.exDate) {
    throw new Error(`Entitlement ${event.ledgerEventId} must have valid ordered exDate/payDate values.`);
  }
  assertPositive(event.entitledUnits, `Entitlement ${event.ledgerEventId} entitledUnits`);
  assertPositive(event.amountPerUnit, `Entitlement ${event.ledgerEventId} amountPerUnit`);
  if (event.amountStatus !== "estimated" && event.amountStatus !== "final") {
    throw new Error(`Entitlement ${event.ledgerEventId} has an invalid amountStatus.`);
  }
  assertCurrency(event.currency, `Entitlement ${event.ledgerEventId} currency`);
  if (Date.parse(event.availableAt) > endOfUtcDate(event.exDate)) {
    throw new Error(
      `Entitlement ${event.ledgerEventId} amount was not available by ex-date ${event.exDate}.`,
    );
  }
}

function assertRevision(
  event: DistributionRevisionEvent,
  entitlement: DistributionEntitlementEvent,
): void {
  assertPositive(event.revisedAmountPerUnit, `Revision ${event.ledgerEventId} revisedAmountPerUnit`);
  if (event.amountStatus !== "estimated" && event.amountStatus !== "final") {
    throw new Error(`Revision ${event.ledgerEventId} has an invalid amountStatus.`);
  }
  if (Date.parse(event.availableAt) <= Date.parse(entitlement.availableAt)) {
    throw new Error(
      `Revision ${event.ledgerEventId} must become available after entitlement event ${entitlement.ledgerEventId}.`,
    );
  }
  if (Date.parse(event.availableAt) > endOfUtcDate(entitlement.payDate)) {
    throw new Error(`Revision ${event.ledgerEventId} became available after pay-date ${entitlement.payDate}.`);
  }
}

function assertPayment(
  event: DistributionPaymentEvent,
  entitlement: DistributionEntitlementEvent,
): void {
  if (!isIsoDate(event.payDate) || event.payDate !== entitlement.payDate) {
    throw new Error(
      `Payment ${event.ledgerEventId} payDate must match entitlement payDate ${entitlement.payDate}.`,
    );
  }
  assertPositive(event.grossAmount, `Payment ${event.ledgerEventId} grossAmount`);
  assertCurrency(event.currency, `Payment ${event.ledgerEventId} currency`);
  if (event.currency !== entitlement.currency) {
    throw new Error(
      `Payment ${event.ledgerEventId} currency ${event.currency} does not match entitlement currency ${entitlement.currency}.`,
    );
  }
  if (Date.parse(event.availableAt) > endOfUtcDate(event.payDate)) {
    throw new Error(`Payment ${event.ledgerEventId} was not available by pay-date ${event.payDate}.`);
  }
}

function addAmount(target: Record<string, number>, currency: string, amount: number): void {
  target[currency] = (target[currency] ?? 0) + amount;
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-12;
}

function sortEntries(entries: DistributionLedgerEntry[]): DistributionLedgerEntry[] {
  const priority: Record<DistributionLedgerEntry["type"], number> = {
    distribution_entitlement: 0,
    distribution_revision: 1,
    distribution_payment: 2,
  };
  return entries.sort((left, right) => (
    left.recognitionDate.localeCompare(right.recognitionDate)
    || priority[left.type] - priority[right.type]
    || Date.parse(left.availableAt) - Date.parse(right.availableAt)
    || left.ledgerEventId.localeCompare(right.ledgerEventId)
  ));
}

export function buildDistributionLedger(
  request: BuildDistributionLedgerRequest,
): DistributionLedgerResult {
  if (!isIsoDate(request.decisionDate)) {
    throw new Error(`decisionDate must be an ISO date; received ${request.decisionDate}.`);
  }
  if (!Array.isArray(request.events)) {
    throw new Error("Distribution ledger events must be an array.");
  }

  const seenLedgerEventIds = new Set<string>();
  const entitlements = new Map<string, DistributionEntitlementEvent>();
  for (const event of request.events) {
    assertBaseEvent(event);
    if (seenLedgerEventIds.has(event.ledgerEventId)) {
      throw new Error(`Duplicate distribution ledger event id: ${event.ledgerEventId}.`);
    }
    seenLedgerEventIds.add(event.ledgerEventId);
    if (event.type !== "distribution_entitlement") continue;
    assertEntitlement(event);
    if (entitlements.has(event.distributionId)) {
      throw new Error(`Duplicate distribution entitlement id: ${event.distributionId}.`);
    }
    entitlements.set(event.distributionId, event);
  }

  const paymentIdsByDistribution = new Map<string, string>();
  for (const event of request.events) {
    if (event.type === "distribution_entitlement") continue;
    const entitlement = entitlements.get(event.distributionId);
    if (!entitlement) {
      throw new Error(
        `Event ${event.ledgerEventId} references unknown distribution ${event.distributionId}.`,
      );
    }
    if (event.type === "distribution_revision") {
      assertRevision(event, entitlement);
    } else {
      assertPayment(event, entitlement);
      if (paymentIdsByDistribution.has(event.distributionId)) {
        throw new Error(`Distribution ${event.distributionId} has more than one payment event.`);
      }
      paymentIdsByDistribution.set(event.distributionId, event.ledgerEventId);
    }
  }

  const lines = new Map<string, MutableLedgerLine>();
  const entries: DistributionLedgerEntry[] = [];
  let futureEntitlementsExcluded = 0;
  let futureRevisionsExcluded = 0;
  let futurePaymentsExcluded = 0;
  let appliedEntitlements = 0;
  let appliedRevisions = 0;
  let appliedPayments = 0;

  const sortedEntitlements = [...entitlements.values()].sort((left, right) => (
    left.exDate.localeCompare(right.exDate)
    || left.distributionId.localeCompare(right.distributionId)
  ));
  for (const event of sortedEntitlements) {
    if (event.exDate > request.decisionDate) {
      futureEntitlementsExcluded += 1;
      continue;
    }
    const grossEntitlement = event.entitledUnits * event.amountPerUnit;
    lines.set(event.distributionId, {
      distributionId: event.distributionId,
      code: event.code,
      exDate: event.exDate,
      payDate: event.payDate,
      entitledUnits: event.entitledUnits,
      amountPerUnit: event.amountPerUnit,
      amountStatus: event.amountStatus,
      currency: event.currency,
      grossEntitlement,
      status: "receivable",
      appliedRevisionIds: [],
      paid: false,
    });
    entries.push({
      ledgerEventId: event.ledgerEventId,
      distributionId: event.distributionId,
      code: event.code,
      type: event.type,
      recognitionDate: event.exDate,
      availableAt: event.availableAt,
      currency: event.currency,
      economicIncomeDelta: grossEntitlement,
      receivableDelta: grossEntitlement,
      cashDelta: 0,
      provenance: event.provenance,
    });
    appliedEntitlements += 1;
  }

  const revisions = request.events
    .filter((event): event is DistributionRevisionEvent => event.type === "distribution_revision")
    .sort((left, right) => (
      Date.parse(left.availableAt) - Date.parse(right.availableAt)
      || left.ledgerEventId.localeCompare(right.ledgerEventId)
    ));
  for (const event of revisions) {
    if (Date.parse(event.availableAt) > endOfUtcDate(request.decisionDate)) {
      futureRevisionsExcluded += 1;
      continue;
    }
    const line = lines.get(event.distributionId);
    if (!line) {
      futureRevisionsExcluded += 1;
      continue;
    }
    if (line.paid) {
      throw new Error(`Revision ${event.ledgerEventId} cannot change an already-paid distribution.`);
    }
    if (line.amountStatus === "final" && event.amountStatus === "estimated") {
      throw new Error(`Revision ${event.ledgerEventId} cannot downgrade a final amount to estimated.`);
    }
    const revisedGrossEntitlement = line.entitledUnits * event.revisedAmountPerUnit;
    const delta = revisedGrossEntitlement - line.grossEntitlement;
    line.amountPerUnit = event.revisedAmountPerUnit;
    line.amountStatus = event.amountStatus;
    line.grossEntitlement = revisedGrossEntitlement;
    line.appliedRevisionIds.push(event.ledgerEventId);
    entries.push({
      ledgerEventId: event.ledgerEventId,
      distributionId: event.distributionId,
      code: line.code,
      type: event.type,
      recognitionDate: utcDateOf(event.availableAt),
      availableAt: event.availableAt,
      currency: line.currency,
      economicIncomeDelta: delta,
      receivableDelta: delta,
      cashDelta: 0,
      provenance: event.provenance,
    });
    appliedRevisions += 1;
  }

  const payments = request.events
    .filter((event): event is DistributionPaymentEvent => event.type === "distribution_payment")
    .sort((left, right) => (
      left.payDate.localeCompare(right.payDate)
      || left.ledgerEventId.localeCompare(right.ledgerEventId)
    ));
  for (const event of payments) {
    if (event.payDate > request.decisionDate) {
      futurePaymentsExcluded += 1;
      continue;
    }
    const line = lines.get(event.distributionId);
    if (!line) {
      futurePaymentsExcluded += 1;
      continue;
    }
    if (!approximatelyEqual(event.grossAmount, line.grossEntitlement)) {
      throw new Error(
        `Payment ${event.ledgerEventId} amount ${event.grossAmount} does not match receivable ${line.grossEntitlement}; an explicit revision is required.`,
      );
    }
    line.paid = true;
    line.status = "paid";
    line.amountStatus = "final";
    line.paymentEventId = event.ledgerEventId;
    entries.push({
      ledgerEventId: event.ledgerEventId,
      distributionId: event.distributionId,
      code: line.code,
      type: event.type,
      recognitionDate: event.payDate,
      availableAt: event.availableAt,
      currency: line.currency,
      economicIncomeDelta: 0,
      receivableDelta: -line.grossEntitlement,
      cashDelta: line.grossEntitlement,
      provenance: event.provenance,
    });
    appliedPayments += 1;
  }

  for (const line of lines.values()) {
    if (!line.paid && line.payDate <= request.decisionDate) {
      throw new Error(
        `Distribution ${line.distributionId} reached pay-date ${line.payDate} without a payment event.`,
      );
    }
  }

  const recognizedIncomeByCurrency: Record<string, number> = {};
  const receivablesByCurrency: Record<string, number> = {};
  const paidDistributionsByCurrency: Record<string, number> = {};
  const outputLines = [...lines.values()]
    .sort((left, right) => (
      left.exDate.localeCompare(right.exDate)
      || left.distributionId.localeCompare(right.distributionId)
    ))
    .map(({ paid: _paid, ...line }) => {
      addAmount(recognizedIncomeByCurrency, line.currency, line.grossEntitlement);
      if (line.status === "paid") {
        addAmount(paidDistributionsByCurrency, line.currency, line.grossEntitlement);
      } else {
        addAmount(receivablesByCurrency, line.currency, line.grossEntitlement);
      }
      return line;
    });

  return {
    decisionDate: request.decisionDate,
    ledgerVersion: DISTRIBUTION_LEDGER_VERSION,
    lines: outputLines,
    entries: sortEntries(entries),
    recognizedIncomeByCurrency,
    receivablesByCurrency,
    paidDistributionsByCurrency,
    diagnostics: {
      inputEvents: request.events.length,
      appliedEntitlements,
      appliedRevisions,
      appliedPayments,
      futureEntitlementsExcluded,
      futureRevisionsExcluded,
      futurePaymentsExcluded,
    },
  };
}

export function distributionCashForRebalance(
  ledger: DistributionLedgerResult,
  request: DistributionCashForRebalanceRequest,
): DistributionCashForRebalance {
  assertCurrency(request.currency, "rebalance currency");
  if (!isIsoDate(request.rebalanceDate)) {
    throw new Error(`rebalanceDate must be an ISO date; received ${request.rebalanceDate}.`);
  }
  if (request.rebalanceDate > ledger.decisionDate) {
    throw new Error(
      `rebalanceDate ${request.rebalanceDate} is after ledger decisionDate ${ledger.decisionDate}.`,
    );
  }
  if (request.previousRebalanceDate !== undefined) {
    if (!isIsoDate(request.previousRebalanceDate)) {
      throw new Error(
        `previousRebalanceDate must be an ISO date; received ${request.previousRebalanceDate}.`,
      );
    }
    if (request.previousRebalanceDate >= request.rebalanceDate) {
      throw new Error("previousRebalanceDate must be before rebalanceDate.");
    }
  }

  const payments = ledger.entries.filter((entry) => (
    entry.type === "distribution_payment"
    && entry.currency === request.currency
    && entry.recognitionDate <= request.rebalanceDate
    && (
      request.previousRebalanceDate === undefined
      || entry.recognitionDate > request.previousRebalanceDate
    )
  ));
  return {
    currency: request.currency,
    previousRebalanceDate: request.previousRebalanceDate,
    rebalanceDate: request.rebalanceDate,
    amount: payments.reduce((sum, entry) => sum + entry.cashDelta, 0),
    paymentEventIds: payments.map((entry) => entry.ledgerEventId),
  };
}

function distributionIncomeInHorizon(
  ledger: DistributionLedgerResult,
  code: string,
  currency: string,
  startExclusive: string,
  endInclusive: string,
): number {
  let income = 0;
  const foreignCurrencies = new Set<string>();
  for (const entry of ledger.entries) {
    if (entry.code !== code) continue;
    if (
      entry.recognitionDate <= startExclusive
      || entry.recognitionDate > endInclusive
      || entry.economicIncomeDelta === 0
    ) {
      continue;
    }
    if (entry.currency !== currency) {
      foreignCurrencies.add(entry.currency);
      continue;
    }
    income += entry.economicIncomeDelta;
  }
  if (foreignCurrencies.size > 0) {
    throw new Error(
      `Point-in-Time FX conversion is required for forecast distributions in: ${[...foreignCurrencies].sort().join(", ")}.`,
    );
  }
  return income;
}

export function scorePositiveEtfForecast(
  request: PositiveForecastScoreRequest,
): PositiveForecastScore {
  assertNonEmpty(request.code, "forecast code");
  assertCurrency(request.currency, "forecast currency");
  if (
    !isIsoDate(request.horizonStartExclusive)
    || !isIsoDate(request.horizonEndInclusive)
    || request.horizonStartExclusive >= request.horizonEndInclusive
  ) {
    throw new Error("Forecast horizon dates must be valid and ordered.");
  }
  if (request.horizonEndInclusive > request.distributionLedger.decisionDate) {
    throw new Error(
      `Forecast horizon end ${request.horizonEndInclusive} is after ledger decisionDate ${request.distributionLedger.decisionDate}.`,
    );
  }
  assertPositive(request.startingEquity, "startingEquity");
  if (!Number.isFinite(request.pricePnl)) throw new Error("pricePnl must be finite.");
  const cashReturnPnl = request.cashReturnPnl ?? 0;
  if (!Number.isFinite(cashReturnPnl)) throw new Error("cashReturnPnl must be finite.");
  assertNonNegative(request.transactionCosts, "transactionCosts");
  assertNonNegative(request.fxConversionCosts, "fxConversionCosts");

  const distributionIncome = distributionIncomeInHorizon(
    request.distributionLedger,
    request.code,
    request.currency,
    request.horizonStartExclusive,
    request.horizonEndInclusive,
  );
  const grossPnlBeforeCosts = request.pricePnl + distributionIncome + cashReturnPnl;
  const totalModeledCosts = request.transactionCosts + request.fxConversionCosts;
  const netPnl = grossPnlBeforeCosts - totalModeledCosts;
  return {
    code: request.code,
    currency: request.currency,
    pricePnl: request.pricePnl,
    distributionIncome,
    cashReturnPnl,
    grossPnlBeforeCosts,
    transactionCosts: request.transactionCosts,
    fxConversionCosts: request.fxConversionCosts,
    totalModeledCosts,
    netPnl,
    netReturn: netPnl / request.startingEquity,
    outcome: netPnl > 0 ? "hit" : "miss",
  };
}
