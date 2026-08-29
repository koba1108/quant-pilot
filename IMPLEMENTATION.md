# Implementation

Pythonで作っていた初期骨格はTypeScriptへ全面移行した。Python依存はない。

Codex Project移行後の統合指示は `docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`、現在の詳細状態は `docs/handoff/CURRENT_STATUS.md`、Forward Testまでのdelivery順序は `docs/handoff/EXECUTION_ROADMAP.md` を参照すること。

## Implemented baseline and current branch

PR #9までの基盤は`main`に含まれる。O-001を確定せずにproduction provider候補をfail-closed評価する契約、公式URL/evaluation snapshot、J-Quants v2 read-only research adapterまでマージ済みである。現在のdelivery milestoneはM1 Credentialed data sliceである。

### Strategy

- `src/strategies/trend.ts`: Strategy A Trend ranking
- `src/strategies/rotation.ts`: Strategy B Cross-Asset Rotation ranking
- `src/strategies/types.ts`: normalized strategy inputs and parameter contracts

### Portfolio / Risk

- `src/portfolio/allocator.ts`: inverse-volatility allocation
- `src/portfolio/risk.ts`: maximum drawdown / -30% hard stop
- `src/portfolio/costs.ts`: turnover-aware execution costs
- `src/portfolio/distribution-ledger.ts`: Point-in-Time distribution receivable, revision, payment, rebalance-cash, and forecast-scoring ledger

### Data

- `src/data/models.ts`: normalized market / Universe models
- `src/data/universe.ts`: point-in-time Universe eligibility primitives
- `src/data/provider.ts`: `MarketDataProvider` abstraction and daily-bar validation
- `src/data/csv.ts`: CSV fallback provider
- `src/data/stooq.ts`: Stooq research provider
- `src/data/jquants-v2.ts`: J-Quants API v2 read-only daily-bar adapter spike; unadjusted proxy research only
- `src/data/eodhd-eod.ts`: EODHD EOD comparison adapter with query-token redaction and strict daily-bar parsing
- `src/data/provider-http-capture.ts`: exact response-byte capture, credential-echo rejection, and retained-header allowlist
- `src/data/artifact-store.ts`: immutable content-addressed filesystem artifact store
- `src/data/provider-sample-artifacts.ts`: raw-to-daily lineage and field-specific observation artifacts
- `src/data/credentialed-sample-config.ts`: strict fixture/live schema and G1/G2 authorization records
- `src/data/credentialed-sample-runner.ts`: fixture/live capture, reconciliation, fail-closed audit, and offline replay CLI
- `src/data/provider-evaluation.ts`: O-001 capability, evidence, source-bundle, license, cost-approval, and integrity evaluator
- `src/data/provider-evaluation-runner.ts`: deterministic provider-evaluation CLI
- `src/data/return-normalization.ts`: explicit Price Return / Total Return normalization, event coverage, provenance, and Point-in-Time validation
- `src/data/fx-normalization.ts`: Point-in-Time FX observations, revisions, exact-date amount conversion, and unhedged JPY return normalization
- `src/data/point-in-time-return-source.ts`: provider-neutral Point-in-Time normalized return source with signal-prefix pinning, signal/forward snapshots, revision selection, and full fingerprints
- `docs/return-normalization.md`: return-normalization semantics and explicit policy boundaries
- `docs/distribution-accounting.md`: D-018 distribution-accounting semantics
- `docs/fx-normalization.md`: JPY FX calculation, audit contract, official evidence, and limitations
- `docs/provider-evaluation.md`: official-source provider comparison, production gate, adapter boundary, and credentialed-sample plan
- `docs/credentialed-sample.md`: M1 executable contract, live gates, replay behavior, and remaining evidence gaps

### Backtest

- `src/backtest/simulator.ts`: monthly compounding simulator
- `src/backtest/metrics.ts`: cumulative return / CAGR / volatility / Sharpe / Sortino, with explicit incomplete-calendar-year metadata
- `src/backtest/frame-builder.ts`: daily bars to monthly signals, actual trading-date cutoffs, pinned normalized prefixes, realized-return month labels, and next-month returns
- `src/backtest/runner.ts`: config-driven Strategy A/B CLI with explicit `price_return` / `total_return` opt-in and exact-date JPY conversion
- `backtest.config.example.json`: runnable configuration example

### AI

- `src/ai/`: Strategy C area. PM / Macro Analyst / Risk-Critic will consume validated, timestamped inputs. Strategy C is not implemented yet.

## Included on `main` through PR #8

### Point-in-Time Universe

- `src/data/universe-master.ts`: strict versioned CSV loader, revision-chain validation, listing/last-eligible bounds, D-003 product flags, currency capability, and decision-time snapshot resolution
- `src/data/universe.ts`: decision-date eligibility diagnostics with no implicit liquidity or history substitution
- `src/backtest/runner.ts`: opt-in `universeMasterPath`, per-frame Point-in-Time resolution, full decision provenance, applied observation/artifact IDs, and execution-boundary input-integrity checks
- `docs/universe-master.md`: v1 schema, inclusive date semantics, provenance, and legacy-catalog boundary

The repository-root `universe_master.csv` remains a legacy research catalog. It lacks the timestamps and lifecycle fields needed for safe backtest membership and is intentionally rejected by the strict v1 loader. The config-only compatibility path now requires an explicit `synthetic_fixture` or `proxy` research label.

### Data quality and reconciliation

- `src/data/provenance.ts`: canonical hashing and versioned raw/normalized artifact lineage
- `src/data/data-quality.ts`: deterministic quality findings and `pass` / `research_only` / `blocked` disposition
- `src/data/reconciliation.ts`: parent-artifact-bound observation evidence, consumer-side semantic recomputation, and explicit source comparison without silently selecting a winning source
- `src/data/data-quality-runner.ts`: config-driven quality CLI using the same input-loading path as the backtest
- `docs/data-quality.md`: policy, failure behavior, and current source limitations

### Strategy A/B robustness

- `src/backtest/robustness-grid.ts`: `robustness-grid-v2` deterministic parameter-grid execution and stability summaries, with machine-readable `research_only` / `not_normalized` boundaries
- Strategy A/B ranking functions accept validated versioned parameter overrides while preserving current defaults
- Grid cells report unsupported rebalance/replacement rules explicitly instead of substituting current behavior
- `docs/robustness-grid.md`: supported axes, metrics, fingerprints, and interpretation boundary
- `ReturnEventCoverage.availableAt`, synthetic_same_day_close_v1, and corrected realized-return/hard-stop labels are covered by the normalized fixtures.

No grid cell is automatically promoted to an approved strategy. O-005 and O-006 remain open.

## Runtime

Primary target is Bun:

```bash
bun install
bun test
bun run backtest --config=backtest.config.json
```

The repository currently requires Node.js 26.7.0 or later. Bun is the primary workflow.

## Design boundary

Deterministic calculations, data validation, execution costs, portfolio constraints, and safety controls belong in TypeScript code. AI is used for interpretation of macro/news/policy/consensus and cannot silently override hard constraints.

Stooq is a research plumbing provider only. Do not interpret Stooq-only OHLCV results as final dividend-aware or production-grade investment evidence.

## Verification state

On `main` through merged PR #9:

- Runtime: Node.js `v26.7.0`, Bun `1.3.14`
- `bun install`: success, no dependency changes
- `bun test`: 152 pass / 0 fail
- `bunx tsc --noEmit`: success
- raw strict-Universe Trend and Rotation fixture CLIs: success
- normalized Trend and Rotation fixture CLIs: success and byte-for-byte reproducible
- data-quality CLI: success with expected `research_only` disposition
- robustness CLI: success; 16 completed and 16 explicit unsupported cells

PR #7 verification (completed before merge; now present on `main`):

- `bun test`: 105 pass / 0 fail
- `bunx tsc --noEmit`: success
- strict v1 Universe Trend CLI: success
- strict v1 Universe Rotation CLI: success
- data-quality CLI: success with the expected `research_only` disposition
- robustness grid CLI: success; 16 supported cells completed and 16 unimplemented timing/replacement cells reported as unsupported
- every ordinary backtest output is explicitly `research_only`; unsupported `etf_realistic` execution fails closed

The committed fixtures are synthetic unadjusted Price data. They validate code behavior, not investable historical performance, production data quality, or a final provider choice.

The normalized Trend/Rotation fixtures use `synthetic_same_day_close_v1` and remain synthetic research evidence, not investment evidence. PR #8 is merged as commit `12ad9fe1519cb2bf38aac72297bd76ec3f92a817`.

PR #9 provider-evaluation verification now present on `main`:

- `bun test`: 152 pass / 0 fail
- `bunx tsc --noEmit`: success
- all existing raw/normalized backtest, data-quality, and robustness executable paths still pass
- provider-evaluation output is deterministic; normal audit execution succeeds while `--require-production` returns the expected nonzero status
- `provider-evaluation-v1` rejects unknown fields, ambiguous selection, invalid evidence dates, duplicate capabilities, missing evidence references, fake/unbound or capability-incompatible sample artifacts, same-group pseudo-independent sources, unbound official/terms snapshots, weak approved policies, and every `status=verified` claim until a future payload-specific schema binds real reconciliation
- reports bind evidence/candidate/bundle fingerprints and are re-evaluated from the input config, so re-fingerprinted output tampering is rejected
- schema v1 remains `selection=not_selected`, `failClosed=true`, `canEnableEtfRealistic=false`; URL/version-only terms evidence keeps license overall `unknown`, and no capability can become `verified` until a real reconciliation report and typed payload validation are bound
- the committed O-001 snapshot evaluates J-Quants＋EODHD and J-Quants＋Twelve Data as blocked pending credentialed samples, PIT/revision proof, event/quote coverage, license rights, cost approval, and human selection
- J-Quants adapter tests cover official-host credential confinement, pagination, header authentication, semantic dates, four/five-character code normalization, no-trade null-row exclusion, strict rows, range matching, missing optional values, repeated pages, duplicate dates, malformed JSON, and HTTP failures
- real J-Quants credentials and downloaded provider data are not used or committed

Active M1 credentialed-sample branch verification:

- `bun test`: 195 pass / 0 fail
- `bunx tsc --noEmit`: success
- fixture capture: success for five mappings across J-Quants/EODHD contracts; 10 raw, 10 daily-bar, 105 observation, and one audit artifact
- offline replay: success without provider access and byte-for-byte identical to capture output
- fixture reconciliation: `advisory`; 15 EODHD-missing trading-value groups remain explicit `insufficient_sources`
- `--require-live-evidence` and `--require-production`: expected nonzero status
- Git ignore check: generated runtime artifact root is ignored
- no real credential, provider request, paid entitlement, or retained vendor response was used

## Next blocks

1. Follow `docs/handoff/EXECUTION_ROADMAP.md`; do not begin work outside its active milestone
2. M1: use the implemented fixture-tested credentialed-sample capture/audit command only after obtaining G1/G2 authorization for a real fetch and retained vendor response
3. M2: deliver the manual Pre-Forward vertical slice with an idempotent virtual ledger and replayable Decision Package
4. Keep formal Forward Test, unattended scheduling, Strategy C, and real-money work behind their documented gates
