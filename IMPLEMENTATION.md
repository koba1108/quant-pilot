# Implementation

Pythonで作っていた初期骨格はTypeScriptへ全面移行した。Python依存はない。

現在の詳細な引き継ぎ状態は `docs/handoff/CURRENT_STATUS.md` を参照すること。

## Implemented

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

### Tests

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

The repository currently requires Node.js 26.7.0 or later. Core tests may also be invoked through the Node script defined in `package.json`, but Bun is the primary workflow.

## Design boundary

Deterministic calculations, data validation, execution costs, portfolio constraints, and safety controls belong in TypeScript code. AI is used for interpretation of macro/news/policy/consensus and cannot silently override hard constraints.

Stooq is a research plumbing provider only. Do not interpret Stooq-only OHLCV results as final dividend-aware or production-grade investment evidence.

## Verification required before PR #1 merge

```bash
cd /Users/ykoba/IdeaProjects/quant-pilot
git switch feat/market-data-backtest
bun install
bun test
cp backtest.config.example.json backtest.config.json
bun run backtest --config=backtest.config.json
```

Run both `trend` and `rotation` with controlled CSV fixtures and document the results in the pull request.

## Next blocks

1. Local verification and defect fixing for PR #1
2. Distribution / total-return normalization
3. JPY FX normalization for overseas assets
4. Point-in-time ETF master loader from `universe_master.csv`
5. Data-quality and cross-source reconciliation reports
6. Robustness grid runner for Strategy A/B
7. Decision-package schema for Strategy C
8. Forward-test persistence, scheduling, notifications, and monthly dashboard
