# Codex Handoff

## Project

- Repository: `koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- PR #1: merged into `main`
- Handoff date: 2026-08-26
- Primary migration instructions: `docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`

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

## What is implemented

`main` contains deterministic TypeScript implementations for:

- Strategy A/B ranking
- inverse-volatility allocation
- transaction-cost calculation
- drawdown handling
- point-in-time universe primitives
- monthly simulation
- performance metrics
- `MarketDataProvider` abstraction
- CSV market-data provider
- Stooq research provider
- daily-bar to monthly-frame construction
- Strategy A/B CLI runner
- example backtest configuration
- frame-builder test

## Important current caveat

PR #1 was merged before local verification was completed. The code is not assumed broken, but the first Codex Project task is to validate the merged `main` rather than continue from an obsolete feature branch.

Required first actions:

1. Update local `main` with `git pull --ff-only origin main`.
2. Run `bun install` and `bun test`.
3. Run reproducible CSV-fixture CLI tests for both Trend and Rotation.
4. Verify point-in-time boundaries, missing-history behavior, costs, and the -30% drawdown stop.
5. Fix defects on a new branch and open a new PR if needed.
6. Update `CURRENT_STATUS.md` with actual results.

## Next implementation sequence

After the merged implementation is verified:

1. Total-return/distribution normalization
2. JPY conversion for non-JPY assets
3. point-in-time loader for `universe_master.csv`
4. data-quality reports and cross-source reconciliation hooks
5. robustness-grid execution for Strategy A/B
6. Strategy C decision-package schema
7. forward-test persistence, scheduling, reporting, and notifications

## Working rules

- Read `AGENTS.md`, `CODEX_PROJECT_INSTRUCTIONS.md`, and `DECISIONS.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present evidence and request human approval rather than silently choosing.
- Do not connect a brokerage account or place real orders in the current phase.
