# Implementation

Pythonで作っていた初期骨格はTypeScriptへ全面移行した。Python依存はない。

## Implemented

### Strategy
- `src/strategies/trend.ts`: Strategy A Trend ranking
- `src/strategies/rotation.ts`: Strategy B Cross-Asset Rotation ranking

### Portfolio / Risk
- `src/portfolio/allocator.ts`: inverse-volatility allocation
- `src/portfolio/risk.ts`: maximum drawdown / -30% hard stop
- `src/portfolio/costs.ts`: spread / slippage / commission / FX aware costs

### Data
- `src/data/models.ts`: normalized market / Universe models
- `src/data/universe.ts`: point-in-time Universe eligibility

### Backtest
- `src/backtest/simulator.ts`: monthly compounding simulator
- `src/backtest/metrics.ts`: cumulative return / CAGR / volatility / Sharpe / Sortino
- `src/backtest/runner.ts`: real-data runner scaffold

### AI
- `src/ai/`: Strategy C area. PM / Macro Analyst / Risk-Critic will consume validated timestamped inputs.

## Runtime

Primary target is Bun:

```bash
bun install
bun test
bun run backtest
```

The current execution environment does not include Bun, so CI-equivalent core validation can also run with Node.js 26.7.0+:

```bash
npm run test:node
```

## Design boundary

Deterministic calculations and safety constraints belong in TypeScript code. AI is used for interpretation of macro/news/policy/consensus and cannot silently override portfolio constraints.

## Next blocks

1. Market-data adapter implementation
2. Distribution / total-return normalization
3. JPY FX normalization for overseas assets
4. Point-in-time ETF master loader from `universe_master.csv`
5. Robustness grid runner for Strategy A/B
6. Decision-package schema for Strategy C
7. Forward-test persistence and monthly dashboard
