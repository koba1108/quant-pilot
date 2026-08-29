# Codex Handoff

## Project

- Repository: `koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Current default branch state: PR #9 (`feat: evaluate production market data readiness`) merged into `main` at `9690bbe7e40c64a3fc2591b5da785f01bc0bbbc4`
- Active implementation branch: `ykoba/pre-forward-credentialed-data-slice`
- Active PR: #10 (`feat: add credentialed provider sample capture and replay`)
- Current delivery milestone: M1 — Credentialed data slice
- Current roadmap: `docs/handoff/EXECUTION_ROADMAP.md`
- Formal Forward-Test clock: not started
- Handoff date: 2026-08-29
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

`main` through PR #9 contains deterministic TypeScript implementations for:

- Strategy A/B ranking, inverse-volatility allocation, costs, the three-holding limit, and the -30% hard stop
- commit-safe Trend/Rotation CLI fixtures and Point-in-Time lifecycle validation
- versioned Price Return / Total Return normalization
- D-018 distribution receivable/pay-date accounting
- Point-in-Time non-JPY to JPY conversion
- CSV and Stooq research providers
- provider-neutral normalized runner integration and exact-date JPY conversion
- fail-closed provider evaluation and a mocked J-Quants v2 daily-price adapter contract

PR #9 was merged on 2026-08-29. Its pre-merge verification passed 152 Bun tests, TypeScript checking, raw/normalized Trend/Rotation CLIs, data-quality, robustness, deterministic provider evaluation, and the expected fail-closed production exit.

## Current post-merge work

The active work is M1 of `EXECUTION_ROADMAP.md`: a credentialed, reproducible, license-permitted provider sample path.

1. implemented and fixture-tested capture/audit tooling without secrets;
2. bound request, retrieval, exact raw response bytes, source version, hashes, normalized artifacts, and observations;
3. added deterministic J-Quants/EODHD five-mapping reconciliation plus offline replay;
4. stop at Gate G1/G2 until the user explicitly approves credentials, cost/entitlement, and raw-response retention, then obtain the real sample;
5. return O-001 evidence to the user without auto-selecting a provider.

Strategy C, formal operational scheduling, a dashboard, a production provider, and brokerage/order behavior remain outside M1.

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
- active M1 branch: `bun test` 195 pass / 0 fail; TypeScript pass; credentialed-sample fixture capture/replay byte-for-byte identical; live/production requirement flags fail closed as expected

See `CURRENT_STATUS.md` for commands, outputs, and current limitations.

## Next implementation sequence

1. M1 NOW: credentialed sample capture and audit.
2. M2 NEXT: manual, replayable, idempotent Pre-Forward virtual-portfolio cycle.
3. M3 LATER: approved scheduling, recovery, notifications, and minimal reporting.
4. M4 GATE: freeze provider, Universe, strategies, persistence, and success thresholds before formal Forward Test.
5. Follow `EXECUTION_ROADMAP.md`; do not begin later work because it is locally interesting.

## Working rules

- Read `AGENTS.md`, `CODEX_PROJECT_INSTRUCTIONS.md`, `DECISIONS.md`, and `EXECUTION_ROADMAP.md` before changing behavior.
- Do not reinterpret the original interview questions. Only approved decisions in this repository are binding.
- Keep deterministic finance logic and hard safety constraints in TypeScript.
- Log assumptions and limitations whenever market data is incomplete.
- When a material financial-policy decision is required, present evidence and request human approval rather than silently choosing.
- Do not connect a brokerage account or place real orders in the current phase.
