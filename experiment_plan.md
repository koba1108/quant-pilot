# Experiment Plan v0.1

## Gate 0 — Data integrity
Pass only after point-in-time membership, adjusted prices, trading value and cost assumptions are reproducible.

## Gate 1 — Quant proxy research
Run Strategy A and B on long-history index/underlying proxies.
Parameter families, not single optimized points:
- Momentum horizons: {3/6/12, 6/12, 12}
- Trend gate: {12M > 0, price > 10M MA, both}
- Portfolio size: {1, 2, 3}
- Rebalance timing perturbation: month-end, ~5 business days before month-end, mid-month

Reject parameterizations whose apparent edge disappears under small timing/parameter perturbations.

Current implementation status: the executable grid covers Strategy A/B weight variants, costs, portfolio size, and volatility windows. It does not yet satisfy this full Gate 1: horizon-family changes, long-trend alternatives, walk-forward/holdout splits, and nearby timing variants remain unimplemented or explicitly unsupported.

## Gate 2 — ETF-realistic research
Use only instruments actually tradable at each date. Apply spread, slippage, commissions, trading units and FX costs. Report separately from Gate 1.

## Gate 3 — Candidate selection
Select three candidates that differ in both logic and realized return path. Historical return alone is not sufficient.

## Gate 4 — Strategy C forward readiness
Freeze the AI decision package schema, source hierarchy, PM/Macro/Risk prompts, veto conditions and audit trail.

## Gate 5 — Forward test
Start three independent virtual portfolios at JPY 1,000,000 each. Minimum observation period: 12 months plus pre-defined acceptance criteria.

## Hard safety rules
- Long only.
- Max three risky ETFs.
- Cash may be 100%.
- No leverage/inverse/crypto.
- Portfolio drawdown at -30% from high-water mark forces liquidation and suspension.
- Restart after hard stop requires AI root-cause analysis, Quant revalidation and explicit human approval.
