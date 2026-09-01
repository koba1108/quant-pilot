# Credentialed Sample Capture and Replay

Status: M1 partial live audit completed locally after G1/G2 authorization; production use remains blocked.

## Outcome

The `credentialed-sample-v1` config and `credentialed-sample-report-v2` output connect the current provider research to one executable path:

```text
strict config
  -> J-Quants/EODHD capture adapter
  -> exact response bytes + redacted request metadata
  -> immutable content-addressed artifacts
  -> normalized daily-bar artifacts
  -> field-specific observations
  -> field-specific reconciliation, including explicit source failures
  -> fail-closed research audit
  -> offline replay
```

The runner does not choose O-001, classify provider-adjusted prices as Total Return, or enable `etf_realistic`.

## Fixture execution

The committed fixture covers the same five synthetic JPX mappings through both provider contracts:

- `JPX:1308`
- `JPX:1348`
- `JPX:1473`
- `JPX:1597`
- `JPX:2510`

Run the full path without credentials:

```bash
bun run credentialed-sample --config=research/provider-samples/fixture.config.json
```

The command writes immutable artifacts below the ignored `data/generated/` runtime root and prints a `provider_capability_evidence` artifact. Normal execution exits zero when the audit was generated successfully. Its payload still says:

- `evidenceTier=fixture_contract`
- `disposition=research_only`
- `productionSelection=not_selected`
- `failClosed=true`
- `canEnableEtfRealistic=false`

EODHD has no trading-value field in this daily-price contract. The fixture therefore produces explicit `insufficient_sources` findings for trading value instead of filling it or selecting J-Quants as the winner.

## Offline replay

Use the audit artifact identifier printed by capture:

```bash
bun run credentialed-sample \
  --config=research/provider-samples/fixture.config.json \
  --replay-artifact=sha256:<64-hex-digits>
```

Replay does not construct a provider or call `fetch`. It revalidates raw-body hashes, provenance, raw-to-normalized lineage, every stored observation, the reconciliation policy/report, and the final audit artifact. The fixture capture and replay outputs are byte-for-byte identical.

## Artifact contract

Raw response artifacts retain:

- exact response bytes encoded as canonical base64;
- a SHA-256 hash of those bytes;
- HTTP status and an allowlist of non-secret response headers;
- provider request origin, path, and non-secret query parameters;
- credential environment-variable name and transport, but never its value;
- retrieval timestamp and an explicit `retrieval_time_only_not_source_native` availability label;
- provider/source, adapter version, request hash, content hash, and artifact lineage.

The filesystem store uses the artifact ID as the filename, validates every read/write, performs an atomic no-clobber insertion, treats an identical repeated write as idempotent, and rejects damaged or conflicting content. On POSIX systems the store requires an owner-only `0700` root and `0600` artifact files; it rejects an existing group- or world-accessible store instead of trusting the process umask.

J-Quants sends the key only in the `x-api-key` header. EODHD's documented API uses `api_token` in the query, so the live request contains it temporarily, but retained request metadata omits that query field entirely. Redirects are rejected. If a sufficiently long live credential is echoed in a response or retained header, capture refuses to store it.

## Live gates

There is deliberately no committed live config. A live config must:

- use `mode=live` and contain 5–10 instrument mappings;
- use only the provider-bound credential names `JQUANTS_API_KEY` and `EODHD_API_TOKEN`; an arbitrary environment variable cannot be selected by config;
- set the recorded credential, cost, raw-retention, and license-retention confirmations to true;
- omit all fixture paths;
- write to an ignored repository runtime root or an explicit external directory.

Live execution additionally requires all four runtime flags:

```bash
bun run credentialed-sample --config=<approved-live-config> \
  --authorize-credential-use \
  --authorize-cost \
  --authorize-raw-retention \
  --confirm-license-retention
```

All gates and required environment variables are checked before directory creation or network access. These flags are safety interlocks, not proof that a plan entitlement, price, or license term is acceptable. The user must approve those facts first.

For the M2 evidence gate, a live config may explicitly set `purpose=pre_forward_primary`. That purpose permits exactly one `jquants_v2` provider and does not contact EODHD. Omitting `purpose` preserves the original M1 contract, which still requires exactly J-Quants plus EODHD and cannot be weakened into a single-source comparison. A provider may also declare an explicit `requestIntervalMs`; the live transport spaces every request, including pagination, by that interval. The value is retained in the sample-definition fingerprint and is used only for provider rate-limit compliance, not as evidence of data quality.

Additional exit gates are available for automation:

- `--require-live-evidence` returns nonzero for fixture output.
- `--require-production` returns nonzero for every output because the runner cannot approve production use.
- A live audit with `captureStatus=partial` returns nonzero even when its retained audit artifact is valid. This prevents a provider failure from looking like successful comparison coverage.

## Bounded live result

With the four approved gates, the same five mappings were captured for `2026-04-20..22`. The owner-only, Git-ignored local audit retained:

- 10 raw HTTP artifacts: five J-Quants successes and five EODHD HTTP 404 responses;
- five J-Quants daily-bar artifacts containing 15 bars in total;
- 60 field observations for close, provider-adjusted close, volume, and trading value;
- five canonical `providerFailures` entries for `1308.TSE`, `1348.TSE`, `1473.TSE`, `1597.TSE`, and `2510.TSE`;
- one `captureStatus=partial` audit with `research_only`, `productionSelection=not_selected`, `failClosed=true`, and `canEnableEtfRealistic=false`.

Offline replay reproduced the retained audit canonically without provider access. The artifact directory was `0700`, all 76 artifact files were `0600`, and a local credential-byte scan found no key in retained JSON or decoded raw bodies. The live config, raw bodies, and normalized vendor data remain outside Git.

## M2 primary-history checkpoint

After separate authorization for the same five instruments and a maximum 18-month read-only request, `purpose=pre_forward_primary` captured only J-Quants. The account rejected an end date after `2026-06-09` and reported a permitted subscription window of `2024-06-09..2026-06-09`; the runner retained that HTTP 400 response as evidence rather than silently shortening the request. Re-running with the permitted `2025-03-01..2026-06-09` range and an explicit 13-second request interval produced a complete primary audit:

- five J-Quants daily-bar artifacts, one per approved sample code;
- 310 bars per instrument and 1,550 bars total, covering actual trading dates `2025-03-03..2026-06-09`;
- no provider failure and no EODHD request;
- audit artifact `sha256:295c62cda5f1b7b6679894e27545e7ff8541301f02dcfb5aa6d1adb1a8141717` in the owner-only Git-ignored local store;
- canonical offline replay, `0700` root / `0600` files, and no credential bytes in retained JSON or decoded response bodies.

This closes the history-length sub-check only. At the `2026-09-01` checkpoint the latest bar is 84 calendar days old, while the M2 operating config permits at most three days. The data therefore remains too stale for a current Pre-Forward decision. The runner must not backdate retrieval-time availability or relax the freshness gate to make the cycle pass. A fresher entitlement or another separately approved current-data source is required before strict Universe, execution, and expected-benefit evidence can complete the first real cycle.

Local replay checkpoint (not committed as data): audit `sha256:084d2ac0fdd9a57b6d792506a05b9441e01879a70d6ed9c17af044e6a036db1e` under `data/generated/provider-samples/live-v1-artifacts`, using the ignored `data/generated/provider-samples/live-v1.config.json`.

## Current explicit gaps

The fixture validates software behavior only. The separate live audit is bounded and remains research-only: J-Quants daily bars succeeded for all five codes, while all five tested EODHD `.TSE` symbols returned HTTP 404. The reconciliation therefore reports each J-Quants field observation as `insufficient_sources`; it does not compare two successful vendor values. Do not interpret the EODHD result as a permanent global provider limitation.

The current audit therefore keeps these capabilities missing:

- source-native row availability and revision history;
- exchange calendar/session exceptions;
- Point-in-Time listing state and last trading date;
- EODHD current-account JPX coverage and a usable Japanese ETF daily-price comparator;
- ETF distributions and Corporate Actions;
- historical JPX bid/ask and depth;
- approved production license and retention rights.

The partial immutable audit now satisfies the M1 executable evidence path, but it does not satisfy O-001 or the production data gate. After this branch is merged, M2 may consume the retained J-Quants observations only as `credentialed_sample_unverified` input and must preserve the missing comparator, Total Return, Point-in-Time revision, lifecycle, event, calendar, and quote-quality blocks. A larger or paid live request needs a separately scoped approval.
