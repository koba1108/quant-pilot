# Codex Handoff

## Project

- Repository: `koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Current implementation branch: `ykoba/pit-universe-quality-robustness`
- Pull request: #7 (`feat: add point-in-time research validation`), open and intentionally unmerged
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

`main` through PR #6 contains deterministic TypeScript implementations for:

- Strategy A/B ranking, inverse-volatility allocation, costs, the three-holding limit, and the -30% hard stop
- commit-safe Trend/Rotation CLI fixtures and Point-in-Time lifecycle validation
- versioned Price Return / Total Return normalization
- D-018 distribution receivable/pay-date accounting
- Point-in-Time non-JPY to JPY conversion
- CSV and Stooq research providers

PR #6 (`feat: add point-in-time JPY FX normalization`) was merged on 2026-08-27 at merge commit `15cb74346f0acdd03302155b318f0fc49e266cb2`. Post-merge baseline verification passed 67 Bun tests, TypeScript checking, and both synthetic Strategy A/B CLIs.

## Current branch

`ykoba/pit-universe-quality-robustness` combines the next three already-defined foundations in one reviewable PR:

1. a strict versioned Point-in-Time Universe master and per-decision-date runner integration;
2. raw artifact provenance, deterministic data-quality reports, and source-reconciliation hooks;
3. a deterministic Strategy A/B robustness grid with no automatic winning parameter selection.

The branch intentionally does not implement Strategy C, operational scheduling, a dashboard, a production provider, or brokerage/order behavior.

## Important data boundaries

- The repository-root `universe_master.csv` is a legacy candidate catalog. It is not safe as a Point-in-Time membership source and is not silently upgraded or inferred.
- The strict v1 fixture uses synthetic instruments, versioned observations, availability timestamps, and explicit listing/last-eligible dates.
- The quality fixture is expected to be `research_only` because it is unadjusted, single-source synthetic data.
- Ordinary runner output is explicitly `research_only`; `etf_realistic` is rejected until normalized returns, row-level availability, and JPY conversion are integrated.
- The config-only runner path is explicitly limited to `synthetic_fixture` or `proxy`; strict product/currency enforcement requires the versioned master.
- Reconciliation never chooses a preferred source implicitly.
- Robustness output is machine-labeled `research_only` / `not_normalized` evidence for O-005/O-006 research, not an approved parameter decision.
- Stooq remains research plumbing and must not be the sole final investment basis.

## Verification snapshot

- `bun test`: 105 pass / 0 fail
- `bunx tsc --noEmit`: pass
- Trend with strict v1 Universe: pass
- Rotation with strict v1 Universe: pass
- data-quality CLI: pass with expected `research_only` disposition
- robustness grid: 16 completed supported cells and 16 explicit unsupported cells

See `CURRENT_STATUS.md` for commands, outputs, and current limitations.

## Next implementation sequence

1. Review PR #7 and merge only after explicit user approval.
2. Research/connect production-grade Universe and data-provider sources without settling O-001 arbitrarily.
3. Add the remaining execution-timing, replacement/hysteresis, crisis-period, and benchmark-comparison robustness axes.
4. Define the Strategy C decision-package schema.
5. Add forward-test persistence, scheduling, reporting, and notifications.

## Working rules

- Read `AGENTS.md`, `CODEX_PROJECT_INSTRUCTIONS.md`, and `DECISIONS.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present evidence and request human approval rather than silently choosing.
- Do not connect a brokerage account or place real orders in the current phase.
