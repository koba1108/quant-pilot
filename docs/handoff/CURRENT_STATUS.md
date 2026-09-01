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
- `--replay-decision=sha256:<id>` rebuilds the canonical Decision Package from the retained exact pre-forward configuration, credentialed-sample configuration when applicable, inputs, opening state, and Universe snapshot, verifies the ledger referenced by that retained configuration rather than the current file, and applies no transition.
- Each immutable `pre-forward-decision-package-v8` records the explicit cutoff and actual creation timestamp, exact retained content-addressed pre-forward/credentialed-sample configuration and Universe snapshots, validated-config and loaded-input integrity fingerprints, data classifications and artifact IDs, strict Universe decisions, lifecycle/availability counts, instrument blockers, Strategy A/B ranking and weights, D-009 expected-benefit/cost decisions, holding-period event coverage, virtual orders/executions, modeled costs, before/after state, high-water mark, distribution-accounting coverage, and ledger head.
- Bun SQLite stores an append-only run index and hash-chained state transitions. Update/delete triggers reject mutation; historical indexing/replay opens retained ledgers read-only without create permission and validates the schema plus exact guard definitions, while append reopen also forbids create. A missing retained ledger blocks rather than creating a replacement or resetting to initial cash. Runtime directories and databases are owner-only on POSIX.
- The run key permits one normal cycle per portfolio/Asia-Tokyo market calendar month. Offset-formatted timestamps are normalized to a canonical UTC instant for retained-run identity and to the Tokyo market date before cycle assignment, so an equivalent representation is idempotent while a genuinely different intramonth cutoff is rejected. `pre-forward-runtime-binding-v3` validates or initializes the configured artifact store and ledger, completes and validates the entire owner-only generated binding set, then atomically publishes one separately ignored `.quant-pilot/` `pre-forward-runtime-enrollment-set-v1` manifest that pins every member's strategy identity plus physical artifact-root and ledger paths. A malformed first-run artifact root or ledger leaves no enrollment. Interruption after only part of the binding set exists can complete the exact configuration on retry only while the ledger has no committed runs; an existing complete v3 set may bootstrap only its identical manifest after its stored ledger validates. Once published, a missing generated binding, a missing record inside a surviving directory, an incomplete set, or conflicting evidence requires explicit audited recovery. Ordinary `data/generated/` cleanup therefore cannot silently treat the same portfolio IDs as new or reset them to initial cash. Ordinary execution starts from every committed ledger run for the configured portfolios, loads its exact Decision Package from the pinned store, and verifies both sides before portfolio advancement. A package left before a losing or interrupted append is immutable but ignored as uncommitted, while a missing committed package blocks. This binding, enrollment, and ledger-driven reconciliation prevent cross-strategy portfolio reassignment, concurrent alternate first-cycle ledgers, simultaneous artifact/ledger relocation, duplicated monthly runs, and resets to initial cash. Strategy reassignment, artifact-root changes, and future-cycle ledger-path changes are rejected until an explicit audited amendment or migration exists. A different cutoff in the same market month is rejected until a defined D-009/O-009 emergency mode and audit contract are approved.
- Every ordinary initial-allocation order requires explicit Point-in-Time gross expected benefit strictly above one-way execution cost plus a positive safety margin. Config validation also requires each instrument's aggregate commission, slippage, and applicable half-spread rate to remain below 100%. The committed values are synthetic fixture assumptions only; ordinary held-asset replacement remains blocked pending O-006, while mandatory D-010 liquidation retains priority.
- The maximum-three-holding constraint and -30% high-water-mark stop are asserted at the config, Decision Package, execution, and integration-test boundaries. Before the cutoff drawdown test, a held portfolio's High-Water Mark is reconstructed across every newly available unadjusted daily close since the prior cutoff; all held assets require an exact same-date close, and a missing row blocks instead of carrying a prior price forward. This is a daily-close, not intraday-high, control. Safety liquidation remains authoritative only after complete Corporate Action/distribution coverage through the current decision cutoff proves the stored unit basis and every held asset remains Point-in-Time Universe eligible at that cutoff. A gap after the latest price or a cutoff after `lastEligibleDate` blocks valuation and liquidation rather than turning a split into a false drawdown or a stale final close into an impossible fill. Synthetic `pre-forward-daily-bars-v3` fixtures explicitly declare complete no-event coverage through the fixture cutoff, while credentialed retained bars do not.
- Safety handling never bypasses portfolio chronology. Daily-bars artifacts are rejected when their observation/availability timestamps, normalized as absolute instants, predate contained market rows; signal history excludes rows before the resolved ETF listing date and same-day closes before the conservative `07:00:00Z` availability floor.
- The Decision Package build boundary revalidates the full config, binds the selected strategy exactly to that config, and rejects any loaded input changed after artifact validation.
- Each decision stores the exact validated pre-forward config, any nested credentialed-sample config, and the exact Universe master as immutable content-addressed artifacts. On the first credentialed decision, the runner validates the original M1 audit and copies its complete raw-response, normalized daily-bar, observation, and audit lineage into the pinned Pre-Forward store, writing the audit last. Ordinary reuse locates a committed historical run before applying the mutable current strategy-validity window; explicit replay reads the requested package and complete retained portfolio set before binding resolution, then loads only pinned artifacts rather than later mutable files or the original M1 path. Regressions change execution/config versions, advance the current validity window past the old cutoff, replace every current portfolio ID before and after new enrollment, change ledger paths, invalidate the original sample-config file, remove its separate source artifact directory, and append a valid future-dated master revision, then still reproduce the original Decision Package exactly.
- The existing three-day J-Quants live audit can be loaded through M1 offline replay without credentials or network access. Both strategies correctly return blocked, keep JPY 1,000,000 in cash, and apply no ledger transition because history, data freshness, strict Universe, execution assumptions, and expected-benefit evidence are incomplete.
- Active-branch verification: direct aggregate `bun test` executes all 25 files and passes 223 tests / 0 fail on both Bun 1.3.14 and Bun 1.2.14 after standardizing registration on `bun:test`; Pre-Forward CLI passes with strict SQLite shutdown; `bunx tsc --noEmit` passes; fixture execute/repeat/replay across later config, equivalent-instant ISO offsets, complete current portfolio-ID replacement before/after new enrollment, ledger-path and nested sample-config changes, original M1 artifact-directory removal, and Universe revisions, complete credentialed-lineage retention, ledger-uncommitted orphan Decision handling, atomic enrollment-set publication with interrupted-initialization recovery, independent enrollment survival across generated-state removal, invalid first-run artifact-root/ledger cleanup, missing-binding/ledger/committed-package blocking, artifact-store relocation rejection, D-009 marginal/aggregate-cost rejection, Tokyo-market-month intramonth rejection, creation-time provenance, held-event-coverage/Universe-eligibility/chronology guards, intervening daily-close High-Water Mark reconstruction, exact-date missing-price blocking, prior-cutoff Asia-Tokyo coverage normalization, absolute-timestamp artifact validation, listing/intraday availability and loaded-input/config integrity validation, and retained live-audit blocking behave as expected; `git diff --check` passes.
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
- PASS — a second cutoff in the same portfolio/Asia-Tokyo market month is rejected even when its ISO offset changes the displayed month, and Decision Package creation provenance is not backdated to historical `asOf`
- PASS — aggregate one-way cost at or above 100% is rejected before a config can reach execution
- PASS — split/distribution coverage is required before held-unit valuation or safety liquidation; missing coverage leaves state unchanged
- PASS — event coverage ending at the latest price but before the decision cutoff remains insufficient and cannot authorize valuation or liquidation
- PASS — a held ETF past its inclusive `lastEligibleDate` cannot be valued or safety-liquidated from a stale final close
- PASS — safety handling cannot move `lastAsOf` backward, and a daily-bars artifact cannot predate one of its rows
- PASS — pre-listing rows cannot satisfy signal history, and a same-day closing row is excluded before its conservative availability floor
- PASS — validated config, selected strategy, and loaded market input cannot diverge silently at the Decision Package boundary
- PASS — a later valid configuration revision cannot alter or break replay of a retained historical decision
- PASS — current artifact/ledger-path revisions cannot hide history, redirect historical replay, duplicate a retained monthly run, or reset a later cycle without an explicit audited migration
- PASS — an immutable Decision Package without an exact retained-ledger commit is ignored by ordinary history indexing and cannot block the committed monthly run
- PASS — if that retained ledger is missing, ordinary execution, future cycles, and explicit replay block without creating an empty replacement
- PASS — a committed ledger run whose exact Decision Package is missing blocks before another portfolio transition
- PASS — artifact and ledger paths are pinned before the first Decision Package; alternate first-cycle ledgers and missing binding records fail closed
- PASS — a credentialed decision remains replayable from its complete pinned raw-to-audit lineage and retained nested sample config after the original sample-config file and separate M1 artifact directory are changed or unavailable
- PASS — a later valid Universe master revision cannot alter or break replay of a retained historical decision
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
