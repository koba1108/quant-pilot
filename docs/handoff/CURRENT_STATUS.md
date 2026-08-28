# Current Status

Snapshot date: 2026-08-28

## Repository state

- Repository: `koba1108/quant-pilot`
- Local checkout: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Latest merged PR: #7 (`feat: add point-in-time research validation`)
- Latest `main` commit: `2a522904695070a3b75770b2d1b84a459a6ebfe8`
- Active branch: `ykoba/normalized-pit-backtest-integration`
- This branch contains the post-PR #7 provider-neutral normalized Point-in-Time backtest integration. It is not merged; confirm the current PR state before continuing.

## Implemented on main through PR #7

### Deterministic research engine

- Strategy A Trend and Strategy B Cross-Asset Rotation ranking
- inverse-volatility allocation with a hard maximum of three holdings
- turnover-aware transaction costs, including stop liquidation
- -30% high-water-mark hard stop and ending-cash behavior
- daily-bar to monthly-frame construction with explicit missing-history diagnostics
- CSV and Stooq research providers
- config-driven Strategy A/B CLI and commit-safe synthetic fixtures

### Financial-data foundations

- versioned Price Return / Total Return normalization
- explicit distribution and Corporate Action coverage/provenance checks
- D-018 ex-date research return and separate receivable/pay-date virtual-account ledger
- Point-in-Time exact-date non-JPY to JPY conversion and corrected-observation chains

### Main verification baseline

- Node.js: `v26.7.0`
- Bun: `1.3.14`
- `bun install`: pass, no dependency changes
- `bun test`: 105 pass / 0 fail (PR #7 pre-merge baseline)
- `bunx tsc --noEmit`: pass
- Trend CLI: pass
- Rotation CLI: pass
- exact repeated-run fixture reproducibility: pass

## Included in main from PR #7

### Point-in-Time Universe master

- `src/data/universe-master.ts` adds a strict `universe-master-v1` CSV contract.
- Instrument observations have stable IDs, explicit correction chains, listing and inclusive `last_eligible_date`, availability timestamps, source provenance, and explicit D-003 product-class flags.
- The resolver selects only metadata available by each decision cutoff and records applied observation IDs.
- The backtest runner can opt into the master with `universeMasterPath`; lifecycle overrides in the ordinary asset config are then rejected, and the current runner fails closed on non-JPY or prohibited/non-ETF products.
- Universe membership is resolved for every monthly signal frame, not only once at the backtest end date.
- Signal and forward-return endpoints both enforce lifecycle, status, product, and currency eligibility. A newly ineligible endpoint stops frame construction rather than consuming that return.
- Execution revalidates the config and fingerprints of the loaded master, status policy, and bar inputs so callers cannot mutate validated inputs or silently change the requested window.
- The repository-root `universe_master.csv` remains a legacy candidate catalog and is intentionally rejected by the strict loader because it lacks safe Point-in-Time fields.
- The config-only compatibility path requires `researchLayer=synthetic_fixture` or `researchLayer=proxy`; it cannot masquerade as ETF-realistic D-003/D-006 evidence.

### Data provenance, quality, and source comparison

- `src/data/provenance.ts` adds canonical hashes and versioned artifact lineage.
- `src/data/data-quality.ts` emits deterministic `pass`, `research_only`, or `blocked` reports rather than filling missing data.
- `src/data/reconciliation.ts` binds comparable observations to parent artifacts, field-specific semantics, availability, and policy fingerprints; consumers recompute group results/issues from the embedded evidence and never silently select a source winner.
- `src/data/data-quality-runner.ts` provides the `bun run data-quality` executable path.
- The committed single-source unadjusted fixture correctly reports `research_only`; it is not presented as production evidence.

### Strategy A/B robustness grid

- `src/backtest/robustness-grid.ts` runs deterministic combinations of Strategy A/B weights/filter choices, transaction costs, maximum holdings, and volatility windows.
- Results include return/risk, drawdown, turnover, cost, cash-ratio, worst-month, and worst-year metrics.
- Rebalance timing and replacement/hysteresis values not implemented by the simulator are explicit `unsupported` cells, never substituted silently.
- Output contains stability ranges and no automatic best-cell or approved-parameter selection.
- Grid output itself carries `evidenceDisposition=research_only`, its return basis, and `returnNormalization.status=not_normalized`.

## PR #7 verification now present on main

Commands:

```bash
bun test
bunx tsc --noEmit
bun run backtest --config=tests/fixtures/configs/trend-universe.json
bun run backtest --config=tests/fixtures/configs/rotation-universe.json
bun run data-quality --config=tests/fixtures/configs/data-quality.json
bun run robustness --config=tests/fixtures/configs/robustness-grid.json
```

PR #7 verification results (completed before merge and now present on `main`):

- `bun test`: 105 pass / 0 fail
- `bunx tsc --noEmit`: pass
- strict v1 Universe Trend CLI: pass
- strict v1 Universe Rotation CLI: pass
- repeated CLI output: deterministic
- data-quality CLI: pass, disposition `research_only` as expected
- robustness CLI: pass, 32 cells total; 16 completed and 16 explicitly unsupported
- completed cells preserve the three-holding cap, cost drag, and -30% stop
- every ordinary backtest result is explicitly `research_only`; `etf_realistic` is rejected until its required data layers are integrated

The Trend and Rotation strict-Universe fixtures use the same synthetic daily Price series as the legacy integration fixture. Both produce 18 monthly frames, final value `833426`, cumulative portfolio return approximately `-0.1665735`, modeled cost rate approximately `0.002`, maximum three holdings, and a stop after `2025-02`.

## Current branch implementation verification

The current branch adds `backtest-summary-v3`, `robustness-grid-v2`, and a provider-neutral `src/data/point-in-time-return-source.ts`. The runner now supports explicit `price_return` / `total_return` opt-in, separate signal/forward Point-in-Time snapshots, `ReturnEventCoverage.availableAt`, exact-date non-JPY to JPY conversion, and full input/resolution fingerprints. A forward resolution pins every signal-time bar/FX observation, so a later correction cannot replace the historical entry prefix. Signal and endpoint snapshots are re-resolved at each asset's actual last trading date; calendar-month-end information released after that trading date cannot leak into the frame. All monthly configs require a calendar-month-end `end`, avoiding partial-month annualization in raw and normalized paths.

Synthetic normalized fixtures use `synthetic_same_day_close_v1`; Trend and Rotation normalized configs execute reproducibly. Summary `start` / `end` now describe realized-return months (`2024-01` through `2025-06` in the fixture), while `signalStart` / `signalEnd` describe decision months (`2023-12` through `2025-05`). Realized-return labels and corrected worst-month/worst-year and hard-stop labels are included; incomplete calendar years carry `observedMonths` and `complete=false`, and the fixture stop is labeled `2025-02`.

Latest implementation verification is `bun test`: 131 pass / 0 fail and `bunx tsc --noEmit`: pass. `bun install` completed without dependency changes. Raw strict-Universe Trend/Rotation, normalized Trend/Rotation, data-quality, and robustness CLIs all pass. Both normalized CLI outputs are byte-for-byte reproducible. This branch is not merged.

## Required validation coverage

- PASS — Trend and Rotation both execute
- PASS — identical input/config produces identical output
- PASS — insufficient history is an explicit exclusion
- PASS — pre-listing and post-last-eligible bars are not used
- PASS — signals use no data after the monthly decision point
- PASS — transaction costs reduce portfolio results
- PASS — maximum holdings remain three or fewer
- PASS — -30% high-water-mark stop is enforced
- PASS — missing data is never implicitly replaced with zero or the prior value

## Known limitations and risks

### Data correctness

- All committed end-to-end fixtures are synthetic. They prove implementation behavior, not investable performance.
- The fixture is unadjusted Price data with no real distributions, Corporate Actions, FX, spreads, depth, or fund-structure evidence.
- No production market-data, Corporate Action, FX, historical-Universe, or second-source adapter is connected.
- The quality/reconciliation layer is a provider-neutral foundation; production source identity and metadata must come from a trusted adapter rather than a user assertion.
- Row-level `availableAt` is now consumed by the normalized opt-in runner path; ordinary raw daily-bar paths remain `not_normalized` and are not a production-ready per-bar Point-in-Time quality gate.
- Calendar-month-end config validation prevents known partial final months, but production exchange-calendar completeness still requires an approved provider/calendar adapter.
- Stooq remains research plumbing and cannot be the sole final investment basis.

### Universe correctness

- The strict v1 fixture is synthetic. The legacy root catalog has not been converted into a verified historical master.
- Status values are explicitly opted into by research config; no final Universe member or production status policy is approved.
- Product-class booleans are fail-closed gates, but production correctness still depends on a trusted source populating them accurately.
- Exact eligibility and liquidity thresholds remain O-003; missing required evidence is not fabricated.

### Robustness completeness

- Current grid supports only the parameter axes the simulator can apply deterministically today.
- Nearby rebalance dates, next-open execution, hysteresis/minimum holding periods, and cost-aware no-trade bands remain explicit unsupported cells under O-006.
- Crisis-window, benchmark-correlation, and complementarity reports are not yet implemented.
- No parameter combination is approved; O-005 remains open.

### Operations

- Strategy C and its decision-package schema are not implemented.
- Forward-test persistence, scheduling, notifications, and dashboard are not implemented.
- No brokerage connection or real-order path exists and none should be added in the current phase.

## Open decisions preserved

- O-001: production providers and licensing
- O-003/O-004: exact ETF eligibility thresholds and final members
- O-005/O-006: approved Strategy A/B parameters and trading rules
- O-007 through O-016: cash, caps, AI policy, evaluation, persistence, and real-money details

PR #7 adds evidence-producing contracts and executable research tooling. It does not resolve these decisions.

## Next implementation sequence

1. Complete PR review for the current normalized Point-in-Time integration while keeping `etf_realistic` fail-closed; do not merge without user approval.
2. Research production providers, licensing, and exchange-calendar evidence under O-001 before connecting any production adapter.
3. Add remaining timing/replacement, crisis-period, and benchmark-comparison robustness axes without selecting O-005/O-006 parameters.
4. Define the Strategy C decision-package schema without resolving O-012/O-013 by assumption.
5. Implement forward-test persistence, scheduled execution, notification, and dashboard layers after the relevant open decisions remain explicitly bounded.
