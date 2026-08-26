# Current Status

Snapshot date: 2026-08-26

## Repository state

- Repository: `koba1108/quant-pilot`
- Local checkout: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- PR #1: merged
- Merge commit: `5b161573419bccd83cd82400fb31110d99651fe1`
- PR #2: merged (`docs: add Codex Project migration instructions`)
- Validation branch: `fix/validate-market-data-backtest`

## Implemented on main

### Strategy

- `src/strategies/trend.ts` — Strategy A trend ranking
- `src/strategies/rotation.ts` — Strategy B cross-asset rotation ranking
- `src/strategies/types.ts` — normalized strategy inputs and ranking output

### Portfolio and risk

- `src/portfolio/allocator.ts` — inverse-volatility allocation
- `src/portfolio/costs.ts` — turnover-aware execution-cost model
- `src/portfolio/risk.ts` — maximum drawdown and hard-stop logic

### Data

- `src/data/models.ts` — normalized bars, universe members, quote quality, and eligibility policy
- `src/data/universe.ts` — point-in-time universe eligibility primitives
- `src/data/provider.ts` — `MarketDataProvider` interface and bar validation
- `src/data/csv.ts` — CSV fallback provider
- `src/data/stooq.ts` — Stooq research provider

### Backtest

- `src/backtest/simulator.ts` — monthly compounding simulation
- `src/backtest/metrics.ts` — cumulative return, CAGR, volatility, Sharpe, and Sortino calculations
- `src/backtest/frame-builder.ts` — daily bars to monthly snapshots and forward returns
- `src/backtest/runner.ts` — config-driven CLI for Strategy A/B
- `backtest.config.example.json` — example configuration

### Tests present in repository

- `tests/core.test.ts`
- `tests/data-costs.test.ts`
- `tests/simulator.test.ts`
- `tests/frame-builder.test.ts`

## Added on the validation branch

- commit-safe synthetic CSV data and Trend/Rotation configs under `tests/fixtures/`
- strict runtime validation for backtest configuration and daily bars
- explicit per-asset CLI diagnostics for loaded date bounds and history exclusion
- a hard maximum of three holdings at both config and simulator boundaries
- fail-closed behavior for missing held-asset returns and transaction-cost rates
- hard-stop liquidation with exit cost and explicit ending cash weights
- protection against treating a non-consecutive month as the next-month return
- integration tests in `tests/csv-provider.test.ts` and `tests/runner.test.ts`
- expanded point-in-time and safety tests in existing suites

## Verification status

The merged PR #1 implementation was checked locally on 2026-08-26. Defects were reproduced on the unmodified implementation, then fixed on `fix/validate-market-data-backtest` rather than on `main`.

- Node.js: `v26.7.0`
- Bun: `1.3.14`
- `bun install`: PASS, no changes
- `bun test`: PASS, 22 tests / 0 failures
- `bunx tsc --noEmit`: PASS
- Trend CLI: PASS
- Rotation CLI: PASS
- exact repeated-run reproducibility: PASS

Fixture commands:

```bash
bun run backtest --config=tests/fixtures/configs/trend.json
bun run backtest --config=tests/fixtures/configs/rotation.json
```

Both strategies produced 18 monthly frames from `2023-12` through `2025-05`, held at most three assets, charged a total modeled cost rate of approximately `0.002`, and stopped after frame `2025-01` when the synthetic series crossed the -30% high-water-mark limit. Ending weights were 100% cash.

The synthetic fixture contains 651 weekday rows from `2023-01-02` through `2025-06-30`. It is Price Return data with identical `Close` and `AdjustedClose`; no distribution, Corporate Action, FX, or real liquidity evidence is represented.

Defects found in merged PR #1:

- `maxAssets=4` produced four positions.
- a missing held-asset next-month return was treated as zero.
- insufficient-history assets disappeared without an explicit CLI reason.
- mandatory stop liquidation omitted the sell-side transaction cost.
- a missing calendar month could be used as though the next available month were the immediate next month.
- malformed/missing CSV values could be skipped or represented as zero.

All are fixed and covered on the validation branch. `main` remains unchanged until the validation PR is reviewed and explicitly merged.

## Required validation coverage

- PASS — TypeScript/Bun runtime succeeds
- PASS — all unit and integration tests pass
- PASS — Trend CLI succeeds with controlled fixture data
- PASS — Rotation CLI succeeds with controlled fixture data
- PASS — listing and delisting boundaries are enforced
- PASS — signal construction uses only decision-date information
- PASS — insufficient history is visible and deterministic
- PASS — transaction costs reduce returns, including stop liquidation
- PASS — maximum holdings remain three or fewer
- PASS — -30% high-water-mark stop is covered by an integration test
- PASS — repeated execution is reproducible

## Known limitations and risks

### Data correctness

- Stooq is a research OHLCV source, not approved final total-return evidence.
- Distribution and ex-dividend normalization are not complete.
- JPY conversion for overseas assets is not implemented.
- Cross-source reconciliation is not implemented.
- Data licensing, retention, and reproducibility for the final provider remain unresolved.

### Universe correctness

- The runner currently accepts assets from config rather than loading `universe_master.csv` as the source of truth.
- Listing/delisting bounds may be supplied from config, but the complete historical ETF master is not yet wired into the runner.
- Survivorship-bias controls require a maintained point-in-time universe and delisting history.

### Backtest completeness

- Robustness-grid execution is not implemented.
- Rebalance-date and replacement/hysteresis comparisons are not implemented.
- Cash return is simplified.
- Exact total-return and management-fee handling require final data decisions.
- Strategy C is specified but not implemented.

### Operations

- Forward-test persistence, scheduled monthly execution, decision-package storage, notifications, and dashboard are not implemented.
- No brokerage or real-order connection exists and none should be added in the current phase.

## Next implementation sequence

### P0 — Validate merged main

1. Review the validation PR.
2. Merge only after explicit user approval.
3. After merge, rerun `bun test` and both fixture CLI commands on updated `main`.

### P1 — Make data financially correct

1. Define and implement total-return/distribution normalization.
2. Add Point-in-Time JPY FX normalization for non-JPY assets.
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
