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

## Return-basis contract

- Raw or provider-adjusted prices must be labeled; `AdjustedClose` alone is never proof of Total Return coverage.
- Normalized Price Return requires complete Point-in-Time Corporate Action coverage.
- Normalized Total Return additionally requires complete distribution coverage and an explicit accounting policy.
- Every event records availability time and source provenance.
- Foreign-currency distributions stop before normalization until the Point-in-Time FX layer is available.

See `docs/return-normalization.md` for the current experimental contract. O-001 and O-002 remain open.
