# Point-in-Time JPY FX Normalization v1

Status: provider-neutral implementation foundation under active decisions D-006, D-011, and D-014.

## Purpose

Quant Pilot measures the outcome of non-JPY assets in JPY without treating currency exposure as a separate speculative FX position. This layer converts an already normalized local-currency Price Return or Total Return series into an unhedged JPY return series.

It does not select the final FX provider. O-001 remains open.

## Explicit quote contract

Every observation states:

- `sourceCurrency`: the currency being valued;
- `targetCurrency`: the reporting currency;
- `targetCurrencyPerSourceUnit`: target-currency units for one source-currency unit;
- `quoteConvention`: `target_currency_per_source_currency`.

For USD to JPY, a value of `150` means JPY 150 per USD 1. The implementation never silently inverts a quote or constructs a cross rate. A provider adapter may later emit an explicitly derived observation, but that record must carry its own timestamp and provenance.

## Return calculation

For each exact trading date:

    JPY return = (1 + local return) * (1 + FX return) - 1

The FX return is calculated from rates quoted in JPY per one unit of the source currency. The first JPY index point keeps the source index's starting level; subsequent points compound the combined local and FX return.

Local trading value is multiplied by the same dated FX rate and exposed as `tradingValueJpy`. Volume is not currency-converted.

## Point-in-Time rules

- `rateDate`, `observedAt`, `availableAt`, and source provenance are mandatory.
- The rate book selects only observations available by its `decisionDate` end-of-day UTC cutoff.
- A correction for an earlier `rateDate` must explicitly supersede the prior observation. Earlier decision snapshots keep the prior value; later snapshots may use the correction once available.
- When a forward return is evaluated, all FX observations through the signal snapshot are pinned. Corrections available later may inform later signals, but cannot retroactively replace the entry prefix.
- Every asset point and every converted distribution-income entry requires an exact-date rate.
- Missing dates fail closed. Forward-fill, backfill, prior-month substitution, implicit inversion, and implicit triangulation are forbidden.
- The FX rate-book `decisionDate` must match the normalized return series or distribution ledger being evaluated.

Exact-date matching is intentionally conservative until exchange calendars and an approved provider-specific fixing policy exist.

## Distributions and forecast scoring

Foreign-currency distribution income is converted entry by entry on its economic recognition date:

- entitlement amount on ex-date;
- later estimate/final revision delta on the revision availability date;
- payment remains a receivable-to-cash transfer and creates no second income event.

The forecast score returns the FX observation IDs used. Reference-rate conversion does not itself model an executable currency trade. `fxConversionCosts` remains a separate explicit cost input.

## Reference rate versus execution rate

Reference or midpoint rates support valuation and research. They are not assumed to be executable prices. Bid/offer spread, broker markup, fees, timing, and conversion mechanics belong in the execution-cost layer.

## Implementation

- `src/data/fx-normalization.ts`: versioned rate book, revision selection, exact-date amount conversion, JPY return conversion, and DailyBar adapter.
- `src/data/point-in-time-return-source.ts`: provider-neutral signal/forward snapshots, pinned historical prefixes, and full input/resolution fingerprints for normalized runner integration.
- `src/portfolio/distribution-ledger.ts`: optional Point-in-Time FX books for selected-ETF distribution scoring.
- `tests/fixtures/fx-normalization/rates.json`: deterministic synthetic USD/JPY observations and revisions.
- `tests/fx-normalization.test.ts`: return, revision, missing-rate, quote-direction, provenance, and distribution-scoring regression coverage.

## Official methodology references

- [S&P Dow Jones Indices — Index Mathematics Methodology](https://www.spglobal.com/spdji/en/documents/methodologies/methodology-index-math.pdf): unhedged return combines local Total Return and currency return multiplicatively.
- [Bank of Japan — Foreign Exchange Rates (Daily)](https://www.boj.or.jp/en/statistics/market/forex/fxdaily/index.htm): daily spot observations are time-specific midpoint rates, may be revised or corrected, and documented cross-rate calculation is explicit.
- [ECB — Euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html): reference rates have stated publication timing and are for information rather than transaction execution.

## Known limits

- No production FX provider or CSV adapter is selected or connected.
- The cutoff model is end-of-day UTC; exchange-specific closes and intraday decisions are not modeled.
- Holiday/calendar alignment has no fallback policy. A missing exact-date rate stops the affected conversion.
- Foreign-currency receivable and cash revaluation between ledger events is not yet integrated into the full position simulator.
- Raw Trend/Rotation CLI paths remain synthetic unadjusted JPY fixtures and do not invoke this normalization path. Explicit normalized configs do invoke it, using `synthetic_same_day_close_v1`; they remain research-only and not investment evidence.
- Executable FX spreads and broker conversion mechanics remain modeled separately through explicit cost assumptions.
