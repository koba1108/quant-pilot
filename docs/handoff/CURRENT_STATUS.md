# Current Status

Snapshot date: 2026-08-29

## Repository state

- Repository: `koba1108/quant-pilot`
- Local checkout: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Latest merged PR: #9 (`feat: evaluate production market data readiness`)
- Latest merged commit: `9690bbe7e40c64a3fc2591b5da785f01bc0bbbc4`
- Active documentation branch: `ykoba/document-forward-test-roadmap`
- Active PR: none
- Active delivery milestone: M1 — Credentialed data slice
- Delivery roadmap: `docs/handoff/EXECUTION_ROADMAP.md`
- Formal Forward-Test clock: not started

## Implemented on main through PR #9

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
- `bun test`: 131 pass / 0 fail
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

Both bundles currently report `blocked`, `selection=not_selected`, `failClosed=true`, and `canEnableEtfRealistic=false`. J-Quants＋EODHD is the recommended next private-research sample configuration, not an adopted provider.

The machine snapshot contains no downloaded market data, credentials, private vendor responses, or contract documents. Official URLs, checked dates, and explicit unversioned-page labels are discovery evidence, not immutable sample artifacts. Accordingly, all three machine-readable overall license assessments remain `unknown`; the human report separately records restrictions visible in the public terms.

### J-Quants adapter spike

- `src/data/jquants-v2.ts` calls the official v2 daily-bars endpoint with `x-api-key` header authentication and pagination.
- It restricts credentialed requests to the official HTTPS host and validates four/five-character security codes, provider/internal-code mapping, semantic request bounds/dates, raw/adjusted prices, adjustment factor, volume, trading value, malformed JSON, HTTP failures, pagination loops, and duplicate dates.
- Official no-trade rows with null prices are explicitly excluded; inconsistent partial nulls are rejected. Missing optional volume/trading value remains `undefined`; no missing value is replaced with zero or a prior value.
- Runner use is restricted to `provider=jquants_v2`, `returnBasis=unadjusted_price`, and `researchLayer=proxy`.
- The adapter does not treat `AdjC` as normalized Price Return or Total Return and does not invent availability, revisions, distributions, FX, Universe, or calendar evidence.
- Tests use mocked API responses only. No real `JQUANTS_API_KEY` execution has been performed.

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

## O-001 findings preserved as open

### Individual-access candidates

- J-Quants is the strongest TSE primary-data candidate and has transparent individual pricing, but adjusted prices are not proven Total Return, JPY FX is absent, ETF distribution completeness is unverified, corrections overwrite older values, and private-use retention/redistribution rules are restrictive.
- EODHD is the strongest low-cost overseas/FX complement, but Japanese ETF event completeness, Tokyo quote history, source-native PIT/revisions, plan entitlement, and durable retention remain unverified.
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
- NOT RUN — real credentialed J-Quants API request
- NOT RUN — real J-Quants/EODHD or J-Quants/Twelve Data reconciliation

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
- Forward-test persistence, scheduling, notifications, and dashboard are not implemented.
- No brokerage connection or real-order path exists or is authorized.

## Next implementation sequence

The controlling delivery order is `docs/handoff/EXECUTION_ROADMAP.md`.

1. M1 NOW: build the credentialed-sample capture/audit path without secrets, then request explicit credential/cost and retention authorization for a real 5–10 ETF sample.
2. M2 NEXT: connect retained real observations to a manual, replayable, idempotent Pre-Forward virtual-portfolio cycle.
3. M3 LATER: add approved scheduling, recovery, notifications, and minimal reporting.
4. M4 GATE: freeze provider, Universe, Strategy A/B, Strategy C, persistence, and success-threshold decisions before formal Forward Test.
5. Do not implement real orders, brokerage integration, or O-016 operations.
