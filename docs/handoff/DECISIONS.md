# Approved Decisions

This file records the user's final decisions. Earlier recommendations, alternative choices, and abandoned interview options are not active requirements.

## D-001 — Purpose and role

- Status: Active
- Decision: Quant Pilot complements, rather than replaces, the user's existing US equity index investment.
- Reason: The project is intended to test a second return engine with materially different behavior, not to recreate the same equity beta through another interface.

## D-002 — Research before real money

- Status: Active
- Decision: Complete backtesting before starting formal forward tests. Run three distinct strategies with a virtual JPY 1,000,000 each for at least 12 months.
- Decision: Real-money deployment requires predefined success conditions, not merely a profitable short period.
- Decision: Real-money budget ceiling is JPY 1,000,000 and capital is introduced in stages.
- Reason: Prevent hindsight-based strategy selection and expose differences between simulated and real execution.

## D-003 — Instrument scope

- Status: Active
- Decision: Use ETFs only.
- Decision: Tokyo-listed ETFs are the default; overseas-listed ETFs may fill genuine gaps.
- Decision: Exclude US equity ETFs, crypto-asset ETFs, leveraged ETFs, inverse ETFs, short positions, futures, FX speculation, and options from v0.1.
- Decision: Long-only positions are permitted.
- Reason: Keep the first system understandable, auditable, and implementable while avoiding duplication of the existing US equity index exposure.

## D-004 — Universe shape

- Status: Active
- Decision: Regional equity ETFs are the base; selected major countries may be represented separately.
- Decision: Bond candidates may include sovereign, investment-grade corporate, and high-yield exposures, but their measured risk characteristics—not their labels—determine eligibility.
- Decision: Major commodities may include gold, silver, oil, natural gas, and agriculture. Product structure and roll effects must be reviewed.
- Decision: Include J-REIT and non-US overseas REIT exposures.
- Decision: Include sectors and subsectors. Theme ETFs are permitted only through stricter Quant eligibility checks.
- Decision: Core and theme ETFs use different liquidity, history, and product-quality thresholds.
- Reason: Provide multiple potential return sources while preventing low-quality or fashionable products from entering solely through narrative appeal.

## D-005 — Portfolio construction

- Status: Active
- Decision: Hold at most three ETFs.
- Decision: Buy only ETFs that pass the Quant gate. Unused capital remains cash; 100% cash is permitted.
- Decision: AI selects eligible assets; Quant determines risk-based position sizes.
- Decision: Portfolio concentration must be evaluated by shared risk factors, not only by ticker count or historical pairwise correlation.
- Decision: A hard aggregate limit applies to positions driven by the same macro thesis. The numeric limit remains open pending testing.
- Reason: Preserve meaningful AI selection while preventing a nominally diversified portfolio from becoming a single hidden bet.

## D-006 — Currency treatment

- Status: Active
- Decision: Do not require currency-hedged products. Evaluate realized performance in JPY, including FX movement.
- Reason: JPY is the user's actual reporting and spending currency; the system should measure the investor's real outcome.

## D-007 — AI investment committee

- Status: Active
- Decision: Use three roles: Portfolio Manager, Macro Analyst, and Risk/Critic.
- Decision: The Macro Analyst may forecast one to three months ahead.
- Decision: The Portfolio Manager proposes the final eligible ETFs.
- Decision: Risk/Critic has a limited veto only for predefined material risks, not for vague discomfort.
- Decision: AI may choose 100% cash when confidence or evidence is insufficient, even if Quant has eligible candidates.
- Decision: Each selected thesis records supporting evidence, contrary evidence, forecast direction, horizon, confidence, and expected range.
- Reason: Separate return-seeking, macro interpretation, and loss-prevention responsibilities while keeping all decisions auditable.

## D-008 — Information policy

- Status: Active
- Decision: Use primary sources, major reporting, specialist media, and professional analysis. Exclude social-media sentiment from v0.1.
- Decision: Compare the AI view with market consensus and assess whether the difference is already priced.
- Decision: Evaluate changes in valuation and fundamentals rather than treating a static valuation level as an automatic buy/sell rule.
- Decision: Apply source-type-specific freshness rules and have AI assess whether older information remains valid.
- Decision: Separate fact verification from interpretation. Conflicting interpretations increase uncertainty rather than becoming a fabricated consensus.
- Decision: If evidence is insufficient, perform additional research; if it remains insufficient, skip the asset and record what was missing.
- Reason: Reduce hallucinated narratives, stale inputs, and accidental treatment of commentary as fact.

## D-009 — Normal and emergency trading

- Status: Active
- Decision: Rebalance normally on a monthly schedule.
- Decision: Permit intramonth reassessment only for defined major events, material price/volatility changes, or an AI-determined urgent opportunity.
- Decision: A rule-external opportunity may enter the main virtual portfolio only through an explicit strategy amendment and the applicable review process.
- Decision: AI may judge urgency; every emergency action receives an immediate process audit and a later 30–90 day outcome audit.
- Decision: Each trade must have expected benefit above estimated execution cost plus a safety margin.
- Reason: Retain a monthly system while testing whether controlled adaptability adds value without turning it into reactive news trading.

## D-010 — Drawdown and restart

- Status: Active
- Decision: At intermediate drawdown levels, the AI committee reassesses whether the strategy is experiencing normal weakness or structural failure.
- Decision: A high-water-mark drawdown of -30% triggers mandatory liquidation and stop.
- Decision: After a stop, the AI committee analyzes the cause and may propose restart, revision, or retirement.
- Decision: Restart requires AI analysis, Quant revalidation, and explicit human approval.
- Reason: AI may interpret conditions, but it cannot override the absolute loss boundary or restart a failed system unilaterally.

## D-011 — Backtest integrity

- Status: Active
- Decision: Evaluate long-term, 10-year, 5-year, ETF-realistic, and forward-test layers separately.
- Decision: Prevent look-ahead and survivorship bias and prohibit use of an ETF before listing or after delisting.
- Decision: Long-horizon strategy research may use index/underlying series, but it must be labeled separately from tradable ETF simulation.
- Decision: Include commissions, spread, slippage, FX conversion cost, trading units, management fees, and relevant roll/structure effects.
- Decision: Test rebalance-date, replacement-rule, and parameter robustness rather than selecting the single best historical point.
- Reason: A visually attractive backtest is not evidence unless the strategy could have been executed using information and products available at the time.

## D-012 — Strategy candidates and selection

- Status: Active
- Decision: Research Strategy A (Trend Control), Strategy B (Cross-Asset Rotation), and Strategy C (Adaptive Macro AI).
- Decision: The three forward-test candidates must differ both in logic and in realized historical return characteristics.
- Decision: Quant produces evidence; the AI committee recommends candidates with weaknesses explained; the user approves the final three.
- Decision: Do not decide in advance whether real money uses one strategy or a combination. Compare all combinations after forward testing.
- Reason: Measure the incremental value of AI and avoid sending three nearly identical momentum variants into the forward test.

## D-013 — Strategy evolution

- Status: Active
- Decision: Strategy improvements may be proposed monthly.
- Decision: Review intensity depends on change size. Minor presentation or information-source changes may use simplified review; universe, signal, allocation, or risk changes require full long/10Y/5Y revalidation.
- Decision: AI may learn from all prior forecasts and classify errors, but changes remain versioned and cannot silently rewrite historical strategy definitions.
- Decision: Use current capable AI models when appropriate, but record and evaluate every model change as a strategy-affecting change.
- Reason: Allow adaptation without erasing experimental validity or making performance attribution impossible.

## D-014 — Decision records and data validation

- Status: Active
- Decision: Save a complete decision package: strategy/model versions, timestamped sources, Quant inputs/outputs, committee views, contrary evidence, forecast horizon, final portfolio, execution assumptions, and costs.
- Decision: Validate data through deterministic code, cross-source comparison, and AI semantic review.
- Decision: Missing or inconsistent inputs must be visible and attributable; never hide a data problem by substituting an LLM estimate.
- Reason: Distinguish investment judgment errors from data or implementation errors and enable later re-audit.

## D-015 — AI forecast scoring

- Status: Active
- Decision: In v0.1, score selected ETF forecasts primarily by direction rather than a complex probability-calibration framework.
- Decision: AI declares a one-to-three-month expiry for each thesis before the outcome is known.
- Decision: A positive forecast is counted correct only when total modeled trading costs are exceeded and net return is positive.
- Decision: Score only ETFs actually selected for the portfolio; do not score all rejected candidates.
- Decision: Record ETF-level hit rate and portfolio-level net profit/loss separately.
- Reason: Keep initial evaluation understandable while preserving richer forecast fields for future analysis.

## D-016 — Human intervention and reporting

- Status: Active
- Decision: During virtual forward testing, humans do not override individual trades. The system itself is being evaluated.
- Decision: In real-money operation, the user regains a final veto.
- Decision: Notify immediately only for important actions such as emergency trades, Risk vetoes, strategy changes, or serious drawdown events; otherwise provide a monthly report.
- Decision: Monthly reporting has two layers: a one-minute dashboard and detailed drill-down into committee reasoning, evidence, and Quant metrics.
- Decision: Routine reporting focuses on the AI strategy itself. S&P 500 correlation and complementarity remain research metrics, not the primary dashboard view.
- Reason: Avoid human hindsight contamination in the experiment while keeping real-money safety and understandable oversight.

## D-017 — Runtime and implementation boundaries

- Status: Active
- Decision: Use TypeScript, Bun, and the repository's current Node.js requirement. Keep the project free of Python dependencies.
- Decision: Deterministic calculations and hard safety rules belong in code; AI handles interpretation of unstructured evidence.
- Decision: Do not connect to a brokerage or automate real orders during the research and forward-test phases.
- Reason: A single-language implementation is easier to audit and integrate with the later AI and dashboard layers.

## Explicitly superseded or rejected approaches

The following are not active requirements:

- Locking the strategy unchanged for the entire first 12 months; controlled monthly improvement is allowed.
- Automatic staged risk reduction as the primary drawdown response; AI reassessment is used before the absolute -30% stop.
- Always remaining invested; 100% cash is valid.
- AI confidence being merely decorative; it may support a full skip decision, subject to recording and later evaluation.
- Selecting candidates purely by highest backtested return.
- Displaying the user's combined US-index-plus-AI portfolio as the primary monthly view.
- Scoring every rejected ETF forecast in v0.1.
