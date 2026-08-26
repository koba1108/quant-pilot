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

### Data

- `src/data/models.ts`: normalized market / Universe models
- `src/data/universe.ts`: point-in-time Universe eligibility primitives
- `src/data/provider.ts`: `MarketDataProvider` abstraction and daily-bar validation
- `src/data/csv.ts`: CSV fallback provider
- `src/data/stooq.ts`: Stooq research provider

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

PR #1 was merged before local verification. The merged code was subsequently validated on `fix/validate-market-data-backtest`, based on `main` after PR #2.

- Runtime: Node.js `v26.7.0`, Bun `1.3.14`
- `bun install`: success, no dependency changes
- `bun test`: 22 pass / 0 fail
- `bunx tsc --noEmit`: success
- Trend fixture CLI: success
- Rotation fixture CLI: success
- Repeated fixture execution: byte-for-byte deterministic output

The validation branch adds commit-safe synthetic CSV fixtures and integration coverage for listing/delisting bounds, decision-date-only signals, explicit insufficient-history exclusion, transaction costs, the three-holding cap, and the -30% high-water-mark stop.

Defects found and fixed on the branch:

- `maxAssets` could exceed the approved limit of three.
- A missing held-asset forward return could be silently treated as zero.
- Insufficient history was silently omitted from CLI output.
- Hard-stop liquidation did not charge its exit transaction cost.
- A missing calendar month could stretch a forward return across multiple months.
- Missing optional CSV fields were represented as numeric zero, and malformed in-range prices could be skipped.

The fixture is synthetic Price Return data. It does not validate distributions, Corporate Actions, JPY FX conversion, final data-provider quality, or investable historical performance. Until the validation PR is reviewed and merged, these fixes are not part of `main`.

## Next blocks

1. Review and merge the Phase 0 validation PR only with explicit user approval
2. Distribution / total-return normalization
3. JPY FX normalization for overseas assets
4. Point-in-time ETF master loader from `universe_master.csv`
5. Data-quality and cross-source reconciliation reports
6. Robustness grid runner for Strategy A/B
7. Decision-package schema for Strategy C
8. Forward-test persistence, scheduling, notifications, and monthly dashboard
