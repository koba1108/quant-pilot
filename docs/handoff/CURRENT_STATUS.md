# Current Status

Snapshot date: 2026-08-26

## Repository state

- Repository: `koba1108/quant-pilot`
- Local checkout: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Active branch: `feat/market-data-backtest`
- Pull request: `#1 feat: add market data providers and runnable backtests`
- PR state at handoff: open, draft, mergeable

## Implemented on the base project

### Strategy

- `src/strategies/trend.ts` — Strategy A trend ranking
- `src/strategies/rotation.ts` — Strategy B cross-asset rotation ranking
- `src/strategies/types.ts` — normalized strategy inputs and ranking output

### Portfolio and risk

- `src/portfolio/allocator.ts` — inverse-volatility allocation
- `src/portfolio/costs.ts` — turnover-aware execution-cost model
- `src/portfolio/risk.ts` — maximum drawdown and hard-stop logic

### Data primitives

- `src/data/models.ts` — normalized bars, universe members, quote quality, and eligibility policy
- `src/data/universe.ts` — point-in-time universe eligibility primitives

### Backtest core

- `src/backtest/simulator.ts` — monthly compounding simulation
- `src/backtest/metrics.ts` — cumulative return, CAGR, volatility, Sharpe, and Sortino calculations

### Existing tests

- `tests/core.test.ts`
- `tests/data-costs.test.ts`
- `tests/simulator.test.ts`

## Added in PR #1

- `src/data/provider.ts` — `MarketDataProvider` interface and bar validation
- `src/data/csv.ts` — CSV fallback provider
- `src/data/stooq.ts` — Stooq research provider
- `src/backtest/frame-builder.ts` — daily bars to monthly snapshots/forward returns
- `src/backtest/runner.ts` — config-driven CLI for Strategy A/B
- `backtest.config.example.json` — example configuration
- `tests/frame-builder.test.ts` — frame construction coverage
- `README.md` — backtest usage and data caveats
- `package.json` — package name corrected to `quant-pilot`

## Verification status

The PR branch has not been executed inside the ChatGPT environment. The PR description explicitly requires local verification before merge.

Required local checks:

```bash
cd /Users/ykoba/IdeaProjects/quant-pilot
git fetch origin
git switch feat/market-data-backtest
bun install
bun test
```

Then run a reproducible fixture-backed backtest:

```bash
cp backtest.config.example.json backtest.config.json
bun run backtest --config=backtest.config.json
```

Do not merge PR #1 until the tests and at least one Strategy A and Strategy B CLI run have been verified locally.

## Known limitations and risks

### Data correctness

- Stooq is currently a research OHLCV source, not approved final total-return evidence.
- Distribution and ex-dividend normalization are not complete.
- JPY conversion for overseas assets is not implemented.
- Cross-source reconciliation is not implemented.
- Data licensing, retention, and reproducibility for the final provider remain unresolved.

### Universe correctness

- The runner currently accepts assets from config rather than loading `universe_master.csv` as the source of truth.
- Listing/delisting bounds are applied from config, but the complete historical ETF master is not yet wired into the runner.
- Survivorship-bias controls require a maintained point-in-time universe and delisting history.

### Backtest completeness

- Robustness-grid execution is not implemented.
- Rebalance-date and replacement/hysteresis comparisons are not implemented.
- Cash return is currently simplified.
- Exact total-return cost treatment and management-fee handling require final data decisions.
- Strategy C is specified but not implemented.

### Operations

- Forward-test persistence, scheduled monthly execution, decision-package storage, notifications, and dashboard are not implemented.
- No brokerage or real-order connection exists and none should be added in the current phase.

## Next implementation sequence

### P0 — Validate PR #1

1. Run all tests locally.
2. Run the CSV path with a controlled fixture.
3. Run both `trend` and `rotation` strategies.
4. Check date boundaries, insufficient-history behavior, error messages, and output reproducibility.
5. Fix defects and update PR verification notes.

### P1 — Make data financially correct

1. Define and implement total-return/distribution normalization.
2. Add JPY FX normalization for non-JPY assets.
3. Implement a `universe_master.csv` loader with point-in-time filtering.
4. Add data-quality reports and cross-source comparison hooks.
5. Preserve raw input provenance and normalized-output versioning.

### P2 — Make research robust

1. Add parameter-grid execution for Strategy A/B.
2. Add rebalance-date and turnover-rule sensitivity tests.
3. Add crisis-period, worst-month/year, cash-ratio, and benchmark-correlation reporting.
4. Select candidates by robustness and distinct behavior, not peak return.

### P3 — Build Strategy C and forward testing

1. Define the complete decision-package schema.
2. Implement Portfolio Manager, Macro Analyst, and Risk/Critic interfaces.
3. Add evidence timestamps, source confidence, contrary evidence, and thesis expiry.
4. Add virtual portfolio persistence and monthly scheduling.
5. Build the one-minute dashboard and detailed drill-down report.
