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

## Phase 0 validation

PR #1 was merged before local verification. Validation and defect fixes were completed afterward and merged through PR #3.

- `bun install`: success
- `bun test`: 22 pass / 0 fail
- Trend and Rotation fixture CLI runs: success
- Point-in-Time boundaries, future-data isolation, explicit missing-history handling, costs, maximum three holdings, reproducibility, and the -30% stop: covered

The validation found defects in holding-limit enforcement, missing-return handling, exclusion visibility, stop-liquidation costs, consecutive-month handling, and CSV missing-value handling. Fixes and commit-safe synthetic fixtures are now on `main`. See `CURRENT_STATUS.md` for exact commands, results, and limitations.

## Total Return foundation

`ykoba/total-return-normalization` adds versioned Price Return / Total Return normalization with explicit event coverage, source provenance, Point-in-Time availability checks, and no default distribution policy. Existing CLI inputs are labeled `unadjusted_price` or `provider_adjusted`; neither is silently promoted to Total Return.

O-002 remains open. Supporting ex-date and pay-date comparison does not approve either convention.

## Next implementation sequence

1. Review the Total Return normalization foundation.
2. Research and approve the final O-002 accounting policy.
3. Add Point-in-Time JPY conversion for non-JPY assets.
4. Add a point-in-time loader for `universe_master.csv`.
5. Add data-quality reports and cross-source reconciliation hooks.
6. Add robustness-grid execution for Strategy A/B.
7. Define the Strategy C decision-package schema.
8. Add forward-test persistence, scheduling, reporting, and notifications.

## Working rules

- Read `AGENTS.md`, `CODEX_PROJECT_INSTRUCTIONS.md`, and `DECISIONS.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present evidence and request human approval rather than silently choosing.
- Do not connect a brokerage account or place real orders in the current phase.
