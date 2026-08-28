# Codex Handoff

## Project

- Repository: `koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Current implementation branch: `ykoba/normalized-pit-backtest-integration`
- Base state: PR #7 (`feat: add point-in-time research validation`) merged into `main` at `2a522904695070a3b75770b2d1b84a459a6ebfe8`
- Current work is not merged; confirm the current PR state before continuing and do not describe it as merged.
- Handoff date: 2026-08-28
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

## Merged foundation

`main` through PR #7 contains deterministic TypeScript implementations for:

- Strategy A/B ranking, inverse-volatility allocation, costs, the three-holding limit, and the -30% hard stop
- commit-safe Trend/Rotation CLI fixtures and Point-in-Time lifecycle validation
- versioned Price Return / Total Return normalization
- D-018 distribution receivable/pay-date accounting
- Point-in-Time non-JPY to JPY conversion
- CSV and Stooq research providers

PR #7 (`feat: add point-in-time research validation`) was merged on 2026-08-28 at merge commit `2a522904695070a3b75770b2d1b84a459a6ebfe8`. Its pre-merge verification passed 105 Bun tests, TypeScript checking, strict-Universe Trend/Rotation CLIs, data-quality CLI, and the robustness grid; these results are now part of `main`.

## Current post-merge work

The current implementation block is PR review of the provider-neutral normalized Point-in-Time returns, row-level availability, and JPY conversion integration:

1. `backtest-summary-v3` and `robustness-grid-v2` preserve the existing strict versioned Point-in-Time Universe and per-decision-date provenance;
2. consume normalized-return, `ReturnEventCoverage.availableAt`, and FX contracts without silently filling missing data;
3. retain `research_only` output and reject `etf_realistic` until production data layers are approved and integrated.

The normalized frame builder resolves signal and forward endpoints on each asset's actual last trading date, pins the full signal-time bar/FX prefix into the forward resolution, rejects partial final months, and separates realized-return `start/end` from `signalStart/signalEnd`. Worst-year output discloses incomplete calendar years.

The branch intentionally does not implement Strategy C, operational scheduling, a dashboard, a production provider, or brokerage/order behavior.

## Important data boundaries

- The repository-root `universe_master.csv` is a legacy candidate catalog. It is not safe as a Point-in-Time membership source and is not silently upgraded or inferred.
- The strict v1 fixture uses synthetic instruments, versioned observations, availability timestamps, and explicit listing/last-eligible dates.
- The quality fixture is expected to be `research_only` because it is unadjusted, single-source synthetic data.
- Ordinary raw runner output remains `not_normalized` and `research_only`; normalized `price_return` / `total_return` are explicit opt-in research paths, while `etf_realistic` remains rejected.
- The config-only runner path is explicitly limited to `synthetic_fixture` or `proxy`; strict product/currency enforcement requires the versioned master.
- Reconciliation never chooses a preferred source implicitly.
- `robustness-grid-v2` output is machine-labeled `research_only` / `not_normalized` evidence for O-005/O-006 research, not an approved parameter decision.
- Stooq remains research plumbing and must not be the sole final investment basis.

## Verification snapshot

- `bun test`: 131 pass / 0 fail (current branch implementation verification)
- `bunx tsc --noEmit`: pass
- Trend with strict v1 Universe: pass
- Rotation with strict v1 Universe: pass
- data-quality CLI: pass with expected `research_only` disposition
- normalized Trend/Rotation CLIs: pass and reproducible
- robustness grid: 16 completed supported cells and 16 explicit unsupported cells (PR #7 baseline)
- final all-CLI audit: pass
- normalized Trend and Rotation repeated outputs: byte-for-byte identical

See `CURRENT_STATUS.md` for commands, outputs, and current limitations.

## Next implementation sequence

1. Complete review of the normalized Point-in-Time integration and merge only with explicit user approval.
2. Research production-grade Universe, exchange-calendar, and data-provider sources without settling O-001 arbitrarily.
3. Add remaining execution-timing, replacement/hysteresis, crisis-period, and benchmark-comparison robustness axes without resolving O-005/O-006 by implementation convenience.
4. Define the Strategy C decision-package schema while preserving O-012/O-013 as open.
5. Add forward-test persistence, scheduling, reporting, and notifications only within the approved research/forward-test boundaries.

## Working rules

- Read `AGENTS.md`, `CODEX_PROJECT_INSTRUCTIONS.md`, and `DECISIONS.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present evidence and request human approval rather than silently choosing.
- Do not connect a brokerage account or place real orders in the current phase.
