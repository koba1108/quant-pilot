# Data Quality, Provenance, and Reconciliation

## Contracts

The data foundation is split into three deterministic contracts:

- `src/data/provenance.ts` — canonical JSON, SHA-256 content/request fingerprints, versioned artifact metadata, and transform lineage types.
- `src/data/data-quality.ts` — stable `pass`, `research_only`, or `blocked` reports with attributable issues.
- `src/data/reconciliation.ts` — provider-neutral comparison of semantically identical observations without selecting a source winner.

No contract names or approves the final provider. O-001 remains open.

## Quality CLI

```bash
bun run data-quality --config=tests/fixtures/configs/data-quality.json
```

The fixture output is `research_only`, not `pass`, because it uses synthetic unadjusted Price data and only one source. The report explicitly says cross-source reconciliation was not performed. Its audit scope is `dataset_at_backtest_end_not_per_signal_frame`.

Disposition semantics:

- `pass`: every check required by that versioned policy passed.
- `research_only`: non-blocking limitations remain, such as unadjusted Price data, optional liquidity fields, or advisory/single-source evidence.
- `blocked`: a required input is missing, invalid, unavailable by the decision date, or materially inconsistent.

Missing volume, trading value, provenance, and reconciliation status remain missing. They are not replaced with zero, a prior observation, or an LLM estimate. The requested interval itself must also end no later than the decision date, even when the supplied rows happen not to contain a future bar.

When a policy requires quote-quality evidence, its versioned payload must name an explicit coverage interval spanning the requested range, contain at least one in-range observation, and be available by the decision date. An old non-empty quote sample cannot satisfy a later range silently.

## Provenance and fingerprints

A versioned artifact records source/dataset labels, source and adapter versions, observation/availability/retrieval times, content hash, sanitized request hash, and optional record/supersession identifiers. Hashes and supersession IDs use a strict `sha256:` form, artifact `sourceVersion` is mandatory, and `artifactKind` is checked against the runtime contract allowlist. Artifact validation recomputes both payload content and canonical metadata identity; stale provenance cannot be reused with mutated bars. Daily-bar reports also retain a canonical bar-content hash when provenance is optional.

The current backtest config can declare artifact-level metadata for a committed fixture. The implementation binds those labels to the loaded bytes and request, but the config declaration is not independent proof that the named provider supplied them. Production provenance must be emitted by a trusted adapter.

One dataset-level `availableAt` also does **not** prove that every historical bar or correction was available at every historical rebalance. The quality command is a sidecar dataset audit, not the production backtest gate. Production Point-in-Time feeds still need row-level observations/revisions and per-signal-date evaluation. Until that integration exists, every ordinary backtest summary is explicitly `evidenceDisposition=research_only`, and `researchLayer=etf_realistic` is rejected.

The daily-bar quality contract accepts only `unadjusted_price` and `provider_adjusted`. It cannot label plain bars `price_return` or `total_return`; those bases require the separate normalized-return artifact and event-coverage contracts. The consumer boundary revalidates this basis and the mandatory limitation warning, so a self-rehashed report cannot relabel raw bars as a passing normalized series.

## Cross-source reconciliation

`reconcileComparableObservations` groups values only when code, date, field, basis, currency/unit, quote convention, and event key agree. For example, raw `Close` is not compared with `AdjustedClose`, and an FX quote is not inverted or triangulated implicitly. Price, distribution, split-ratio, and FX values must be positive; volume, trading value, spread, and depth values must be non-negative. Invalid values fail before they can become a `matched` group.

All numeric tolerances come from a versioned reconciliation policy. Results retain every source value and difference:

- within tolerance: `matched`;
- above warning tolerance: `warning`;
- above blocking tolerance: `blocked`;
- missing counterpart: advisory or blocked according to the explicit policy;
- duplicate values from one source for the same semantic key: blocked.

Comparable scalar values, field-specific semantic dimensions, parent-artifact provenance, and row-level availability are bound to a versioned `reconciliation_observation` evidence payload and retained in the report. A derived comparison observation cannot claim availability before its parent artifact, and each field requires the corresponding parent artifact kind. Observations whose semantic date or availability is after the decision cutoff are excluded and counted. At the consumer boundary, lineage, group differences, statuses, issues, evidence artifacts, and policy identity are recomputed instead of trusting a rehashed label.

A `required` comparison with no usable observations, no blocking tolerance, wrong policy version/fingerprint, or no successfully compared price group for the requested code/date scope is blocked. The successful group must use the exact field and return basis expected by the daily-bar input, and that same group—not merely another group in the report—must contain the input artifact's parent ID. A quality report also requires matching fingerprint and decision date before use.

The hook never computes a silent consensus, median replacement, forward fill, or source winner.

## Current limits

- The CLI audits daily-bar inputs. Corporate Actions, distributions, and FX retain their separate strict normalization contracts.
- The quality CLI is not yet invoked as a per-frame gate by the backtest runner.
- No second production provider is connected, so the ordinary fixture report cannot establish cross-source agreement.
- The research quality policy's 253-bar requirement is the current signal-history requirement, not an approved O-003 product-eligibility threshold.
- Data licensing, retention, official correction history, exchange calendars, and provider SLA remain unresolved.
