# Distribution Accounting v1

Status: approved under D-018 on 2026-08-26.

## Two separate accounting layers

### Research Total Return

Research and signal series recognize cash distributions on ex-date and theoretically reinvest them at the same day's close. Callers must explicitly record `APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID` and pass `APPROVED_RESEARCH_TOTAL_RETURN_POLICY`; the code does not silently infer Total Return from `AdjustedClose` or make the policy implicit.

The alternative pay-date path remains available for robustness comparison, but it is not the approved primary research series.

### Virtual-portfolio ledger

The executable ledger follows the investor's economic and cash states separately:

1. On ex-date, create a distribution receivable from units entitled and the amount known at that time.
2. If the amount changes, post a revision only when that revision becomes available.
3. On pay-date, move the receivable to spendable cash. Payment creates no second income event.
4. Do not automatically buy units on ex-date or pay-date. Paid cash becomes eligible for allocation at the next scheduled monthly rebalance or another independently approved trade event.

This keeps an unpaid entitlement in portfolio equity without pretending it can already fund an order.

## Point-in-Time amount handling

An entitlement amount must be available by ex-date. When the final amount is not yet known, use a source-labeled estimate. A later final amount is a new revision entry with its own availability time and provenance.

Later final data never replaces the earlier estimate in a historical snapshot. A payment that differs from the current receivable requires an explicit revision. A distribution that reaches pay-date without a payment event fails closed.

## Forecast scoring

Positive ETF forecasts use:

    price P&L
    + distribution income recognized during the forecast horizon
    + cash return P&L
    - transaction costs
    - FX-conversion costs

A positive forecast is a hit only when the resulting net P&L is greater than zero. Moving a distribution from receivable to cash does not change forecast income.

Foreign-currency distribution income enters JPY scoring only when an explicit Point-in-Time FX book provides the exact recognition-date rate for every dated entry. The score records the applied FX observation IDs. Missing rates still fail closed.

## Fees and taxes

ETF trust or management fees deducted from trust assets are already reflected in NAV and market prices, so the return calculation does not subtract them again. Disclosed fee rates remain metadata for product-quality and tracking analysis.

This version records gross distribution income before investor-specific tax. Source withholding and Japanese account taxation require explicit, separately labeled treatment; O-016 remains open.

## Implementation

- `src/data/return-normalization.ts`: approved ex-date research Total Return policy and index path.
- `src/portfolio/distribution-ledger.ts`: entitlement, revision, payment, rebalance-cash, and forecast-scoring logic.
- `tests/fixtures/distribution-ledger/events.json`: deterministic synthetic event history.
- `tests/distribution-ledger.test.ts`: Point-in-Time and accounting regression coverage.

## Evidence used for D-018

- [MSCI Index Calculation Methodology](https://www.msci.com/eqb/methodology/meth_docs/MSCI_Index_Calculation_Methodology_Feb2026.pdf): daily Total Return indexes reinvest regular cash distributions on ex-date and distinguish gross and net series.
- [JPX Total Return Index methodology](https://www.jpx.co.jp/english/rules-participants/public-comment/detail/d3/b5b4pj000001bcti-att/e4.pdf): gross dividends are reflected on ex-date using the then-available estimate, followed by later adjustments for actual amounts.
- [JPX explanation of ETF risks](https://www.jpx.co.jp/english/equities/products/etfs/risk/): expected dividends may be posted as accrued dividends in ETF NAV and are distributed later.
- [JPX ETF FAQ](https://www.jpx.co.jp/english/faq/listed_product.html): trust fees are deducted from daily trust assets at a per-diem rate.

## Known limits

- Event-day processing is end-of-day UTC; exchange calendars and intraday settlement times are not modeled.
- Entitled units are currently supplied to the ledger; deriving them from Point-in-Time orders, positions, and settlement is not implemented.
- Partial payments, payment reversals, stock distributions, and post-payment corrections are unsupported and fail closed.
- Production event sources and cross-source reconciliation are not implemented.
- Event-level Point-in-Time JPY conversion is implemented, but foreign receivable/cash revaluation between events is not integrated into the full position simulator.
