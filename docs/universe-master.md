# Point-in-Time Universe Master

## Purpose

`src/data/universe-master.ts` defines the versioned, fail-closed metadata contract used to decide whether an instrument could enter a signal frame at a historical decision date.

The repository root `universe_master.csv` is the original candidate catalog. It has names, groups, roles, and notes, but no machine-readable listing lifecycle, availability timestamp, provider symbol, or provenance. It is therefore **not** treated as a historical source of truth and intentionally fails the strict loader. Dates embedded in `notes` are never inferred.

## Versioned schema

The executable format is `universe-master-v1`. A commit-safe synthetic example is in `tests/fixtures/universe/universe-master-v1.csv`.

Important fields:

- `observation_id`: stable identifier for one Point-in-Time metadata observation.
- `supersedes_observation_id`: explicit predecessor for a correction. Branches, cycles, disconnected chains, and unknown predecessors are rejected.
- `instrument_id`: stable instrument identity. `code` and `symbol` may not silently change inside one revision chain.
- `listing_date`: first eligible date, inclusive.
- `last_eligible_date`: final eligible/trading date, inclusive. It is deliberately not inferred from a legal delisting date.
- `observed_at`, `available_at`, `retrieved_at`: valid-time and knowledge-time boundaries. The loader requires `observed_at <= available_at <= retrieved_at`.
- `status`: preserved metadata only. A research config must explicitly list enabled statuses through `universeStatuses`; the loader does not decide O-004.
- `instrument_type`: must be `etf` for eligibility under D-003. Other products fail closed.
- `is_us_equity`, `is_crypto_asset`, `is_leveraged`, `is_inverse`: required booleans for D-003's prohibited product classes. Free-text names/groups/notes are never parsed to infer these flags; any true flag is ineligible.
- `currency`: retained explicitly and evaluated against an explicit supported-currency set. The current ordinary runner passes only JPY because its normalized non-JPY return path is not yet integrated; it never treats a foreign-currency series as JPY.
- `source`, `dataset`, `source_version`, `record_id`: source provenance. Their presence does not approve a provider under O-001.

At each asset's own monthly trading-date endpoint, the runner selects only the latest revision whose `available_at` is within that date's UTC end-of-day cutoff, then applies instrument type, prohibited-product flags, listing, final-eligible-date, explicit currency capability, and explicitly enabled-status constraints. The exported resolver also requires both allowed statuses and supported currencies; it is not a currency-agnostic final gate. A later correction cannot rewrite an earlier signal snapshot.

## Backtest integration

When `universeMasterPath` is set, each configured asset contains its `code` and optional market-data provenance only. `symbol`, listing date, and final eligible date must come from the strict master; conflicting config overrides are rejected.

```json
{
  "universeMasterPath": "tests/fixtures/universe/universe-master-v1.csv",
  "universeStatuses": ["test_candidate"],
  "assets": [
    { "code": "ALPHA" }
  ]
}
```

The regular config-only asset path remains available for backward compatibility only when it is explicitly labeled `researchLayer=synthetic_fixture` or `researchLayer=proxy`. It is not a maintained historical Universe and cannot be used as ETF-realistic evidence because it has no machine-verifiable instrument type, prohibited-product flags, or JPY conversion contract.

The runner checks lifecycle, status, product class, and currency capability again at each forward-return endpoint. A post-`last_eligible_date` bar or a return endpoint reached after status becomes ineligible is never used; inability to construct a valid realized return stops frame construction before ranking. Months with valid history but no signal-eligible asset remain explicit 100% cash frames. Output retains the master fingerprint and date/phase/observation/source/version/product-class audit trail for every applied decision.

## Boundaries

- The root candidate catalog has not been populated with production lifecycle history or provider provenance.
- Final Universe membership, duplicate-exposure choices, and eligibility thresholds remain O-003/O-004.
- `last_eligible_date` must come from an explicit source field or adapter. The loader never subtracts a day from a provider's delisting date.
- Symbol changes inside one instrument revision chain are rejected in v1 rather than guessed.
- UTC end-of-day is the current metadata cutoff. Exchange-specific intraday availability remains a later provider/calendar concern.
- Delisted-position liquidation/settlement behavior is not implemented; these fixtures prove selection boundaries, not a complete ETF-realistic delisting simulation.
