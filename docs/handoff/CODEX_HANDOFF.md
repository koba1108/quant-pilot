# Codex Handoff

## Project

- Repository: `koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Current default branch state: PR #11 (`fix: retain partial credentialed provider evidence`) merged into `main` at `60aa5266100945583f9dc1b4eff4d9bd70a76b52`
- Active implementation branch: `ykoba/pre-forward-manual-cycle`
- Active PR: #12 (`feat: add manual pre-forward virtual cycle`)
- Current delivery milestone: M2 — Manual Pre-Forward vertical slice
- Current roadmap: `docs/handoff/EXECUTION_ROADMAP.md`
- Formal Forward-Test clock: not started
- Handoff date: 2026-08-31
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

`main` through PR #11 contains deterministic TypeScript implementations for:

- Strategy A/B ranking, inverse-volatility allocation, costs, the three-holding limit, and the -30% hard stop
- commit-safe Trend/Rotation CLI fixtures and Point-in-Time lifecycle validation
- versioned Price Return / Total Return normalization
- D-018 distribution receivable/pay-date accounting
- Point-in-Time non-JPY to JPY conversion
- CSV and Stooq research providers
- provider-neutral normalized runner integration and exact-date JPY conversion
- fail-closed provider evaluation and a mocked J-Quants v2 daily-price adapter contract
- fixture-tested credentialed-sample capture, immutable artifacts, reconciliation, offline replay, and durable partial-provider failures for J-Quants/EODHD contracts

PR #11 was merged on 2026-08-31. The current branch consumes retained M1 observations in a manual virtual operating cycle without weakening missing-data gates.

## Current post-merge work

The active work advances M2 of `EXECUTION_ROADMAP.md`: a manual, replayable, idempotent Pre-Forward virtual cycle.

1. adds a dedicated explicit-`asOf` `pre-forward` CLI for versioned Trend and Rotation configurations;
2. produces immutable Decision Packages and append-only hash-chained Bun SQLite portfolio state;
3. creates virtual orders/executions with trading-unit rounding, explicit costs, cash accounting, maximum three holdings, and an authoritative -30% high-water-mark stop;
4. makes duplicate invocation and explicit Decision Package replay non-mutating and deterministic;
5. preserves Point-in-Time Universe, stale-data, missing-history, execution, distribution, and ledger mismatches as explicit blockers;
6. completes a synthetic fixture cycle while the retained three-day J-Quants audit correctly remains blocked with no state transition.

The M2 real-data exit criterion is not met. A longer licensed retained sample, strict Point-in-Time Universe, approved execution assumptions, and distribution-event input remain required. Strategy C, formal operational scheduling, a dashboard, a production provider selection, and real brokerage/order behavior remain outside M2.

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

- `bun test`: 152 pass / 0 fail (PR #9 verification now on `main`)
- `bunx tsc --noEmit`: pass
- Trend with strict v1 Universe: pass
- Rotation with strict v1 Universe: pass
- data-quality CLI: pass with expected `research_only` disposition
- normalized Trend/Rotation CLIs: pass and reproducible
- robustness grid: 16 completed supported cells and 16 explicit unsupported cells (PR #7 baseline)
- final all-CLI audit: pass
- normalized Trend and Rotation repeated outputs: byte-for-byte identical
- merged M1 path: `bun test` 198 pass / 0 fail; TypeScript passes; fixture replay is byte-for-byte identical; live partial replay is canonical-equal; production and partial-result gates fail closed as expected
- active M2 branch: `bun test` 205 pass / 0 fail; TypeScript passes; synthetic Trend/Rotation execute; duplicate invocation and explicit replay are non-mutating; retained J-Quants input blocks with no cash movement

See `CURRENT_STATUS.md` for commands, outputs, and current limitations.

## Next implementation sequence

1. M2 NOW: review and merge the manual Pre-Forward software vertical slice without calling the synthetic run real-data completion.
2. M2 EVIDENCE GATE: separately authorize enough licensed retained history and bind strict Universe/execution evidence for one real virtual-money cycle.
3. M2 FOLLOW-ON: connect retained distribution events before advancing a held portfolio to another cutoff.
4. M3 LATER: approved scheduling, recovery, notifications, and minimal reporting.
5. M4 GATE: freeze provider, Universe, strategies, persistence, and success thresholds before formal Forward Test.
6. Follow `EXECUTION_ROADMAP.md`; do not begin later work because it is locally interesting.

## Working rules

- Read `AGENTS.md`, `CODEX_PROJECT_INSTRUCTIONS.md`, `DECISIONS.md`, and `EXECUTION_ROADMAP.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present evidence and request human approval rather than silently choosing.
- Do not connect a brokerage account or place real orders in the current phase.
