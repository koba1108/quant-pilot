# Open Decisions

These items are intentionally unresolved. Codex must not convert them into permanent policy by preference alone. Resolve them through research, reproducible tests, and human approval where material.

## O-001 — Final market-data provider

Need to choose the production-quality source for:

- adjusted and total-return price history;
- distributions and corporate actions;
- JPY FX series;
- historical listing/delisting state;
- spreads or realistic execution-cost proxies;
- reproducible access and acceptable licensing/cost.

Stooq may be used for research plumbing, but is not yet approved as final evidence.

## O-002 — Distribution and total-return treatment

The virtual portfolio compounds, but the exact accounting remains open:

- whether forecast hit/miss scoring includes distributions;
- how ex-dividend dates and reinvestment dates are modeled;
- how management fees embedded in NAV are separated from explicit costs;
- how distributions are reinvested under monthly rebalancing.

This is the unanswered item that followed the original policy interview; do not assume a final rule.

Implementation note: `src/data/return-normalization.ts` supports explicit `ex_date` and `pay_date` comparison with `same_day_close` reinvestment, but has no default. This is an experimental comparison surface, not an approved accounting policy. Final selection still requires evidence and human approval.

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

## O-004 — Final Universe members

Need to confirm:

- which major countries receive standalone ETFs;
- which gaps justify overseas-listed ETFs;
- how to avoid duplicate exposures tracking similar indices;
- whether any bond or REIT exposure with substantial US components conflicts with the intended diversification role;
- which commodity products have acceptable roll and tracking behavior.

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

## O-006 — Rebalance and replacement rules

Need to compare:

- month-end versus nearby fixed dates;
- next-open versus other realistic execution assumptions;
- immediate top-three replacement;
- rank hysteresis for existing holdings;
- minimum holding periods;
- cost-aware no-trade bands.

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
