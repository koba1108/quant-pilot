# Manual Pre-Forward dry run

`pre-forward` is the M2 manual operating path from retained observations to a virtual portfolio state. It is deliberately separate from the historical backtest runner.

Every output is labeled `pre_forward_dry_run`, `research_only`, and `formalForwardClockStarted=false`. It never places a real order, contacts a brokerage account, or starts the D-002 twelve-month Forward Test clock.

## Runnable fixture path

The committed fixture config generates deterministic, content-addressed daily-bar artifacts from the existing synthetic CSV and then runs Trend and Rotation against separate JPY 1,000,000 virtual portfolios.

```bash
bun run pre-forward:seed-fixture --config=tests/fixtures/pre-forward/config.json
bun run pre-forward \
  --config=tests/fixtures/pre-forward/config.json \
  --as-of=2025-01-07T00:00:00Z
```

The first command writes only to the ignored `data/generated/` runtime boundary. The second command writes immutable Decision Package artifacts, appends one state transition per strategy to a local SQLite ledger, and records owner-only durable portfolio enrollment evidence under the separately ignored `.quant-pilot/` boundary.

Repository-scoped config inputs, runtime bindings, and `.quant-pilot/` enrollment evidence are anchored to the physical config file's nearest Git root, with the config directory used only for a standalone non-Git fixture. The process invocation directory is used only to locate a relative `--config` argument; changing directories while using the same config cannot select a new enrollment tree or reset a portfolio.

Run the same command again to exercise idempotency. It must return the same Decision Package IDs with `idempotent=true` and `stateTransitionApplied=false`; it must not add an order, ledger transition, or cash movement. An equivalent ISO offset representation of the same instant is canonicalized and follows this same idempotent path. A genuinely different cutoff inside the same Asia-Tokyo market calendar month is rejected because M2 implements only the normal monthly D-009 path; no emergency/intramonth mode is inferred.

An individual Decision Package can be replayed without provider access:

```bash
bun run pre-forward \
  --config=tests/fixtures/pre-forward/config.json \
  --as-of=2025-01-07T00:00:00Z \
  --replay-decision=sha256:<decision-package-id>
```

Replay validates the content-addressed artifact, loads the exact retained pre-forward configuration, nested credentialed-sample configuration when applicable, strategy, inputs, and Universe snapshot, rebuilds the decision from its recorded opening state, compares the canonical payload, and verifies the ledger named by that retained configuration. It reads the requested Decision Package and retained portfolio set before resolving runtime bindings, so replacing every portfolio ID in the current config for a new experiment neither hides the historical binding nor enrolls the new IDs during replay. For credentialed input, replay also reconstructs the M1 audit from the complete raw-response, normalized daily-bar, observation, and audit lineage retained in the pinned Pre-Forward store; it does not reopen the original M1 artifact path. A Decision Package becomes retained execution history only when that ledger commits the exact artifact ID for its run key. Ordinary indexing starts from every committed run in the bound ledger and requires its exact Decision Package and retained dependencies to exist in the pinned artifact store before the portfolio may advance. A package written before an interrupted or losing concurrent ledger append remains immutable evidence, but ordinary indexing ignores it and explicit replay rejects it; it cannot block or replace the committed run. Once a Decision Package exists, its retained ledger is opened read-only and without SQLite create permission for indexing or replay. A missing ledger or committed package therefore blocks ordinary execution, future cycles, and explicit replay without creating an empty replacement or resetting to initial cash. Before any first Decision Package, the configured artifact store is prepared and privacy-validated, then the ledger is initialized and its schema/append-only guards are validated. Each owner-only `pre-forward-runtime-binding-v3` directory is completed off-path and atomically renamed into place; the complete portfolio set is then validated before one `pre-forward-runtime-enrollment-set-v1` manifest is published last through an atomic no-clobber link. Every retained enrollment manifest is validated and scanned before initialization, so a requested portfolio already present in another set cannot be re-enrolled by changing only its partner IDs. Publishers repeat that scan while holding an owner-only SQLite coordination transaction, which serializes overlapping initializers and releases automatically after interruption. The manifest pins every member's strategy identity, physical artifact root, and ledger path as one unit. A malformed first-run artifact root or ledger leaves no portfolio enrollment, while interruption before manifest publication can complete the exact matching binding set on retry only when the ledger has no committed run. Existing complete v3 bindings may bootstrap their identical set manifest only after their stored identity, paths, and existing ledger validate. Once the manifest exists, a missing binding, missing record inside a surviving directory, incomplete set, overlapping set, or conflicting evidence requires explicit audited recovery rather than being treated as a new portfolio. Because the manifest lives outside `data/generated/`, ordinary generated-data cleanup cannot silently reset the same portfolio to initial cash. A later current-config strategy reassignment, partial portfolio-set replacement, or artifact/ledger-path change therefore cannot splice longitudinal experiments, hide history, redirect historical replay, cause ordinary execution to miss the retained monthly run, or reset a future cycle to initial cash; reassignment, relocation, or recovery requires an explicit audited process. Explicit historical replay verifies the retained Decision Package strategy against the binding instead of trusting a later current-config assignment, and never applies another transition.

## Runtime contract

The strict `pre-forward-config-v2` contract requires:

- an explicit `asOf` timestamp and version-valid Trend/Rotation configurations;
- JPY 1,000,000 initial virtual cash and the approved -30% high-water-mark stop;
- at most three holdings per strategy;
- an explicit Point-in-Time Universe policy and JPY-only capability for M2;
- per-instrument trading units and explicit commission, slippage, and spread assumptions;
- a versioned positive D-009 safety margin and Point-in-Time expected-benefit evidence before an ordinary trade;
- explicit complete Corporate Action/distribution coverage before valuing units held across cutoffs;
- either deterministic synthetic artifacts or a retained `credentialed_sample_unverified` audit;
- ignored runtime paths for artifacts and the ledger.

Signal ranks use provider-adjusted values only as `provider_adjusted_not_total_return`. Every cutoff is normalized to a canonical UTC instant for identity checks and to its `Asia/Tokyo` market date before strategy validity, `asOfDate`, and monthly cycle assignment; an ISO offset cannot change idempotency or create a second normal run in the same Tokyo market month. Rows before the Point-in-Time Universe listing date are excluded before history checks, and a same-day daily close is not available before the conservative M2 floor `07:00:00Z` (16:00 JST), even if artifact metadata says midnight. Virtual executions use the latest eligible and available unadjusted close as an explicitly named proxy, apply modeled one-way costs, round to trading units, and never permit negative cash. For a portfolio held across cutoffs, the hard-stop High-Water Mark is reconstructed from each newly available unadjusted daily close in the covered interval before the cutoff. Every held asset must have an exact close on every evaluated trading date; a missing row blocks valuation and liquidation instead of carrying a prior price forward. This is a daily-close control, not an intraday-high claim. Config validation rejects any per-instrument aggregate commission, slippage, and applicable half-spread rate at or above 100%. Each initial cash-to-asset order must have gross expected benefit strictly above its one-way execution cost plus the configured positive safety margin. Ordinary held-asset replacement remains blocked pending O-006; mandatory D-010 liquidation bypasses the benefit gate and records the risk override, but never the Point-in-Time Universe gate. If a holding is past its inclusive `lastEligibleDate` or otherwise lacks current eligibility evidence, valuation and liquidation remain blocked rather than using a stale final close to fabricate an executable sale. These labels are evidence boundaries, not claims about investable returns or executable market prices.

The Decision Package records validated-configuration and loaded-input integrity fingerprints, the exact content-addressed pre-forward/credentialed-sample configuration and Universe snapshots used for the decision, Point-in-Time Universe decisions, per-instrument blockers, ranking and weights, expected-benefit/cost decisions, holding-period event coverage, virtual orders/executions, costs, before/after state, high-water mark, distribution-accounting status, and the expected ledger head. The build boundary rejects a stale configuration fingerprint, a strategy not exactly present in that validated configuration, loaded input mutated after artifact validation, a credentialed input not bound to its retained sample config, or a Universe master not paired with its retained snapshot artifact. Replay reads the retained config and Universe artifacts instead of the current mutable files, so later legitimate policy, strategy, sample-definition, or metadata revisions cannot rewrite or invalidate the historical decision. Its market cutoff (`asOf`) is distinct from the actual package creation timestamp (`createdAt`); artifact availability/retrieval provenance uses the latter and replay preserves it. A daily-bars artifact whose observation or availability timestamp, compared as an absolute instant, predates a contained bar is rejected even when a UTC offset makes the local calendar date look equal. The AI committee is explicitly `not_invoked_for_m2_deterministic_strategy_ab`; no AI evidence or override is fabricated.

The SQLite ledger is append-only at the database level: update/delete triggers reject mutations, each transition is hash-chained, and the run key permits exactly one normal Decision Package per portfolio/Asia-Tokyo market calendar month. Every new cutoff must be later than the latest committed run for that portfolio, including a blocked run that intentionally created no state transition; the runner checks this before building another Decision Package and the ledger repeats the check inside its append transaction. Historical verification checks the schema and exact append-only trigger definitions through a read-only, non-creating connection; appends reopen the already bound ledger without create permission. On POSIX systems, the runtime and binding directories are restricted to `0700`, while databases, artifacts, and binding records use `0600`.

The committed fixture supplies `synthetic_fixture_assumption` expected-benefit records of 1,000 bps and a 25 bps safety margin solely to exercise D-009. Its `pre-forward-daily-bars-v3` artifacts are retained at the fixture cutoff and explicitly declare complete synthetic no-event coverage through that cutoff, allowing the hard-stop path to be tested without pretending that provider data contains Corporate Action evidence. Coverage ending only at the latest price date is insufficient whenever the decision cutoff is later. These values and coverage are synthetic test inputs, not approved O-005/O-006 production parameters, real-data evidence, or a forecast.

## Credentialed retained-artifact path

For an existing M1 live audit, use an ignored local config whose input is:

```json
{
  "kind": "credentialed_sample_audit",
  "auditArtifactId": "sha256:<retained-audit-id>",
  "sampleConfigPath": "data/generated/<ignored-live-sample-config>.json",
  "providerId": "jquants_v2"
}
```

On the first decision, the runner validates the complete M1 audit in the artifact root named by the credentialed-sample config. It then copies every content-addressed raw-response, normalized daily-bar, and observation child into the pinned private Pre-Forward artifact store before publishing the audit artifact there; the audit is written last so it cannot mark a partially retained lineage as complete. The exact validated credentialed-sample config is retained as a content-addressed `configuration` artifact in that same pinned store. Later duplicate detection and explicit replay use only this retained config and complete pinned lineage, so the original `sampleConfigPath` and M1 artifact directory may be unavailable without causing a network request, credential read, or historical-replay failure.

The retained 2026-04-20..22 J-Quants sample has only three bars per instrument and has no approved strict Universe, execution-assumption, or expected-benefit artifact. A manual M2 run therefore exits nonzero, preserves JPY 1,000,000 cash, applies no ledger transition, and reports each missing capability. This is the expected fail-closed result, not an M2 real-data completion.

## Current limitations

- The committed successful cycle is synthetic and validates operating behavior only.
- No production provider or O-001 source bundle is selected.
- Provider-adjusted close is not Total Return, and source-native row availability/revision semantics remain unverified.
- Distribution receivables already present in a state settle on pay date, but no retained real distribution/Corporate Action input is connected yet. A later real-data cycle that held assets across an interval blocks before valuation or safety liquidation rather than assuming no event or treating a split-adjusted price change as drawdown.
- High-Water Mark monitoring currently uses retained daily closes; intraday highs and intraday emergency liquidation are outside M2.
- A stopped portfolio cannot use the safety path to append a state whose `lastAsOf` moves backward.
- Execution uses a versioned close-price/cost proxy; target-ETF bid/ask history and approved O-006 execution assumptions remain open.
- Credentialed input has no accepted expected-benefit artifact contract yet, so it cannot borrow the fixture's synthetic assumptions.
- Intramonth/emergency runs are not implemented; they require the defined trigger and audit evidence left open in O-009.
- Strategy C, unattended scheduling, notifications, dashboard work, brokerage integration, and real orders are outside M2.

M2 is complete only after a sufficiently long, licensed retained real-data slice plus approved Point-in-Time Universe and execution evidence produces one end-to-end virtual-money cycle, and replay/idempotency checks pass. The current software vertical slice makes that gate executable without weakening it.
