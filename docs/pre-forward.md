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

The first command writes only to the ignored `data/generated/` runtime boundary. The second command writes immutable Decision Package artifacts and appends one state transition per strategy to a local SQLite ledger.

Run the same command again to exercise idempotency. It must return the same Decision Package IDs with `idempotent=true` and `stateTransitionApplied=false`; it must not add an order, ledger transition, or cash movement. A different cutoff inside the same calendar month is rejected because M2 implements only the normal monthly D-009 path; no emergency/intramonth mode is inferred.

An individual Decision Package can be replayed without provider access:

```bash
bun run pre-forward \
  --config=tests/fixtures/pre-forward/config.json \
  --as-of=2025-01-07T00:00:00Z \
  --replay-decision=sha256:<decision-package-id>
```

Replay validates the content-addressed artifact, rebuilds the decision from its recorded opening state and retained inputs, compares the canonical payload, and verifies its ledger binding. It does not apply another transition.

## Runtime contract

The strict `pre-forward-config-v2` contract requires:

- an explicit `asOf` timestamp and version-valid Trend/Rotation configurations;
- JPY 1,000,000 initial virtual cash and the approved -30% high-water-mark stop;
- at most three holdings per strategy;
- an explicit Point-in-Time Universe policy and JPY-only capability for M2;
- per-instrument trading units and explicit commission, slippage, and spread assumptions;
- a versioned positive D-009 safety margin and Point-in-Time expected-benefit evidence before an ordinary trade;
- either deterministic synthetic artifacts or a retained `credentialed_sample_unverified` audit;
- ignored runtime paths for artifacts and the ledger.

Signal ranks use provider-adjusted values only as `provider_adjusted_not_total_return`. Virtual executions use the latest eligible unadjusted close as an explicitly named proxy, apply modeled one-way costs, round to trading units, and never permit negative cash. Each initial cash-to-asset order must have gross expected benefit strictly above its one-way execution cost plus the configured positive safety margin. Ordinary held-asset replacement remains blocked pending O-006; mandatory D-010 liquidation bypasses the benefit gate and records the risk override. These labels are evidence boundaries, not claims about investable returns or executable market prices.

The Decision Package records input and configuration fingerprints, Point-in-Time Universe decisions, per-instrument blockers, ranking and weights, expected-benefit/cost decisions, virtual orders/executions, costs, before/after state, high-water mark, distribution-accounting status, and the expected ledger head. Its market cutoff (`asOf`) is distinct from the actual package creation timestamp (`createdAt`); artifact availability/retrieval provenance uses the latter and replay preserves it. The AI committee is explicitly `not_invoked_for_m2_deterministic_strategy_ab`; no AI evidence or override is fabricated.

The SQLite ledger is append-only at the database level: update/delete triggers reject mutations, each transition is hash-chained, and the run key permits exactly one normal Decision Package per portfolio/calendar month. On POSIX systems, the runtime directory and database are restricted to `0700` and `0600`.

The committed fixture supplies `synthetic_fixture_assumption` expected-benefit records of 1,000 bps and a 25 bps safety margin solely to exercise D-009. Those values are synthetic test inputs, not approved O-005/O-006 production parameters and not a forecast.

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

The artifact root must contain the same audit and child daily-bar artifacts used by the M1 offline replay. The pre-forward runner does not read provider credentials or make a network request on this path.

The retained 2026-04-20..22 J-Quants sample has only three bars per instrument and has no approved strict Universe, execution-assumption, or expected-benefit artifact. A manual M2 run therefore exits nonzero, preserves JPY 1,000,000 cash, applies no ledger transition, and reports each missing capability. This is the expected fail-closed result, not an M2 real-data completion.

## Current limitations

- The committed successful cycle is synthetic and validates operating behavior only.
- No production provider or O-001 source bundle is selected.
- Provider-adjusted close is not Total Return, and source-native row availability/revision semantics remain unverified.
- Distribution receivables already present in a state settle on pay date, but no retained distribution-event input is connected yet. A later cycle that held assets across an interval blocks rather than assuming no distribution.
- Execution uses a versioned close-price/cost proxy; target-ETF bid/ask history and approved O-006 execution assumptions remain open.
- Credentialed input has no accepted expected-benefit artifact contract yet, so it cannot borrow the fixture's synthetic assumptions.
- Intramonth/emergency runs are not implemented; they require the defined trigger and audit evidence left open in O-009.
- Strategy C, unattended scheduling, notifications, dashboard work, brokerage integration, and real orders are outside M2.

M2 is complete only after a sufficiently long, licensed retained real-data slice plus approved Point-in-Time Universe and execution evidence produces one end-to-end virtual-money cycle, and replay/idempotency checks pass. The current software vertical slice makes that gate executable without weakening it.
