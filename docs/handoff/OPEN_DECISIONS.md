# Open Decisions

These items are intentionally unresolved. Codex must not convert them into permanent policy by preference alone. Resolve them through research, reproducible tests, and human approval where material.

O-002 was resolved on 2026-08-26 and moved to active decision D-018. Decision IDs are not reused.

## O-001 — Final market-data provider

Need to choose the production-quality source for:

- adjusted and total-return price history;
- distributions and corporate actions;
- JPY FX series;
- historical listing/delisting state;
- spreads or realistic execution-cost proxies;
- reproducible access and acceptable licensing/cost.

Stooq may be used for research plumbing, but is not yet approved as final evidence.

Implementation note: `src/data/fx-normalization.ts` defines a provider-neutral Point-in-Time JPY conversion contract and synthetic regression fixture. It does not approve an FX source, fixing time, holiday alignment rule, license, or production adapter.

Implementation note: `src/data/provenance.ts`, `src/data/data-quality.ts`, and `src/data/reconciliation.ts` define versioned evidence and comparison contracts. They deliberately do not approve a provider, preferred source, license, or automatic conflict winner. The committed quality fixture is synthetic and single-source.

Implementation note (2026-08-29): `src/data/provider-evaluation.ts` and `research/provider-evaluation/o001-candidates.json` evaluate explicit source bundles without scoring or selecting a winner. Official-material research retained J-Quants＋EODHD as the next private-research sample configuration and J-Quants＋Twelve Data as the alternative, but both are currently `blocked`, `selection=not_selected`, and unable to enable `etf_realistic`. `src/data/jquants-v2.ts` is only a mocked-contract, unadjusted proxy adapter; no credentialed sample, production license, or provider choice is approved. See `docs/provider-evaluation.md`.

Implementation note (M1 software checkpoint): `credentialed-sample-v1` now proves the fixture-only J-Quants/EODHD capture, exact-byte retention, immutable lineage, field reconciliation, and offline replay contract for five mappings. Its output is still `research_only` and fail-closed. No real credential, entitlement, cost, retention right, source-native availability/revision evidence, or O-001 selection was added. See `docs/credentialed-sample.md`.

## O-003 — Exact ETF eligibility thresholds

Need evidence-backed thresholds for core and theme ETFs, including:

- minimum live history;
- assets under management;
- average trading value;
- bid/ask spread;
- depth;
- tracking quality;
- concentration limits;
- market-maker participation;
- product-structure exclusions.

The current defaults in code are placeholders, not approved production thresholds.

Implementation note: the strict Universe loader preserves explicit fields and rejects missing required evidence. Its committed fixture uses a 253-observation research-history check only to exercise the current Strategy A/B lookback; that is not an approved production eligibility threshold.

## O-004 — Final Universe members

Need to confirm:

- which major countries receive standalone ETFs;
- which gaps justify overseas-listed ETFs;
- how to avoid duplicate exposures tracking similar indices;
- whether any bond or REIT exposure with substantial US components conflicts with the intended diversification role;
- which commodity products have acceptable roll and tracking behavior.

Implementation note: `universe-master-v1` can reproduce dated candidate observations and explicit status opt-ins, but the synthetic fixture and legacy root catalog do not approve any final member.

## O-005 — Strategy A/B parameters

The current formulas are provisional. Test, rather than assume:

- 3/6/12-month momentum weights;
- absolute-trend filters;
- volatility window;
- maximum number of holdings;
- inverse-volatility allocation details;
- score normalization;
- minimum signal strength.

Adopt broad, robust parameter regions rather than the single best backtest point.

Implementation note: `src/backtest/robustness-grid.ts` can execute supported Strategy A/B parameter cells and summarize stability without choosing a winner. No tested value is promoted to policy by the runner.

## O-006 — Rebalance and replacement rules

Need to compare:

- month-end versus nearby fixed dates;
- next-open versus other realistic execution assumptions;
- immediate top-three replacement;
- rank hysteresis for existing holdings;
- minimum holding periods;
- cost-aware no-trade bands.

Implementation note: unsupported timing and replacement values are preserved as explicit unsupported grid cells. They are not substituted with month-end/immediate-replacement behavior.

## O-007 — Cash return proxy

The current simulator may use zero cash return. Decide the point-in-time proxy for deployable cash or short-duration instruments and account for tax/cost differences where relevant.

## O-008 — Shared-risk-factor hard cap

A hard cap is approved, but the numeric ceiling is not. Compare candidate limits and define how factor exposure is measured when historical correlation and scenario analysis disagree.

## O-009 — Emergency triggers and veto criteria

Need explicit, testable definitions for:

- material price decline;
- volatility spike;
- major policy/geopolitical event;
- liquidity deterioration;
- AI urgency threshold;
- Risk/Critic veto conditions;
- immediate and 30–90 day audit timing.

## O-010 — AI confidence and skip thresholds

AI may choose 100% cash, but the confidence/evidence threshold and its calibration remain open. The system must record the threshold version and evaluate whether skip decisions add value.

## O-011 — Final evaluation scorecard

Overall evaluation must include absolute return, risk-adjusted return, drawdown, and complementarity to the existing US equity index exposure. Exact metric weights and minimum pass thresholds remain open.

Routine reporting should still focus on the Quant Pilot strategy itself.

Implementation note: the robustness grid reports individual risk/return metrics and ranges, but deliberately emits no composite score or pass threshold.

## O-012 — Strategy C historical validation

Need to define the period and archive sources for which historical AI decisions can be reconstructed without future information. Do not simulate historical AI judgments using current web search unless the evidence set is point-in-time complete.

## O-013 — AI models and provider architecture

Model upgrades are permitted but logged. Need to decide:

- provider abstraction;
- model per committee role;
- structured-output schema;
- evaluation set for model upgrades;
- cost and latency limits;
- failure/fallback behavior.

## O-014 — Persistence and scheduling

Need to select storage and execution architecture for:

- monthly and emergency runs;
- immutable decision packages;
- market-data snapshots;
- virtual orders and positions;
- audit results;
- dashboard data;
- notifications.

## O-015 — Forward-test success thresholds

Minimum duration is 12 months, but precise gates remain open, including:

- minimum number of decisions;
- acceptable maximum drawdown;
- required net return or risk-adjusted return;
- data-quality incident tolerance;
- stability across Strategy versions;
- conditions for extending rather than passing the test.

## O-016 — Real-money phase details

The budget ceiling is JPY 1,000,000 and deployment is staged, but these remain open:

- exact stage amounts and observation periods;
- profit withdrawal versus reinvestment;
- one strategy versus a combination after forward testing;
- brokerage and supported order types;
- tax-account choice and operational controls.

No brokerage integration should be implemented until these are explicitly approved.
