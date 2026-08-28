# Strategy A/B Robustness Grid

## Purpose

`src/backtest/robustness-grid.ts` runs a deterministic Cartesian grid and reports the complete result surface. It does not select the best historical cell or convert provisional parameters into approved policy.

```bash
bun run robustness --config=tests/fixtures/configs/robustness-grid.json
```

## Supported axes

- Strategy A 3M/6M/12M weights and positive-12M filter flag.
- Strategy B 6M/12M/volatility weights and positive-12M filter flag.
- modeled one-way transaction-cost rate;
- maximum holdings, within the approved hard maximum of three;
- volatility window, from 2 to 252 observations.

Weights must be finite, non-negative, and sum to one. The existing `0.20/0.30/0.50` and `0.40/0.40/-0.20` formulas remain the defaults; other cells are experiments, not adopted values.

## Fixed-only axes

The current executable path supports only:

- `month_end_close` signal/return frames;
- `immediate_top_n` replacement.

Requested calendar-day, next-open, hysteresis, minimum-holding-period, or no-trade-band variants are never routed through the month-end/immediate result silently. Each affected cell is returned as `unsupported` with a reason code and no performance result.

## Output

`robustness-grid-v2` records:

- `evidenceDisposition=research_only`, the input return basis, and an explicit `not_normalized` warning;
- canonical scenario and input fingerprints;
- exact strategy versions and parameters;
- data layer and input artifact/Universe observation IDs;
- completed/unsupported counts;
- cumulative return, CAGR, volatility, Sharpe, Sortino, maximum drawdown, gross turnover, modeled costs, cash ratio, worst month, and worst year with `observedMonths` / `complete` metadata;
- actual loaded-bar content hashes and the strict Universe-master fingerprint;
- realized-return month labels and corrected worst-month/worst-year and hard-stop labels;
- per-strategy min/median/max ranges, positive-return rate, and hard-stop rate;
- per-axis/value completion counts and metric ranges for weights, costs, holding limits, volatility windows, and fixed-only axes.

Annualized metrics require consecutive complete monthly labels. A calendar gap or partial final month stops execution instead of treating an incomplete or separated observation as a full adjacent month. Partial first/last calendar years remain visible in worst-year output with `complete=false` and their observed-month count. A month with sufficient signal history but no eligible instrument is retained as an explicit cash frame. `cashRatio` is the mean cash allocation used during each return period; liquidation triggered at the end of that period affects subsequent periods.

There is deliberately no `bestScenario`, composite score, pass threshold, or automatic parameter adoption. O-005, O-006, and O-011 remain open.

The current grid does not yet implement horizon-family changes, long-trend gates, walk-forward/holdout splits, nearby execution dates, next-open execution, hysteresis, minimum holding periods, or no-trade bands. Unsupported timing/replacement cells can be enumerated without loading market data. The remaining axes are the next implementation block after review of the current normalized Point-in-Time integration.

## Synthetic fixture result

The committed baseline grid expands to 32 cells: 16 executable cells and 16 explicitly unsupported calendar-day cells. Every executable cell uses the same deliberately adverse synthetic unadjusted Price fixture, reaches the hard stop in `2025-02`, and ends in cash. This result validates calculation and reporting paths only; it is not investment evidence and is not evidence that either strategy is robust in real markets.
