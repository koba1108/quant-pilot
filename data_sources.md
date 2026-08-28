# Data Sources v0.1

## Production-grade / authoritative Japan-market source

### JPX / J-Quants Pro family
Use as the preferred authoritative source before live-money deployment.

Required datasets/capabilities:
- Listed Issue Information: point-in-time list of TSE-listed stocks, ETPs and REITs; history from 2008-05-07.
- Stock Prices (OHLC): adjusted/unadjusted OHLC, volume and trading value for TSE-listed stocks, ETPs and REITs; history from 2008-05-07.
- JPX ETF Quoting & Trading Statistics: issue-level spread/depth statistics available from July 2018.

Caveat: the professional JPX datasets are commercial. Do not silently make the research prototype dependent on a costly feed. Keep adapters replaceable.

## Long-term research layer
ETF history is often too short. For Strategy A/B long-term robustness testing, use point-in-time index/underlying total-return series where licensing permits. These results must be labelled `proxy_backtest`, never `etf_realistic_backtest`.

## Strategy C historical information
Do not run a fake 20-year LLM backtest using today's web. Historical AI tests require archived, timestamped information that was actually available at each decision date. Otherwise Strategy C begins with forward testing.

## Data validation gates
1. Instrument existed on decision date.
2. No future-adjusted metadata enters selection.
3. At least required history exists before momentum calculation.
4. Prices are adjusted consistently.
5. Trading value/liquidity is known or the instrument is rejected.
6. Spread is sourced from historical quote statistics where available; otherwise use a conservative fallback and label it estimated.
7. Duplicate exposures are resolved before ranking.
8. Any source disagreement above tolerance stops the affected instrument for that rebalance.

The current repository-level `universe_master.csv` is a candidate catalog, not a Point-in-Time historical dataset. It must not be backdated into earlier simulations. The executable `universe-master-v1` contract requires listing lifecycle, knowledge timestamps, explicit corrections, and record-level provenance; see `docs/universe-master.md`.

The config-only compatibility path is restricted to an explicit `synthetic_fixture` or `proxy` research layer. It has no machine-verifiable ETF/product/currency classification and must not be used as ETF-realistic evidence.

Quality and cross-source results use versioned deterministic policies. A source label declared in config identifies an input claim but is not independent provider attestation and does not approve that source under O-001. Production provenance must come from the adapter. Single-source evidence remains `research_only` or `blocked` according to policy and is never reported as reconciled.

The current quality CLI audits the dataset at the configured backtest end. It does not prove row-level availability at every historical signal date. Until trusted revision-aware adapters and the normalized JPY path are integrated, the ordinary runner reports `research_only` and rejects `etf_realistic` execution.

## Return-basis contract

- Raw or provider-adjusted prices must be labeled; `AdjustedClose` alone is never proof of Total Return coverage.
- Normalized Price Return requires complete Point-in-Time Corporate Action coverage.
- Normalized Total Return additionally requires complete distribution coverage and an explicit accounting policy.
- Every event records availability time and source provenance.
- Foreign-currency prices and distribution income require an exact-date Point-in-Time FX observation with explicit quote direction, availability time, and provenance. Missing observations fail closed.
- Reference-rate valuation does not replace executable FX spread, fee, or broker-conversion assumptions.

See `docs/return-normalization.md`, `docs/distribution-accounting.md`, `docs/fx-normalization.md`, `docs/universe-master.md`, and `docs/data-quality.md`. O-002 is resolved by D-018; final market-data and FX provider selection remains open under O-001.
