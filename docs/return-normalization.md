# Return Normalization Foundation v1 / Point-in-Time runner integration

Status: implemented foundation. D-018 approves the primary research policy; virtual-portfolio cash accounting is defined separately in `distribution-accounting.md`.

## Purpose

The repository previously used AdjustedClose without an explicit statement of what the provider adjustment contained. This foundation separates source-price labels from normalized Price Return and Total Return series.

It does not approve a final market-data provider. The approved primary research policy is explicit ex-date close reinvestment; pay-date remains a robustness comparison path.

## Return-basis labels

### Existing backtest CLI inputs

- unadjusted_price: use the CSV/provider Close field directly.
- provider_adjusted: require and use AdjustedClose, but make no claim that it is dividend-aware or suitable as final Total Return evidence.

The current Stooq adapter returns only unadjusted closes and therefore accepts only unadjusted_price.

The CLI does not accept total_return as a label for ordinary CSV input. A series must pass the explicit normalization contract before it can be called Total Return.

The CLI output schema is `backtest-summary-v3`. Ordinary raw CSV/Stooq runs report `returnNormalization.status=not_normalized` with a visible warning. Normalized `price_return` / `total_return` are explicit opt-in paths. The portfolio-level performance output is named cumulativePortfolioReturn; it is not evidence that the input data used a Total Return basis.

### Normalized series

- price_return: uses raw Close, requires complete Corporate Action coverage, normalizes split/reverse-split unit changes, and excludes cash distributions.
- total_return: adds cash distributions to the normalized price path and requires complete distribution coverage plus an explicit TotalReturnPolicy.

Both normalized series start at an index value of 100. They preserve available volume and trading-value fields and can be converted to DailyBar records with normalizedReturnSeriesToDailyBars for later frame-builder integration.

## Event and provenance contract

Every event has:

- a stable eventId;
- instrument code;
- availableAt, with an explicit timezone;
- source, dataset, retrieval timestamp, optional source version, and optional source record ID.

Supported events:

- cash distributions with ex-date, optional pay-date, amount per unit, and currency;
- splits and reverse splits through newUnitsPerOldUnit.

Other Corporate Actions are represented as unsupported and fail normalization. They are never approximated as splits or cash.

Coverage metadata explicitly states whether Corporate Action and distribution coverage are complete or unavailable, together with the date range and provenance. Declaring coverage complete is a data-provider responsibility and must later be cross-checked.

Normalized output retains each applied event ID, recognition date, availability time, and record provenance for later audit.

## Point-in-Time rules

For a requested decisionDate:

1. Bars after the decision date are excluded and counted in diagnostics.
2. Events whose recognition date is after the decision date are excluded and counted.
3. A relevant event must have been available by both the decision date and its selected recognition date.
4. Coverage must span every normalized bar.
5. Price Return requires complete Corporate Action coverage.
6. Total Return additionally requires complete distribution coverage.
7. A distribution in a different currency requires exact-date Point-in-Time FX conversion.
8. An event on the first bar fails because no prior close exists for a return calculation.
9. The selected recognition date must have a bar; same-day close is never approximated with a later price.
10. Split and distribution events sharing one recognition date fail until ordering is explicitly modeled.
11. Monthly signal and forward snapshots use each asset's actual last trading date, not a later calendar-day cutoff.
12. A forward snapshot pins the complete signal-time bar/FX prefix; a later revision cannot replace the historical entry observation.
13. All monthly backtest configs reject a partial final month rather than annualizing it as a complete month.

These constraints deliberately prefer a visible failure over a plausible-looking but unreproducible return series.

## Calculation

For each pair of consecutive bars:

1. Start with one unit of the instrument.
2. Apply intervening split ratios in chronological order.
3. Under Total Return, accumulate distributions using the units held at each event.
4. Calculate the interval factor as:

    (current close × resulting units + recognized cash) ÷ previous close

For Price Return, recognized cash is zero. The factors compound into the normalized index.

## Explicit policy boundary

Total Return still has no silent default. Callers must record `APPROVED_RESEARCH_TOTAL_RETURN_POLICY_ID` and explicitly use `APPROVED_RESEARCH_TOTAL_RETURN_POLICY`, which selects:

- distributionRecognition: ex_date;
- reinvestment: same_day_close.

The implementation retains pay-date recognition for reproducible robustness comparison, but it is not the primary research policy. Neither path represents spendable portfolio cash; that state is handled by `src/portfolio/distribution-ledger.ts` under D-018. A completed non-JPY local-currency series may then be converted by the separate Point-in-Time layer in `src/data/fx-normalization.ts`.

## Known limitations

- decisionDate is an end-of-day UTC boundary in v1; exchange-specific close timestamps and calendars are not modeled yet.
- Calendar-month completeness is required at the config boundary, while production exchange-calendar completeness still requires an approved provider/calendar adapter.
- Distribution amount availability before ex-date may be unavailable for some sources; strict Point-in-Time validation will reject those cases.
- Trust/management fees embedded in NAV are not separated or added again.
- Taxes are not modeled.
- JPY FX conversion is a separate post-normalization layer; the final provider and exchange-calendar alignment policy remain unresolved.
- Stock distributions, mergers, tender offers, spin-offs, and other non-split actions are unsupported.
- Multiple-source reconciliation and production-provider coverage verification are not implemented.
- Current Trend/Rotation CLI fixtures remain synthetic unadjusted Price data and are not investment evidence.
- Normalized Trend/Rotation configs use the synthetic-only `synthetic_same_day_close_v1` fixture; the normalized path is research evidence of implementation behavior, not investable performance.
- Full runner integration is covered by `backtest-summary-v3`; production-provider selection and `etf_realistic` remain out of scope.
