# Codex Handoff

## Project

- Repository: `koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Active implementation branch: `feat/market-data-backtest`
- Active pull request: `#1 feat: add market data providers and runnable backtests`
- Handoff date: 2026-08-26

## Mission

Quant Pilot is a research and forward-testing system for an AI-assisted, Quant-constrained monthly ETF strategy.

The user's existing long-term portfolio is centered on US equity index investing. Quant Pilot does not replace that portfolio. Its purpose is to test whether a separate, rules-based return engine can add value through non-US-equity assets, controlled risk, explicit data provenance, and auditable AI decisions.

The first real-money budget ceiling is JPY 1,000,000, but no real-money deployment occurs until backtests and at least 12 months of forward testing satisfy predefined criteria.

## Current system shape

```text
Point-in-Time Universe
        ↓
Data Validation / Normalization
        ↓
Quant Eligibility Gate
        ↓
┌───────────────────────────────┐
│ A: Trend Control              │
│ B: Cross-Asset Rotation       │
│ C: Adaptive Macro AI          │
└───────────────────────────────┘
        ↓
Risk / Concentration / Cost Gate
        ↓
Virtual Broker
        ↓
JPY 1,000,000 × 3 strategies
        ↓
Decision Package / Monthly Report
```

## What is already implemented

The base branch contains deterministic TypeScript implementations for Strategy A/B ranking, inverse-volatility allocation, transaction-cost calculation, drawdown handling, point-in-time universe primitives, monthly simulation, and performance metrics.

PR #1 adds:

- `MarketDataProvider` abstraction
- CSV market-data provider
- Stooq research provider
- daily-bar to monthly-frame construction
- runnable Strategy A/B CLI
- example backtest configuration
- additional frame-builder test
- package rename to `quant-pilot`
- updated README usage instructions

See `CURRENT_STATUS.md` for exact verification gaps.

## Immediate objective

Complete and validate PR #1 locally, then continue the data-correctness layer required before any result is treated as investment evidence.

Priority order:

1. Check out `feat/market-data-backtest` and inspect `git status`.
2. Run `bun install` and `bun test`.
3. Run a fixture-backed Strategy A and Strategy B backtest through the CLI.
4. Fix any TypeScript, runtime, date-boundary, or CSV parsing defects found.
5. Implement total-return/distribution normalization.
6. Implement JPY conversion for non-JPY assets without introducing future information.
7. Load the point-in-time ETF universe from `universe_master.csv` rather than duplicating assets manually in config.
8. Add data-quality checks and cross-source reconciliation hooks.
9. Add robustness-grid execution for strategy parameters, rebalancing dates, and turnover rules.
10. Update the PR description and handoff status with verified results.

## Definition of done for the current phase

The current data/backtest phase is complete only when:

- `bun test` passes locally.
- Strategy A and B can run from a documented config and reproducible fixture dataset.
- Listing and delisting bounds are enforced.
- Signals use only information available at the decision date.
- Costs are deducted from results.
- The -30% high-water-mark stop works in an integration test.
- Missing or insufficient data fails loudly instead of silently substituting values.
- Research OHLCV results are clearly distinguished from dividend-aware total-return validation.
- README, `IMPLEMENTATION.md`, and this handoff reflect the actual state.

## Non-goals for this phase

Do not yet:

- connect a brokerage account or place real orders;
- implement shorting, leverage, inverse ETFs, or crypto assets;
- claim that Stooq-only results are production-grade investment evidence;
- complete Strategy C by allowing an LLM to select assets from unvalidated inputs;
- optimize parameters solely for the highest historical return;
- merge PR #1 without local verification and explicit user direction.

## Working rules

- Read `AGENTS.md` and `DECISIONS.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present the evidence and request human approval rather than silently choosing.
