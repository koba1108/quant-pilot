# Implementation

Pythonで作っていた初期骨格はTypeScriptへ全面移行した。Python依存はない。

Codex Project移行後の統合指示は `docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`、現在の詳細状態は `docs/handoff/CURRENT_STATUS.md`、Forward Testまでのdelivery順序は `docs/handoff/EXECUTION_ROADMAP.md` を参照すること。

## Implemented baseline and current branch

PR #11までのM0/M1基盤は`main`に含まれる。O-001を確定せずにproduction provider候補をfail-closed評価し、credentialed sampleをimmutable artifactへ保存してoffline replayする経路までマージ済みである。現在のdelivery milestoneはM2 Manual Pre-Forward vertical sliceである。

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
- `docs/pre-forward.md`: M2 manual virtual-cycle contract, replay/idempotency behavior, and real-data gate

### Backtest

- `src/backtest/simulator.ts`: monthly compounding simulator
- `src/backtest/metrics.ts`: cumulative return / CAGR / volatility / Sharpe / Sortino, with explicit incomplete-calendar-year metadata
- `src/backtest/frame-builder.ts`: daily bars to monthly signals, actual trading-date cutoffs, pinned normalized prefixes, realized-return month labels, and next-month returns
- `src/backtest/runner.ts`: config-driven Strategy A/B CLI with explicit `price_return` / `total_return` opt-in and exact-date JPY conversion
- `backtest.config.example.json`: runnable configuration example

### Manual Pre-Forward

- `src/pre-forward/config.ts`: strict `pre-forward-config-v2`, version validity, JPY-only M2 capability, positive D-009 safety margin, explicit synthetic benefit evidence, and approved risk constraints
- `src/pre-forward/market-input.ts`: retained synthetic/credentialed daily-bar input classification without Total Return relabeling; synthetic v3 artifacts explicitly bind complete no-event coverage through the decision cutoff
- `src/pre-forward/config-snapshot.ts`: exact validated config retention and content-addressed replay binding
- `src/pre-forward/credentialed-config-snapshot.ts`: exact nested M1 credentialed-sample config retention for path-independent replay
- `src/pre-forward/decision.ts`: Strategy A/B snapshots, per-order expected-benefit-versus-cost audit, chronology/event-coverage-gated valuation, virtual orders/executions, costs, positions/cash, distribution-state handling, maximum three holdings, and -30% hard stop
- `src/pre-forward/ledger.ts`: owner-only Bun SQLite run index and append-only hash-chained portfolio transitions
- `src/pre-forward/runtime-binding.ts`: fixed per-portfolio physical artifact-root binding outside the configurable store, requiring an explicit audited migration before relocation
- `src/pre-forward/runner.ts`: explicit-`asOf` execute/replay CLI, stable artifact-root binding plus retained-artifact run-key lookup before ledger selection, one normal run per portfolio/Asia-Tokyo market month, actual package-creation provenance, and fail-closed credentialed-audit loading
- `src/pre-forward/fixture-seeder.ts`: deterministic content-addressed fixture artifacts
- `tests/fixtures/pre-forward/config.json`: committed synthetic acceptance config; runtime outputs remain under ignored `data/generated/`

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
- the committed O-001 snapshot evaluates J-Quants＋EODHD and J-Quants＋Twelve Data as blocked. A bounded direct J-Quants credentialed probe succeeded for five JPX codes over 2026-04-20..22, while the current-account EODHD probe found no Japan/XJPX/Tokyo exchange, HTTP 404 for `1308.TSE`, and no Japanese `search/1308` result. EODHD remains an overseas/FX candidate, not a JPX daily-price comparator; PIT/revision proof, event/quote coverage, license rights, immutable artifact retention, cross-source reconciliation, and human selection remain open.
- J-Quants adapter tests cover official-host credential confinement, pagination, header authentication, semantic dates, four/five-character code normalization, no-trade null-row exclusion, strict rows, range matching, missing optional values, repeated pages, duplicate dates, malformed JSON, and HTTP failures
- real J-Quants/EODHD credentials were used only for the authorized bounded capture and are not committed; raw responses were persisted only in the owner-only Git-ignored local artifact store

Merged PR #11 M1 credentialed-sample verification:

- `bun test`: 198 pass / 0 fail
- `bunx tsc --noEmit`: success
- fixture capture: success for five mappings across J-Quants/EODHD contracts; 10 raw, 10 daily-bar, 105 observation, and one audit artifact
- offline replay: success without provider access and byte-for-byte identical to capture output
- fixture reconciliation: `advisory`; 15 EODHD-missing trading-value groups remain explicit `insufficient_sources`
- `--require-live-evidence` and `--require-production`: expected nonzero status
- Git ignore check: generated runtime artifact root is ignored
- authorized live capture after G1/G2 approval: five J-Quants successes with 15 bars, five EODHD HTTP 404 failures, 10 raw artifacts, five daily artifacts, 60 observations, and one `captureStatus=partial` audit
- live offline replay is canonical-equal and returns the expected nonzero status; artifacts stay outside Git with owner-only permissions, and a local scan found no credential bytes

Active M2 manual Pre-Forward branch verification:

- `bun test`: 212 pass / 0 fail
- `bunx tsc --noEmit`: success
- fixture seed and first run: Trend/Rotation both execute from JPY 1,000,000, each creates three virtual holdings, three orders, JPY 1,845 modeled cost, and JPY 1,057 ending cash
- repeated invocation: same Decision Package IDs, `idempotent=true`, no state transition, no duplicate order or cash movement
- explicit Decision Package replay: retained config, strategy, inputs, Universe, canonical decision/artifact, and the ledger path from the retained config reproduce without another state transition
- D-009 regression: marginal synthetic expected benefit produces no order; each executed ordinary order records a strict benefit-above-cost-plus-positive-margin pass
- intramonth regression: a different cutoff in an already recorded Asia-Tokyo market calendar month is rejected even when its ISO offset displays a different month
- provenance regression: market `asOf` remains distinct from actual Decision Package `createdAt`, and replay preserves both timestamps
- Point-in-Time artifact regression: a daily-bars artifact cannot claim observation/availability before one of its contained trading dates, including timestamps whose UTC offset masks an earlier instant
- lifecycle/availability regressions: signal history excludes pre-listing rows, and a same-day close is unavailable before the conservative `07:00:00Z` floor
- execution-boundary regressions: stale validated-config fingerprints, unbound strategy overrides, and loaded-input mutation are rejected before a Decision Package is built
- aggregate-cost regression: per-instrument one-way cost at or above 100% is rejected at config validation
- config replay regression: a later valid execution-policy and strategy-config revision cannot change or invalidate the historical replay
- runtime relocation regression: a later current-config ledger path cannot redirect replay or ordinary duplicate detection, a future cycle rejects ledger relocation, and moving both artifact/ledger roots cannot hide history without an explicit audited migration
- credentialed-config replay regression: changing the original nested sample-config file cannot alter normal duplicate invocation or explicit historical replay
- Universe replay regression: each decision retains the exact content-addressed master snapshot, so a later valid future-dated revision cannot change or invalidate the historical replay
- held-valuation regression: missing split/distribution coverage blocks valuation and liquidation; a stopped portfolio cannot bypass chronology
- cutoff-coverage regression: event coverage ending at the latest bar cannot authorize held-unit valuation when the decision cutoff is later
- retained J-Quants live-audit replay: expected exit code 1; both strategies remain fully in cash with no transition and explicit insufficient-history, stale-data, missing-Universe, and missing-execution-assumption blockers
- ledger database and artifact root use owner-only permissions on POSIX; SQLite update/delete triggers and hash-chain verification enforce append-only behavior
- hard-stop integration test liquidates a held asset at -30% only when explicit complete synthetic no-event coverage proves the stored unit basis; otherwise it fails closed without a valuation or order
- every output remains `pre_forward_dry_run`, `research_only`, and `formalForwardClockStarted=false`

## Next blocks

1. Follow `docs/handoff/EXECUTION_ROADMAP.md`; do not begin work outside its active milestone
2. M2: review and merge the manual Pre-Forward software vertical slice; do not call the synthetic success an M2 real-data completion
3. M2 evidence gate: after separate scope approval, retain enough licensed J-Quants history plus strict Point-in-Time Universe and versioned execution assumptions for one real virtual-money cycle
4. Connect retained distribution and Corporate Action events before advancing a held portfolio to a later `asOf`; until then the runner must continue to block rather than assume no event or misvalue split-adjusted units
5. Keep formal Forward Test, unattended scheduling, Strategy C, and real-money work behind their documented gates
