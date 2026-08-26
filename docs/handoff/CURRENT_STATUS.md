# Current Status

Snapshot date: 2026-08-26

## Repository state

- Repository: `koba1108/quant-pilot`
- Local checkout: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- PR #1: merged
- Merge commit: `5b161573419bccd83cd82400fb31110d99651fe1`
- Current documentation branch: `docs/codex-project-migration`

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

## Verification status

PR #1 was merged before the following local checks were completed. No CI status was attached to the merge commit at the time of handoff.

The first Codex Project task is therefore validation of the merged `main`.

```bash
cd /Users/ykoba/IdeaProjects/quant-pilot
git status
git switch main
git pull --ff-only origin main
node --version
bun --version
bun install
bun test
```

Then run reproducible fixture-backed tests for both strategies:

```bash
bun run backtest --config=<trend fixture config>
bun run backtest --config=<rotation fixture config>
```

Until these checks pass, the market-data/backtest integration must be treated as implemented but unverified.

## Required validation coverage

- TypeScript/Bun runtime succeeds
- all unit tests pass
- Trend CLI succeeds with controlled fixture data
- Rotation CLI succeeds with controlled fixture data
- listing and delisting boundaries are enforced
- signal construction uses only decision-date information
- insufficient history is visible and deterministic
- transaction costs reduce returns
- maximum holdings remain three or fewer
- -30% high-water-mark stop is covered by an integration test
- repeated execution is reproducible

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

1. Run all tests locally.
2. Add controlled CSV fixtures where missing.
3. Run both `trend` and `rotation` through the CLI.
4. Verify date boundaries, history requirements, costs, reproducibility, and DD stop.
5. Fix defects on a new branch and open a new PR.
6. Record actual results in this file.

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
