# Implementation

Pythonで作っていた初期骨格はTypeScriptへ全面移行した。Python依存はない。

Codex Project移行後の統合指示は `docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`、現在の詳細状態は `docs/handoff/CURRENT_STATUS.md` を参照すること。

## Implemented on main

### Strategy

- `src/strategies/trend.ts`: Strategy A Trend ranking
- `src/strategies/rotation.ts`: Strategy B Cross-Asset Rotation ranking
- `src/strategies/types.ts`: normalized strategy inputs

### Portfolio / Risk

- `src/portfolio/allocator.ts`: inverse-volatility allocation
- `src/portfolio/risk.ts`: maximum drawdown / -30% hard stop
- `src/portfolio/costs.ts`: turnover-aware execution costs

On `ykoba/distribution-ledger-accounting`:

- `src/portfolio/distribution-ledger.ts`: Point-in-Time distribution receivable, revision, payment, rebalance-cash, and forecast-scoring ledger

### Data

- `src/data/models.ts`: normalized market / Universe models
- `src/data/universe.ts`: point-in-time Universe eligibility primitives
- `src/data/provider.ts`: `MarketDataProvider` abstraction and daily-bar validation
- `src/data/csv.ts`: CSV fallback provider
- `src/data/stooq.ts`: Stooq research provider
- `src/data/return-normalization.ts`: explicit Price Return / Total Return normalization, event coverage, provenance, and Point-in-Time validation
- `docs/return-normalization.md`: normalization semantics and explicit policy boundaries

### Backtest

- `src/backtest/simulator.ts`: monthly compounding simulator
- `src/backtest/metrics.ts`: cumulative return / CAGR / volatility / Sharpe / Sortino
- `src/backtest/frame-builder.ts`: daily bars to monthly signals and next-month returns
- `src/backtest/runner.ts`: config-driven Strategy A/B CLI
- `backtest.config.example.json`: runnable configuration example

### Tests present

- `tests/core.test.ts`
- `tests/data-costs.test.ts`
- `tests/simulator.test.ts`
- `tests/frame-builder.test.ts`
- `tests/csv-provider.test.ts`
- `tests/runner.test.ts`
- `tests/return-normalization.test.ts`
- `tests/fixtures/return-normalization/events.json`

On `ykoba/distribution-ledger-accounting`:

- `tests/distribution-ledger.test.ts`
- `tests/fixtures/distribution-ledger/events.json`

### AI

- `src/ai/`: Strategy C area. PM / Macro Analyst / Risk-Critic will consume validated, timestamped inputs. Strategy C is not implemented yet.

## Runtime

Primary target is Bun:

```bash
bun install
bun test
bun run backtest --config=backtest.config.json
```

The repository currently requires Node.js 26.7.0 or later. Bun is the primary workflow.

## Design boundary

Deterministic calculations, data validation, execution costs, portfolio constraints, and safety controls belong in TypeScript code. AI is used for interpretation of macro/news/policy/consensus and cannot silently override hard constraints.

Stooq is a research plumbing provider only. Do not interpret Stooq-only OHLCV results as final dividend-aware or production-grade investment evidence.

## Verification state

PR #1 was merged before local verification. The merged code was subsequently validated and fixed by PR #3, now merged into `main`.

- Runtime: Node.js `v26.7.0`, Bun `1.3.14`
- `bun install`: success, no dependency changes
- `bun test`: 22 pass / 0 fail
- `bunx tsc --noEmit`: success
- Trend fixture CLI: success
- Rotation fixture CLI: success
- Repeated fixture execution: byte-for-byte deterministic output

PR #3 added commit-safe synthetic CSV fixtures and integration coverage for listing/delisting bounds, decision-date-only signals, explicit insufficient-history exclusion, transaction costs, the three-holding cap, and the -30% high-water-mark stop.

Defects found and fixed on the branch:

- `maxAssets` could exceed the approved limit of three.
- A missing held-asset forward return could be silently treated as zero.
- Insufficient history was silently omitted from CLI output.
- Hard-stop liquidation did not charge its exit transaction cost.
- A missing calendar month could stretch a forward return across multiple months.
- Missing optional CSV fields were represented as numeric zero, and malformed in-range prices could be skipped.

The fixture is synthetic unadjusted Price data. It does not validate JPY FX conversion, final data-provider quality, or investable historical performance.

PR #4 merged the Total Return foundation into `main`. Post-merge verification passed 38 tests / 0 failures, `bunx tsc --noEmit`, and both fixture CLIs.

O-002 is resolved by active decision D-018. The distribution-ledger branch currently verifies 53 tests / 0 failures and passes `bunx tsc --noEmit`. It separates ex-date research Total Return from executable receivable/pay-date cash accounting, includes selected-ETF distributions in forecast scoring, and never automatically reinvests unpaid cash.

The optional `bun run test:node` script remains incompatible with the pre-existing Bun-specific tests and TypeScript parameter properties under Node's strip-only loader. Bun is the required test path; this branch does not broaden scope to convert the test suite.

## Next blocks

1. Review and merge the D-018 distribution ledger only with explicit user approval
2. JPY FX normalization for overseas assets
3. Point-in-time ETF master loader from `universe_master.csv`
4. Data-quality and cross-source reconciliation reports
5. Robustness grid runner for Strategy A/B
6. Decision-package schema for Strategy C
7. Forward-test persistence, scheduling, notifications, and monthly dashboard
