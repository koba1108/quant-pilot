import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDistributionLedger,
  distributionCashForRebalance,
  scorePositiveEtfForecast,
  type DistributionLedgerEvent,
} from "../src/portfolio/distribution-ledger.ts";

interface DistributionLedgerFixture {
  events: DistributionLedgerEvent[];
}

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/distribution-ledger/events.json", import.meta.url), "utf8"),
) as DistributionLedgerFixture;

function events(): DistributionLedgerEvent[] {
  return structuredClone(fixture.events);
}

test("ex-date creates an economic entitlement without spendable cash", () => {
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-06", events: events() });

  assert.equal(ledger.lines.length, 1);
  assert.equal(ledger.lines[0]!.status, "receivable");
  assert.equal(ledger.recognizedIncomeByCurrency.JPY, 10);
  assert.equal(ledger.receivablesByCurrency.JPY, 10);
  assert.equal(ledger.paidDistributionsByCurrency.JPY, undefined);
  assert.equal(ledger.entries[0]!.economicIncomeDelta, 10);
  assert.equal(ledger.entries[0]!.cashDelta, 0);
  assert.equal(ledger.diagnostics.futureEntitlementsExcluded, 1);
});

test("a post-ex-date final amount revision changes the receivable only when available", () => {
  const beforeRevision = buildDistributionLedger({ decisionDate: "2025-01-07", events: events() });
  const afterRevision = buildDistributionLedger({ decisionDate: "2025-01-08", events: events() });

  assert.equal(beforeRevision.receivablesByCurrency.JPY, 10);
  assert.equal(afterRevision.receivablesByCurrency.JPY, 12);
  assert.equal(afterRevision.lines[0]!.amountStatus, "final");
  assert.deepEqual(afterRevision.lines[0]!.appliedRevisionIds, ["revision-q1-final"]);
  assert.equal(afterRevision.entries[1]!.economicIncomeDelta, 2);
});

test("an ex-date intraday revision is retained in the end-of-day ledger", () => {
  const sameDay = events();
  const revision = sameDay.find((event) => event.ledgerEventId === "revision-q1-final");
  assert.equal(revision?.type, "distribution_revision");
  if (revision?.type === "distribution_revision") {
    revision.availableAt = "2025-01-06T12:00:00Z";
  }

  const ledger = buildDistributionLedger({ decisionDate: "2025-01-06", events: sameDay });

  assert.equal(ledger.receivablesByCurrency.JPY, 12);
  assert.deepEqual(
    ledger.entries.map((entry) => entry.recognitionDate),
    ["2025-01-06", "2025-01-06"],
  );
});

test("pay-date moves the receivable to cash without creating income twice", () => {
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events: events() });

  assert.equal(ledger.recognizedIncomeByCurrency.JPY, 12);
  assert.equal(ledger.receivablesByCurrency.JPY, undefined);
  assert.equal(ledger.paidDistributionsByCurrency.JPY, 12);
  assert.equal(ledger.lines[0]!.status, "paid");
  assert.deepEqual(
    ledger.entries.map((entry) => [entry.type, entry.economicIncomeDelta, entry.receivableDelta, entry.cashDelta]),
    [
      ["distribution_entitlement", 10, 10, 0],
      ["distribution_revision", 2, 2, 0],
      ["distribution_payment", 0, -12, 12],
    ],
  );
});

test("only paid cash is available at a scheduled rebalance", () => {
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events: events() });
  const beforePayment = distributionCashForRebalance(ledger, {
    currency: "JPY",
    rebalanceDate: "2025-01-09",
  });
  const monthEnd = distributionCashForRebalance(ledger, {
    currency: "JPY",
    previousRebalanceDate: "2024-12-31",
    rebalanceDate: "2025-01-31",
  });

  assert.equal(beforePayment.amount, 0);
  assert.equal(monthEnd.amount, 12);
  assert.deepEqual(monthEnd.paymentEventIds, ["payment-q1"]);
});

test("positive forecast scoring includes accrued distribution income and modeled costs", () => {
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events: events() });
  const score = scorePositiveEtfForecast({
    code: "ETF",
    currency: "JPY",
    horizonStartExclusive: "2024-12-31",
    horizonEndInclusive: "2025-01-31",
    startingEquity: 1000,
    pricePnl: -5,
    transactionCosts: 1,
    fxConversionCosts: 1,
    distributionLedger: ledger,
  });

  assert.equal(score.distributionIncome, 12);
  assert.equal(score.grossPnlBeforeCosts, 7);
  assert.equal(score.totalModeledCosts, 2);
  assert.equal(score.netPnl, 5);
  assert.equal(score.netReturn, 0.005);
  assert.equal(score.outcome, "hit");
});

test("a distribution reaching pay-date without explicit payment fails closed", () => {
  const withoutPayment = events().filter((event) => event.ledgerEventId !== "payment-q1");

  assert.throws(
    () => buildDistributionLedger({ decisionDate: "2025-01-10", events: withoutPayment }),
    /without a payment event/,
  );
});

test("payment mismatches require an explicit revision", () => {
  const mismatched = events();
  const payment = mismatched.find((event) => event.ledgerEventId === "payment-q1");
  assert.equal(payment?.type, "distribution_payment");
  if (payment?.type === "distribution_payment") payment.grossAmount = 13;

  assert.throws(
    () => buildDistributionLedger({ decisionDate: "2025-01-31", events: mismatched }),
    /explicit revision is required/,
  );
});

test("an amount unavailable by ex-date cannot be applied retroactively", () => {
  const late = events();
  const entitlement = late.find((event) => event.ledgerEventId === "entitlement-q1");
  assert.equal(entitlement?.type, "distribution_entitlement");
  if (entitlement?.type === "distribution_entitlement") {
    entitlement.availableAt = "2025-01-07T00:00:00Z";
  }

  assert.throws(
    () => buildDistributionLedger({ decisionDate: "2025-01-31", events: late }),
    /not available by ex-date/,
  );
});

test("future distributions cannot change a prior ledger snapshot", () => {
  const baseline = buildDistributionLedger({ decisionDate: "2025-01-06", events: events() });
  const changed = events();
  const future = changed.find((event) => event.ledgerEventId === "entitlement-q2");
  assert.equal(future?.type, "distribution_entitlement");
  if (future?.type === "distribution_entitlement") future.amountPerUnit = 999999;

  const changedFuture = buildDistributionLedger({ decisionDate: "2025-01-06", events: changed });
  assert.deepEqual(changedFuture.lines, baseline.lines);
  assert.deepEqual(changedFuture.entries, baseline.entries);
  assert.deepEqual(changedFuture.recognizedIncomeByCurrency, baseline.recognizedIncomeByCurrency);
});

test("event input ordering does not change ledger output", () => {
  const baseline = buildDistributionLedger({ decisionDate: "2025-01-31", events: events() });
  const reversed = buildDistributionLedger({ decisionDate: "2025-01-31", events: events().reverse() });

  assert.deepEqual(reversed, baseline);
});

test("revision ordering uses absolute timestamps rather than timezone-formatted text", () => {
  const offsetEvents = events();
  const finalRevision = offsetEvents.find((event) => event.ledgerEventId === "revision-q1-final");
  assert.equal(finalRevision?.type, "distribution_revision");
  if (finalRevision?.type === "distribution_revision") {
    finalRevision.availableAt = "2025-01-08T01:00:00Z";
  }
  offsetEvents.push({
    type: "distribution_revision",
    ledgerEventId: "revision-q1-earlier",
    distributionId: "etf-q1-2025",
    revisedAmountPerUnit: 1.1,
    amountStatus: "estimated",
    availableAt: "2025-01-08T09:00:00+09:00",
    provenance: structuredClone(offsetEvents[0]!.provenance),
  });

  const ledger = buildDistributionLedger({ decisionDate: "2025-01-08", events: offsetEvents });

  assert.equal(ledger.lines[0]!.amountPerUnit, 1.2);
  assert.deepEqual(
    ledger.lines[0]!.appliedRevisionIds,
    ["revision-q1-earlier", "revision-q1-final"],
  );
});

test("forecast scoring rejects foreign distribution income until Point-in-Time FX exists", () => {
  const withForeign = events();
  const provenance = structuredClone(withForeign[0]!.provenance);
  withForeign.push(
    {
      type: "distribution_entitlement",
      ledgerEventId: "entitlement-eur",
      distributionId: "etf-eur-2025",
      code: "ETF-EUR",
      exDate: "2025-01-15",
      payDate: "2025-01-20",
      entitledUnits: 1,
      amountPerUnit: 2,
      amountStatus: "final",
      currency: "EUR",
      availableAt: "2025-01-14T00:00:00Z",
      provenance,
    },
    {
      type: "distribution_payment",
      ledgerEventId: "payment-eur",
      distributionId: "etf-eur-2025",
      payDate: "2025-01-20",
      grossAmount: 2,
      currency: "EUR",
      availableAt: "2025-01-20T00:00:00Z",
      provenance,
    },
  );
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events: withForeign });

  assert.throws(
    () => scorePositiveEtfForecast({
      code: "ETF-EUR",
      currency: "JPY",
      horizonStartExclusive: "2024-12-31",
      horizonEndInclusive: "2025-01-31",
      startingEquity: 1000,
      pricePnl: 0,
      transactionCosts: 0,
      fxConversionCosts: 0,
      distributionLedger: ledger,
    }),
    /Point-in-Time FX conversion is required.*EUR/,
  );
});

test("ETF forecast scoring excludes distributions belonging to other instruments", () => {
  const withOtherAsset = events();
  const provenance = structuredClone(withOtherAsset[0]!.provenance);
  withOtherAsset.push(
    {
      type: "distribution_entitlement",
      ledgerEventId: "entitlement-other",
      distributionId: "other-q1-2025",
      code: "OTHER",
      exDate: "2025-01-15",
      payDate: "2025-01-20",
      entitledUnits: 1,
      amountPerUnit: 100,
      amountStatus: "final",
      currency: "JPY",
      availableAt: "2025-01-14T00:00:00Z",
      provenance,
    },
    {
      type: "distribution_payment",
      ledgerEventId: "payment-other",
      distributionId: "other-q1-2025",
      payDate: "2025-01-20",
      grossAmount: 100,
      currency: "JPY",
      availableAt: "2025-01-20T00:00:00Z",
      provenance,
    },
  );
  const ledger = buildDistributionLedger({ decisionDate: "2025-01-31", events: withOtherAsset });

  const score = scorePositiveEtfForecast({
    code: "ETF",
    currency: "JPY",
    horizonStartExclusive: "2024-12-31",
    horizonEndInclusive: "2025-01-31",
    startingEquity: 1000,
    pricePnl: 0,
    transactionCosts: 0,
    fxConversionCosts: 0,
    distributionLedger: ledger,
  });

  assert.equal(score.distributionIncome, 12);
});
