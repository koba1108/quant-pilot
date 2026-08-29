# Credentialed Sample Capture and Replay

Status: M1 fixture contract implemented; real credentialed execution not authorized or performed.

## Outcome

`credentialed-sample-v1` connects the current provider research to one executable path:

```text
strict config
  -> J-Quants/EODHD capture adapter
  -> exact response bytes + redacted request metadata
  -> immutable content-addressed artifacts
  -> normalized daily-bar artifacts
  -> field-specific observations
  -> two-source reconciliation
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

Additional exit gates are available for automation:

- `--require-live-evidence` returns nonzero for fixture output.
- `--require-production` returns nonzero for every v1 output because the runner cannot approve production use.

## Current explicit gaps

The fixture validates software behavior only. No J-Quants or EODHD credential was used, and no vendor response was downloaded. The audit keeps these capabilities missing:

- source-native row availability and revision history;
- exchange calendar/session exceptions;
- Point-in-Time listing state and last trading date;
- ETF distributions and Corporate Actions;
- historical JPX bid/ask and depth;
- approved production license and retention rights.

The next action remains Gate G1/G2: confirm exact subscription cost/entitlement and response-retention rights, then explicitly authorize one 5–10 ETF live sample. Until then M1 is software-ready for the sample but evidence-incomplete, and M2 must not consume fixture output as real market evidence.
