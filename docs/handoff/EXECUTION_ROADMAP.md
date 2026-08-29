# Quant Pilot Execution Roadmap

Last updated: 2026-08-29

Status: Active delivery roadmap

## Purpose

This document fixes the delivery path from the current research engine to a formal Forward Test. It exists to prevent locally useful foundation work from consuming the project without producing a runnable operating loop.

This roadmap approves the **order of work and focus rules**. It does not approve unresolved investment, provider, Universe, model, persistence, or success-threshold choices in `OPEN_DECISIONS.md`.

## Target outcomes

The project uses three distinct operating labels. They must not be conflated.

1. **Backtest**: historical or synthetic evaluation. This is runnable now, but current committed fixtures remain research-only.
2. **Pre-Forward dry run**: real or credentialed provider observations drive a virtual portfolio and an auditable decision package. It tests the operating loop, but does not start the D-002 twelve-month clock.
3. **Formal Forward Test**: three approved, materially distinct strategies each run a virtual JPY 1,000,000 portfolio for at least twelve months under frozen, versioned start conditions.

The next runnable outcome is a **manual Pre-Forward dry run**, not a dashboard and not real-money trading.

## The single delivery path

### M0 — Deterministic research foundation

Status: **complete through merged PR #9**

Delivered:

- deterministic Strategy A/B backtests;
- Point-in-Time Universe and normalized return contracts;
- distribution, Corporate Action, and FX accounting foundations;
- data-quality, provenance, and cross-source reconciliation contracts;
- robustness-grid foundation;
- fail-closed provider evaluation;
- mocked J-Quants v2 daily-price adapter contract.

This milestone proves implementation behavior. It does not prove an investable data source or start a Forward Test.

### M1 — Credentialed data slice

Status: **NOW**

Software checkpoint: the fixture-tested `capture -> immutable artifact -> reconciliation -> offline replay` spine is implemented on `ykoba/pre-forward-credentialed-data-slice`. M1 remains active because no credentialed vendor sample, entitlement/cost evidence, or retention confirmation exists yet.

Goal: turn provider research into a small, reproducible, license-permitted evidence path.

Implementation package:

- add a credentialed-sample runner without committing secrets;
- capture request parameters, retrieval time, raw response hash, provider/adapter version, and artifact lineage;
- ingest the same 5–10 representative JPX ETFs from the candidate primary and comparison source;
- cover daily prices, calendar/listing state, distributions/Corporate Actions where entitled, trading value, and available quote-quality evidence;
- preserve missing fields and disagreements instead of selecting or filling a winner;
- generate field-specific reconciliation and an updated provider-readiness report;
- keep every real-data artifact outside Git and inside the license-permitted retention boundary.

Work that does not require credentials may be implemented and tested first. A real fetch requires explicit user authorization for credentials and cost.

Exit criteria:

- one command reproduces the sample capture and audit flow;
- raw artifacts are immutable and integrity-checked;
- repeated evaluation of the same retained artifacts is deterministic;
- missing availability, revisions, distributions, lifecycle, quote, or license evidence remains explicit;
- the user receives the sample, entitlement, retention, and cost evidence needed for O-001 review.

Gate G1: credential and cost authorization before real access.

Gate G2: license/retention confirmation before persisting provider responses.

### M2 — Manual Pre-Forward vertical slice

Status: **NEXT**

Goal: run one complete virtual operating cycle from retained observations to replayable portfolio state.

Implementation package:

- introduce a dedicated `pre-forward` CLI with an explicit `asOf` cutoff;
- load only retained, validated Point-in-Time artifacts;
- run Strategy A and Strategy B with versioned configuration;
- create virtual orders, executions, positions, cash, distribution receivables, and modeled costs;
- persist an immutable Decision Package and append-only run ledger;
- make reruns idempotent so the same strategy/date/version cannot create duplicate orders;
- support replay from artifacts without contacting the provider;
- fail closed on incomplete data, stale strategy/config versions, or ledger mismatch;
- emit a compact human report and a machine-readable audit report.

Provisional engineering default for this milestone:

- local-only Bun runtime;
- Bun SQLite for the append-only virtual ledger and run index;
- content-addressed files for raw/provider artifacts;
- no cloud service and no brokerage connection.

This is a reversible Pre-Forward implementation choice. O-014 remains open for the formal long-running architecture.

Exit criteria:

- one real-data, virtual-money cycle completes end to end;
- a replay produces the same decision and state transition;
- a duplicate invocation produces no duplicate order or cash movement;
- the portfolio never exceeds three holdings and the -30% hard stop remains authoritative;
- all results remain labeled `pre_forward_dry_run` and do not start the formal twelve-month clock.

### M3 — Repeatable operations

Status: **LATER**

Goal: make the Pre-Forward loop run reliably without manual orchestration.

Implementation package:

- select the O-014 execution architecture with explicit user approval;
- add monthly scheduling, locking, retry, recovery, and missed-run handling;
- store run health and data-quality incidents;
- notify only important failures/actions immediately;
- generate the monthly one-minute report and detailed drill-down;
- add a minimal operational view before any dashboard polish.

Recommended default to evaluate at Gate G3: local Bun + SQLite + macOS `launchd`, because the current candidate licenses emphasize private/internal use. Reliability, sleep/offline behavior, backup, and audit-retention tradeoffs must be compared before approval.

Exit criteria:

- two scheduled rehearsal cycles complete without manual state repair;
- retries do not duplicate state transitions;
- a missed or failed run is visible and recoverable;
- notification and report artifacts link back to the immutable Decision Package.

Gate G3: explicit O-014 architecture approval before enabling unattended scheduling.

### M4 — Formal Forward-Test readiness

Status: **LATER**

Goal: freeze the evidence, strategies, and evaluation rules that start the formal experiment.

Required work and approvals:

- O-001: select the production data bundle and rights;
- O-003/O-004: approve eligibility thresholds and the dated starting Universe;
- O-005/O-006/O-007/O-008: approve Strategy A/B parameters, execution rules, cash proxy, and shared-risk cap;
- O-012/O-013: implement and validate Strategy C, its Decision Package, models, fallbacks, cost, and latency boundaries;
- O-015: approve success, extension, incident, and drawdown thresholds before results are known;
- confirm that the three candidates differ in logic and realized historical return characteristics;
- freeze initial strategy, model, provider, data-policy, and reporting versions.

Exit criteria:

- all three candidates pass their declared readiness checklist;
- the start package contains no unresolved silent default;
- the user explicitly approves the formal start date and versions.

Gate G4: explicit human approval to start the formal Forward Test.

### M5 — Formal twelve-month Forward Test

Status: **NOT STARTED**

- run three virtual JPY 1,000,000 portfolios;
- do not override individual virtual trades manually;
- keep all strategy changes versioned and apply the required revalidation;
- issue monthly reports and immediate material-event notifications;
- score ETF forecasts and portfolio P/L separately;
- record incidents, restarts, and extensions against the predeclared O-015 rules;
- observe for at least twelve calendar months.

Passing this milestone permits a real-money proposal. It does not authorize real orders.

### M6 — Real-money proposal

Status: **NOT NOW**

Brokerage selection, order integration, taxes, staged capital, and operational controls remain O-016 work. No implementation begins before the formal Forward Test and explicit approval.

## Focus rules

These rules apply to every new task, branch, and PR.

1. **One active milestone.** Work belongs to the current milestone or is recorded for later.
2. **One runnable outcome per implementation PR.** A PR may be large and use parallel agents, but all changes must support the same acceptance path.
3. **Foundation needs a current consumer.** A new abstraction, schema, or service is allowed only when the same milestone uses it in an executable path or acceptance test.
4. **No speculative generalization.** Support the selected milestone contract first; record additional providers, storage engines, schedulers, and UI variants as later work.
5. **Unknown stays visible.** Time-box research. If evidence is unavailable, record `unknown` or `blocked` and return to the gate instead of building around an assumption.
6. **No next-phase leakage.** Dashboard polish, Strategy C, emergency automation, cloud deployment, and brokerage work cannot enter M1/M2 unless needed to satisfy their listed exit criteria.
7. **Checkpoint after every merge.** Update this roadmap, `CURRENT_STATUS.md`, test evidence, active milestone, and next command before starting another branch.
8. **Stop after two non-runnable PRs.** If two consecutive implementation PRs do not advance an executable acceptance path, stop and re-plan with the user.

## Start-of-task checkpoint

Before implementation, answer these questions in the task plan:

1. What is the active milestone?
2. Which exit criterion does this task satisfy?
3. What executable command or artifact becomes newly available?
4. What is explicitly out of scope?
5. Does the task require a user gate or an unresolved O-decision?

If question 2 or 3 has no concrete answer, do not implement the task yet.

## Current checkpoint

- Current milestone: **M1 — Credentialed data slice**
- Completed software outcome: fixture-tested J-Quants/EODHD credentialed-sample capture/audit/replay command for the same five synthetic JPX mappings
- Next evidence outcome: an explicitly authorized 5–10 ETF real sample, including entitled lifecycle/event/calendar/quote fields where available
- Current external gate: permission to use credentials/incur cost and confirmation of permitted raw-response retention
- Next runnable milestone: **M2 — Manual Pre-Forward vertical slice**
- Formal Forward-Test clock: **not started**

## Progress log

| Date | Evidence | Milestone result | Next checkpoint |
|---|---|---|---|
| 2026-08-29 | PR #9 merged; provider evaluation remains fail-closed; 152 tests passed in PR verification | M0 complete, M1 active | Build the credentialed-sample capture path without secrets, then request G1/G2 for the real sample |
| 2026-08-29 | `credentialed-sample-v1` fixture capture and offline replay produce the same immutable fail-closed audit for five mappings across J-Quants/EODHD contracts | M1 software spine complete; real evidence still absent | Merge the implementation PR, then stop at G1/G2 until credential, cost, entitlement, and retention are explicitly approved |
