# Current Status

Snapshot date: 2026-08-31

## Repository state

- Repository: `koba1108/quant-pilot`
- Local checkout: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Latest merged PR: #11 (`fix: retain partial credentialed provider evidence`)
- Latest merged commit: `60aa5266100945583f9dc1b4eff4d9bd70a76b52`
- Active implementation branch: `ykoba/pre-forward-manual-cycle`
- Active PR: #12 (`feat: add manual pre-forward virtual cycle`)
- Active delivery milestone: M2 — Manual Pre-Forward vertical slice
- Delivery roadmap: `docs/handoff/EXECUTION_ROADMAP.md`
- Formal Forward-Test clock: not started

## Implemented on main through PR #11

### Deterministic Strategy A/B engine

- Trend and Cross-Asset Rotation ranking
- inverse-volatility allocation with a hard maximum of three holdings
- turnover-aware transaction costs, including stop liquidation
- -30% high-water-mark hard stop and ending-cash behavior
- strict monthly signal/forward-frame construction with explicit missing-history diagnostics
- config-driven CSV and Stooq research paths with commit-safe synthetic fixtures

### Point-in-Time financial-data foundations

- versioned Price Return / Total Return normalization
- explicit distribution and Corporate Action coverage/provenance checks
- D-018 ex-date research return and separate receivable/pay-date virtual-account ledger
- exact-date non-JPY to JPY normalization with corrected-observation chains
- provider-neutral bar/event/FX observation source with row-level availability, revision resolution, signal-prefix pinning, and separate signal/forward snapshots
- strict `universe-master-v1` loader with corrections, lifecycle, status, currency, provenance, and D-003 product gates
- data-quality and field-specific source-reconciliation contracts
- Strategy A/B robustness grid without automatic parameter selection

### Main verification baseline

- Node.js: `v26.7.0`
- Bun: `1.3.14`
- `bun install`: pass, no dependency changes
- `bun test`: 198 pass / 0 fail
- `bunx tsc --noEmit`: pass
- raw strict-Universe Trend and Rotation CLIs: pass
- normalized Trend and Rotation CLIs: pass and byte-for-byte reproducible
- data-quality CLI: pass with expected `research_only`
- robustness CLI: pass; 16 completed cells and 16 explicit unsupported cells

All end-to-end fixtures on main are synthetic research evidence. They do not prove investable returns, provider quality, or executable market conditions. `etf_realistic` remains rejected.

## Provider evaluation implemented by PR #9

### O-001 provider-evaluation contract

- `src/data/provider-evaluation.ts` defines strict candidate, evidence, capability, source-bundle, license-right, cost-approval, and proposed-policy contracts.
- Input rejects unknown fields, invalid/future evidence dates, duplicate IDs/capabilities, references to unknown evidence IDs, malformed hashes, ambiguous selection, fake/unbound or capability-incompatible sample artifacts, same-group pseudo-independent sources, unbound official/terms snapshots, weak approved policies, and every `status=verified` claim until a future schema supplies typed payload validation and bound reconciliation.
- Output uses deterministic `pass` / `research_only` / `unknown` / `blocked` dispositions plus canonical evidence, config, candidate, bundle, and report fingerprints. Integrity validation re-evaluates the result from its config, so merely recomputing a forged output fingerprint is insufficient.
- A source bundle is the acceptance unit; capabilities have explicit provider responsibilities and independent-source requirements.
- The evaluator never computes a provider score, selects a winner, fills missing capabilities, or chooses a conflicting source.
- Schema v1 permits only `selection=not_selected`, counts no source as payload-verified, always emits a research-only reconciliation boundary, and remains `failClosed=true` with `canEnableEtfRealistic=false` until a real reconciliation report and separate human-approved O-001 selection are implemented.
- `src/data/provider-evaluation-runner.ts` and `bun run provider-evaluation` provide a deterministic JSON CLI. `--require-production` returns nonzero while the report is fail-closed or cannot enable `etf_realistic`, even if a future bundle satisfies the evidence checks.

### Official evidence snapshot

`research/provider-evaluation/o001-candidates.json` records official-material claims checked on 2026-08-29 for:

- J-Quants API individual access
- EOD Historical Data individual access
- Twelve Data individual access

It evaluates two research bundles:

- J-Quants primary plus EODHD complement
- J-Quants primary plus Twelve Data complement

Both bundles currently report `blocked`, `selection=not_selected`, `failClosed=true`, and `canEnableEtfRealistic=false`. An owner-only local audit now retains J-Quants responses for five JPX codes over 2026-04-20..22 and EODHD HTTP 404 responses for the same five `.TSE` mappings. The current-account discovery probe also found no Japan/XJPX/Tokyo exchange and no Japanese `search/1308` result; EODHD remains an overseas/FX candidate, not a JPX daily-price comparator. Neither bundle is adopted.

The committed machine snapshot contains no downloaded market data, credentials, private vendor responses, or contract documents. G1/G2 authorized the bounded local capture, whose immutable artifacts remain Git-ignored and are not embedded in the machine snapshot. Official URLs, checked dates, and explicit unversioned-page labels remain discovery evidence, not immutable document snapshots. Accordingly, all three machine-readable overall license assessments remain `unknown`; the human report separately records restrictions visible in the public terms.

### J-Quants adapter spike

- `src/data/jquants-v2.ts` calls the official v2 daily-bars endpoint with `x-api-key` header authentication and pagination.
- It restricts credentialed requests to the official HTTPS host and validates four/five-character security codes, provider/internal-code mapping, semantic request bounds/dates, raw/adjusted prices, adjustment factor, volume, trading value, malformed JSON, HTTP failures, pagination loops, and duplicate dates.
- Official no-trade rows with null prices are explicitly excluded; inconsistent partial nulls are rejected. Missing optional volume/trading value remains `undefined`; no missing value is replaced with zero or a prior value.
- Runner use is restricted to `provider=jquants_v2`, `returnBasis=unadjusted_price`, and `researchLayer=proxy`.
- The adapter does not treat `AdjC` as normalized Price Return or Total Return and does not invent availability, revisions, distributions, FX, Universe, or calendar evidence.
- Contract tests use mocked API responses. The bounded local credentialed audit retained successful J-Quants responses for `1308`, `1348`, `1473`, `1597`, and `2510` over `2026-04-20..22`; it remains `credentialed_sample_unverified`, not a production artifact.

### Technical report

- `docs/provider-evaluation.md` is the versioned answer-first report.
- It compares individual and institutional candidates, defines evidence status, explains the production gate and bundle model, documents the adapter boundary, and specifies the credentialed sample plan.
- The Data Analytics portable HTML packager was attempted from a canonical artifact, but its shared reader remained in fallback state during static-chart extraction. No HTML file was published; the Markdown report is the current durable artifact.

### PR #9 verification now on main

- `bun test`: 152 pass / 0 fail
- `bunx tsc --noEmit`: pass
- raw strict-Universe Trend and Rotation: pass; 18 months, final equity `833426`, max holdings 3, modeled cost rate approximately `0.002`, stop `2025-02`, `research_only`
- normalized Trend and Rotation: pass; `price_return`, 18 months, final equity `833426`, max holdings 1, modeled cost rate `0.002`, stop `2025-02`, `research_only`
- normalized repeated output: byte-for-byte deterministic for both strategies
- data-quality CLI: pass; `research_only`, no cross-source reconciliation
- robustness CLI: pass; 32 cells, 16 completed and 16 explicit unsupported, `research_only`
- provider-evaluation CLI: pass as an audit command; both bundles `blocked`, repeated output byte-for-byte deterministic; config fingerprint `sha256:9f635ad2a0bc5db89e2a62a17474e37610b3658070779251c0fe00e03c2408ee`
- provider-evaluation `--require-production`: expected exit code 1
- official evidence URL reachability check: all 22 committed URLs returned HTTP 200 on 2026-08-29; this is not content immutability or contract verification

## M1 credentialed-sample live checkpoint merged by PR #11

- `bun run credentialed-sample --config=research/provider-samples/fixture.config.json` now executes one complete fixture path for five JPX mappings through the J-Quants and EODHD contracts.
- J-Quants captures exact response bytes after header-auth requests; EODHD sends its documented query token only to the fixed HTTPS endpoint and removes it completely from retained request metadata. Both reject redirects.
- Raw responses, normalized daily bars, field observations, and the final audit use immutable content-addressed artifacts with read/write integrity checks and atomic no-clobber storage.
- The fixture produces 10 raw-response artifacts, 10 daily-bar artifacts, 105 field observations, and one audit artifact. Offline replay revalidates all lineage and produces byte-for-byte identical output without provider access.
- Close, provider-adjusted close, and volume compare across both sources. EODHD daily EOD has no trading-value field, so all 15 trading-value groups remain explicit `insufficient_sources` findings.
- The output remains `fixture_contract`, `research_only`, `selection=not_selected`, `failClosed=true`, and `canEnableEtfRealistic=false`.
- Live mode requires 5–10 mappings, four config authorization records, the same four runtime authorization flags, and nonempty credential environment variables before directory creation or network access.
- Final PR #11 verification: `bun test` 198 pass / 0 fail; `bunx tsc --noEmit` pass; fixture capture/replay is byte-for-byte identical; live replay is canonical-equal; partial/live-production gates return the expected nonzero status.
- Artifact storage is owner-only on POSIX (`0700` root, `0600` files), and live config cannot redirect unrelated environment secrets into a provider request.
- The authorized live runner retained 10 raw responses, five J-Quants daily artifacts with 15 bars, 60 observations, five EODHD HTTP 404 failures, and one partial audit. Offline replay was canonical-equal and performed no fetch.
- Local replay checkpoint: audit `sha256:084d2ac0fdd9a57b6d792506a05b9441e01879a70d6ed9c17af044e6a036db1e` in the ignored `data/generated/provider-samples/live-v1-artifacts` store.
- The local store contains 76 files with `0700` root/`0600` file permissions. A credential-byte scan of retained JSON and decoded bodies found no key. No live config, vendor response body, credential, paid entitlement, or license-restricted artifact is committed.

## M2 Manual Pre-Forward checkpoint on the active branch

- `bun run pre-forward:seed-fixture --config=tests/fixtures/pre-forward/config.json` creates four deterministic, content-addressed synthetic daily-bar artifacts under the ignored runtime boundary.
- `bun run pre-forward --config=tests/fixtures/pre-forward/config.json --as-of=2025-01-07T00:00:00Z` runs Trend and Rotation from separate virtual JPY 1,000,000 portfolios.
- The successful synthetic cycle creates three virtual holdings and three buy orders per strategy, applies JPY 1,845 modeled cost, and ends with JPY 1,057 cash. These identical strategy results are a property of the deliberately identical fixture, not comparative performance evidence.
- Repeating the same command returns the same Decision Package IDs with `idempotent=true` and no additional ledger transition, order, or cash movement.
- `--replay-decision=sha256:<id>` rebuilds the canonical Decision Package from retained inputs/opening state, checks artifact and ledger binding, and applies no transition.
- Each immutable `pre-forward-decision-package-v5` records the explicit cutoff and actual creation timestamp, validated-config and loaded-input integrity fingerprints, data classifications and artifact IDs, strict Universe decisions, lifecycle/availability counts, instrument blockers, Strategy A/B ranking and weights, D-009 expected-benefit/cost decisions, holding-period event coverage, virtual orders/executions, modeled costs, before/after state, high-water mark, distribution-accounting coverage, and ledger head.
- Bun SQLite stores an append-only run index and hash-chained state transitions. Update/delete triggers reject mutation; runtime directories and databases are owner-only on POSIX.
- The run key permits one normal cycle per portfolio/calendar month. A different cutoff in the same month is rejected until a defined D-009/O-009 emergency mode and audit contract are approved.
- Every ordinary initial-allocation order requires explicit Point-in-Time gross expected benefit strictly above one-way execution cost plus a positive safety margin. The committed values are synthetic fixture assumptions only; ordinary held-asset replacement remains blocked pending O-006, while mandatory D-010 liquidation retains priority.
- The maximum-three-holding constraint and -30% high-water-mark stop are asserted at the config, Decision Package, execution, and integration-test boundaries. Safety liquidation remains authoritative only after complete holding-period Corporate Action/distribution coverage proves the stored unit basis; missing coverage blocks valuation and liquidation rather than turning a split into a false drawdown. Synthetic `pre-forward-daily-bars-v2` fixtures explicitly declare complete no-event coverage, while credentialed retained bars do not.
- Safety handling never bypasses portfolio chronology. Daily-bars artifacts are rejected when their observation/availability dates predate contained market rows; signal history excludes rows before the resolved ETF listing date and same-day closes before the conservative `07:00:00Z` availability floor.
- The Decision Package build boundary revalidates the full config, binds the selected strategy exactly to that config, and rejects any loaded input changed after artifact validation.
- The existing three-day J-Quants live audit can be loaded through M1 offline replay without credentials or network access. Both strategies correctly return blocked, keep JPY 1,000,000 in cash, and apply no ledger transition because history, data freshness, strict Universe, execution assumptions, and expected-benefit evidence are incomplete.
- Active-branch verification: `bun test` 212 pass / 0 fail; `bunx tsc --noEmit` pass; fixture execute/repeat/replay, D-009 marginal-trade rejection, intramonth rejection, creation-time provenance, held-event-coverage/chronology guards, artifact/listing/intraday availability and loaded-input/config integrity validation, and retained live-audit blocking behave as expected; `git diff --check` passes.
- Every result remains `pre_forward_dry_run`, `research_only`, and `formalForwardClockStarted=false`. The synthetic success is not the M2 real-data exit criterion and does not start formal Forward Test.

## O-001 findings preserved as open

### Individual-access candidates

- J-Quants is the strongest TSE primary-data candidate and has transparent individual pricing, but adjusted prices are not proven Total Return, JPY FX is absent, ETF distribution completeness is unverified, corrections overwrite older values, and private-use retention/redistribution rules are restrictive.
- EODHD remains a low-cost overseas/FX candidate, but the current-account JPX coverage probe was negative; Japanese ETF event completeness, Tokyo quote history, source-native PIT/revisions, plan entitlement, and durable retention remain unverified. This does not claim permanent global EODHD Japan unavailability.
- Twelve Data is an alternative for explicit adjustment modes and FX, but listing/delisting history, Tokyo quote quality, ETF distribution lifecycle fields, PIT revisions, and long-term audit rights remain weaker or unknown.

### Institutional comparison

- LSEG DataScope Select/Plus is the strongest published technical candidate, subject to Japan ETF sample, PIT/revision, contract, and price verification.
- SIX Web API/VDF/Ultumus offers a useful trial/contact path, subject to Japan coverage, PIT, license, and price confirmation.
- Bloomberg Data License remains a high-quality benchmark/future candidate; public materials do not establish the exact Japan ETF entitlement, minimum agreement, or complete required contract.

No provider is selected. No cost, contract, retention policy, FX fixing, calendar policy, or production source priority is approved.

## Required validation coverage

- PASS — Trend and Rotation both execute on committed fixtures
- PASS — identical input/config produces identical output
- PASS — insufficient history is an explicit exclusion
- PASS — pre-listing and post-last-eligible bars are not used
- PASS — signals use no data after the asset-specific decision point
- PASS — transaction costs reduce portfolio results
- PASS — maximum holdings remain three or fewer
- PASS — -30% high-water-mark stop is enforced
- PASS — missing values are never implicitly replaced with zero or a prior value
- PASS — provider-evaluation ordering is deterministic and report mutation is detected
- PASS — J-Quants mocked adapter fails closed on unsafe response data
- PASS — five-mapping J-Quants/EODHD fixture capture creates immutable raw/normalized/observation/audit artifacts
- PASS — offline replay performs no fetch and is byte-for-byte deterministic
- PASS — credential values, redirects, tracked artifact roots, independent-source duplication, range escape, and artifact tampering fail closed
- PASS — missing EODHD trading value remains `insufficient_sources` and provider-adjusted close remains non-Total-Return
- PASS (bounded research-only audit) — retained J-Quants responses for five JPX codes over 2026-04-20..22 and canonical-equal offline replay
- PASS (explicit negative coverage) — retained EODHD HTTP 404 for all five tested `.TSE` mappings; separate discovery probes found no Japan/XJPX/Tokyo in the current exchange list and no Japanese `search/1308` result
- BLOCKED — real cross-source value reconciliation; EODHD supplied no JPX bars, so all 60 retained field groups remain `insufficient_sources`
- PASS (synthetic M2 path) — Trend/Rotation virtual orders, positions, cash, modeled costs, immutable Decision Packages, and append-only state transitions complete
- PASS — duplicate M2 invocation and explicit Decision Package replay create no duplicate order, transition, or cash movement
- PASS — each ordinary synthetic order passes an auditable expected-benefit > execution-cost + positive-safety-margin comparison; marginal trades remain cash
- PASS — a second cutoff in the same portfolio/month is rejected, and Decision Package creation provenance is not backdated to historical `asOf`
- PASS — split/distribution coverage is required before held-unit valuation or safety liquidation; missing coverage leaves state unchanged
- PASS — safety handling cannot move `lastAsOf` backward, and a daily-bars artifact cannot predate one of its rows
- PASS — pre-listing rows cannot satisfy signal history, and a same-day closing row is excluded before its conservative availability floor
- PASS — validated config, selected strategy, and loaded market input cannot diverge silently at the Decision Package boundary
- PASS — incomplete retained J-Quants input blocks with no virtual state transition
- BLOCKED — one complete real-data M2 cycle; the retained sample has only three dates and lacks approved strict Universe and execution evidence

## Known limitations and risks

### Data correctness

- All committed end-to-end price/return fixtures are synthetic.
- No production market-data, distribution, Corporate Action, FX, historical-Universe, quote, or calendar artifact has passed the proposed gate.
- No evaluated provider proves an official complete Total Return series; adjusted-close fields must not be relabeled.
- Source publication schedules must not be treated as row-level `availableAt`.
- Self-captured raw snapshots may preserve observed revisions, but whether that is sufficient for production PIT and permitted retention remains an O-001/O-014 decision.
- Legal delisting date, last trading date, trust termination, and settlement date must remain separate.

### Policy and licensing

- `o001-production-readiness-proposed-v1` is proposed engineering policy, not an approved investment decision.
- Personal-plan pricing and generic exchange coverage do not prove target-instrument entitlement.
- Private-use, storage, derived-result, cancellation, and audit-replay rights require plan-specific confirmation.
- O-003/O-004 remain open; sample instruments are coverage probes, not final Universe selection.

### Operations

- Strategy C and its decision-package schema are not implemented.
- The M1 software spine and bounded immutable partial audit are merged after Gate G1/G2 approval. M1's executable evidence path is complete, but the provider comparison and O-001 production gate remain blocked.
- The M2 local ledger and manual CLI exist on the active branch. A later `asOf` for a portfolio that held assets across an interval blocks until retained distribution and Corporate Action coverage is connected; the runner does not infer that no event occurred and does not value unadjusted units through a split.
- Formal Forward-test scheduling, notifications, and dashboard are not implemented.
- No brokerage connection or real-order path exists or is authorized.

## Next implementation sequence

The controlling delivery order is `docs/handoff/EXECUTION_ROADMAP.md`.

1. M2 NOW: review and merge the manual Pre-Forward software vertical slice; do not describe the synthetic cycle as real-data completion.
2. M2 EVIDENCE GATE: with separately scoped authorization, capture enough licensed J-Quants history and bind strict Point-in-Time Universe plus versioned execution assumptions for one real virtual-money cycle.
3. M2 FOLLOW-ON: connect retained distribution and Corporate Action events before advancing a held virtual portfolio to a later cutoff.
4. M3 LATER: add approved scheduling, recovery, notifications, and minimal reporting.
5. M4 GATE: freeze provider, Universe, Strategy A/B, Strategy C, persistence, and success-threshold decisions before formal Forward Test.
6. Do not implement real orders, brokerage integration, or O-016 operations.
