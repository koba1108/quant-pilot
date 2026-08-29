# O-001 Production Market-Data Evaluation

- Evaluation date: 2026-08-29
- Machine schema: `provider-evaluation-v1`
- Policy: `o001-production-readiness-proposed-v1` (**proposed, not approved**)
- Selection: **not selected**

## Technical summary

No evaluated individual provider or two-source bundle is ready to enable `etf_realistic`. The current machine evaluation is `blocked`, remains fail-closed, and deliberately cannot select a provider. An authorized local audit retained successful J-Quants responses for five JPX ETFs over 2026-04-20..22 and HTTP 404 responses for the same five EODHD `.TSE` mappings. Separate bounded discovery probes found no Japan/XJPX/Tokyo exchange and no Japanese `search/1308` result for the current EODHD account. J-Quants plus EODHD remains a research configuration only: EODHD is retained as an overseas/FX candidate, not a JPX daily-price comparator. J-Quants plus Twelve Data is the alternative; neither is an approved production source.

The capture/replay plumbing now has fixture and bounded live evidence. The owner-only local live audit is immutable and replayable, but it contains only one successful JPX source; every field comparison remains `insufficient_sources`. The remaining blockers are a usable independent comparator, proof of an official Total Return construction, source-native Point-in-Time availability and revisions, complete ETF distribution and Corporate Action coverage, historical Tokyo ETF bid/ask evidence, and durable production audit-reproduction rights. `AdjustedClose` and `adjust=all` are therefore never relabeled as Total Return.

The report uses tables instead of a numeric chart because the evidence is categorical and incomplete. A numerical provider score would imply precision and automatic ranking that O-001 does not authorize.

## Key findings

### Individual-access candidates

Legend: `documented` means an official page describes the capability; `partial` means the documented scope is insufficient for the production contract; `unknown` means the required strong guarantee was not found. None of these labels means a credentialed production sample passed.

| Requirement | J-Quants individual | EODHD individual | Twelve Data individual |
|---|---|---|---|
| Japanese ETF daily prices | partial; bounded credentialed audit retained five successful JPX ETF responses over 2026-04-20..22 outside Git | partial; current-account audit retained HTTP 404 for all five tested `.TSE` mappings | documented; XJPX coverage requires symbol/plan sample |
| Adjustment data | partial; split/reverse-split and related adjustments, not Total Return | partial; adjusted close requires event reconciliation | partial; explicit adjust modes, not Total Return proof |
| Official Total Return series | unknown | unknown | unknown |
| ETF distributions / Corporate Actions | partial; Premium dividend data, ETF completeness unverified | partial; generic dividends/splits, product completeness unverified | partial; dividend/split coverage lacks the required complete lifecycle evidence |
| JPY FX | unknown / separate source required | documented; fixing and PIT semantics unverified | documented; fixing and PIT semantics unverified |
| Historical Universe / listing lifecycle | partial; dated listed snapshots, no complete immutable chain | partial; delisted access with coverage limitations | unknown |
| Tokyo ETF historical bid/ask or spread | partial only through separate JPX files | unknown | unknown |
| Exchange and security calendar | partial; TSE/OSE calendar, but security halts and last-trading dates remain separate | partial | unknown |
| Row-level `availableAt` | unknown | unknown | unknown |
| Immutable revision history | unsupported in the evaluated J-Quants individual contract; corrections overwrite prior values | unknown | unknown |
| Private-research licensing | public terms indicate private-use restrictions; machine overall remains unknown without a terms snapshot | public terms indicate private-use and post-termination restrictions; machine overall remains unknown without a terms snapshot | public terms indicate personal/internal-use restrictions; machine overall remains unknown without a terms snapshot |
| Current adapter proof | owner-only local audit retained five successful responses and replays offline; no artifact is embedded in the committed evaluation | owner-only local audit retained five HTTP 404 responses and replays offline; no artifact is embedded in the committed evaluation | not implemented |

Primary evidence:

- J-Quants: [JPX overview](https://www.jpx.co.jp/english/markets/other-data-services/j-quants-api/index.html), [plans and data scope](https://jpx-jquants.com/en), and [private-use rules](https://jpx-jquants.com/en/help/usage).
- EODHD: [historical prices](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes), [dividends and splits](https://eodhd.com/financial-apis/bulk-api-eod-splits-dividends), [delisted data](https://eodhd.com/financial-apis/delisted-stock-companies-data-2), [FX coverage](https://eodhd.com/financial-apis/list-supported-forex-currencies), and [terms](https://eodhd.com/financial-apis/terms-conditions).
- Twelve Data: [time-series adjustment controls](https://twelvedata.com/docs/advanced), [market coverage](https://twelvedata.com/fundamentals), [pricing](https://twelvedata.com/pricing), and [personal/commercial-use boundaries](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage).

### Source-bundle interpretation

The acceptance unit is a versioned source bundle, not necessarily one vendor. A bundle must assign each field to an explicit source, identify the provider's organization-level independence group, keep all conflicting observations, and never choose a winner or fill a missing value implicitly. Two product IDs in the same independence group count as one source.

| Research bundle | Intended responsibility | Current disposition | Why it remains closed |
|---|---|---|---|
| J-Quants + EODHD | J-Quants for TSE prices/calendar/listed snapshots; EODHD for overseas ETFs, FX, delisted history, and non-JPX comparison | blocked | EODHD current-account JPX coverage probe is negative; the retained partial audit has no successful cross-source comparison; incomplete ETF event/PIT/spread proof; J-Quants source-native revision chain unavailable; production retention rights remain unresolved |
| J-Quants + Twelve Data | J-Quants for TSE primary data; Twelve Data for adjustment-mode comparison and FX | blocked | same J-Quants PIT blocker; Twelve Data listing lifecycle, Tokyo quote quality, and audit rights remain unknown |

The first bundle remains a **research candidate** for an overseas/FX complement or non-JPX comparison, not an adopted provider or a JPX daily-price comparator. O-001 stays in `OPEN_DECISIONS.md` until retained samples, rights, costs, and the proposed gate receive human approval.

### Institutional comparison

The official-material review also retained three institutional candidates without adding them to the individual-plan machine snapshot:

| Candidate | Relevant public evidence | Remaining decision gap |
|---|---|---|
| LSEG DataScope Select/Plus | broad active/retired reference data, historical pricing, Corporate Actions, funds, and FX | Japan ETF entitlement, exact PIT/revision contract, minimum price, and individual-project eligibility require a sales sample |
| SIX Web API/VDF/Ultumus | reference/calendar fields, Corporate Actions, fund/ETF data, versioned Ultumus data, and a Web API trial path | Japan ETF depth, general PIT revisions, license, and price require confirmation |
| Bloomberg Data License | broad fund/reference/Corporate Action/real-time catalogs and long Point-in-Time research data | Japan ETF coverage, ETF lifecycle/FX/calendar contract, price, and minimum agreement are not public enough to approve |

Official starting points: [LSEG DataScope Select](https://www.lseg.com/en/data-analytics/products/datascope-select-data-delivery), [SIX Web API](https://www.six-group.com/en/products-services/financial-information/delivery-methods/api/web.html), and [Bloomberg Data License](https://professional.bloomberg.com/products/data/data-license/). These are comparison and future-contract candidates, not production approvals.

## Scope, data, and definitions

The committed evidence snapshot is [`research/provider-evaluation/o001-candidates.json`](../research/provider-evaluation/o001-candidates.json). It records official URLs, claims, evaluation dates, capability status, availability model, adapter status, license rights, commercial approval, source responsibilities, and bounded probe limitations. It does not contain downloaded market data, credentials, vendor responses, or private contract material. The actual live artifacts exist only in the approved owner-only Git-ignored local store and are not bound into this committed machine snapshot.

The evaluator emits four dispositions:

- `pass`: reserved for a future schema that binds payload-specific validators, real reconciliation reports, and an approved production selection.
- `research_only`: retained in the report vocabulary for non-production evidence, but schema v1 does not permit a capability to become `verified` and therefore cannot use metadata envelopes alone to reach a positive readiness result.
- `unknown`: one or more required guarantees are unproven.
- `blocked`: a required capability or right is explicitly incompatible or unsupported.

All reports in schema v1 keep `selection=not_selected`, `failClosed=true`, and `canEnableEtfRealistic=false`. Schema v1 also emits an explicit research-only boundary because provider declarations and sample metadata are not a substitute for a bound field-level reconciliation report. Provider adoption requires a separate human-approved O-001 decision and a future schema that binds the selected bundle.

## Methodology

1. Read the active investment/data decisions and O-001 requirements.
2. Review only vendor, exchange, and official terms pages for each recorded claim.
3. Distinguish a documented endpoint from a credentialed sample and from production verification.
4. Require explicit coverage for prices, adjustment/event accounting, FX, Universe/lifecycle, quote quality, calendar, availability, revisions, reproducibility, and license rights.
5. Model source responsibility by capability; do not calculate a provider score or select a winner.
6. Require every declared sample artifact to be embedded and integrity-checked, with an artifact kind matching the claimed capability and a provenance source matching the provider.
7. Reject `status=verified` in `provider-evaluation-v1`: generic artifact envelopes do not validate capability-specific payload semantics. A future schema must add typed payload validators and bind a real reconciliation report before it can admit that state.
8. Require non-unknown overall license conclusions and human-approved commercial states to use a versioned document snapshot binding content, URL, title, version, publisher, and evidence ID. URL/version discovery records without document bodies keep the machine overall license result `unknown`.
9. Fail closed on missing row-level availability, immutable revisions, audit rights, approved cost/contract terms, or independent-source identity.

The machine output records config, evidence, candidate, bundle, and report fingerprints. Reordering equivalent inputs produces the same report, and integrity validation re-evaluates the report from its input config instead of trusting a recomputed output fingerprint. Current fingerprint values are intentionally read from the generated CLI output rather than copied into this narrative, because any evidence-contract edit changes them.

## Adapter spike

`src/data/jquants-v2.ts` implements a read-only, API-key-in-header J-Quants v2 daily-bars contract with pagination, strict row validation, semantic request-date enforcement, four/five-character security-code normalization, symbol/code matching, and explicit missing values. Credentialed requests are restricted to the official HTTPS API host. It can be selected as `provider=jquants_v2` only with:

```json
{
  "provider": "jquants_v2",
  "returnBasis": "unadjusted_price",
  "researchLayer": "proxy"
}
```

The adapter deliberately does not:

- call the API without `JQUANTS_API_KEY`;
- log or place the key in a URL;
- accept adjusted fields as normalized Price Return or Total Return;
- invent `availableAt`, revision history, distributions, FX, or Universe observations;
- persist raw vendor responses by itself or claim production license-compliant retention;
- unlock `etf_realistic`.

Official no-trade rows with null prices are explicitly excluded rather than filled with zero or a prior value. An inconsistent partially-null price row is rejected, and a response containing no usable bars fails with an explicit no-data error.

Contract tests use mocked responses. The M1 `credentialed-sample-report-v2` path retains exact fixture or live response bytes, normalizes successful daily bars, records captured HTTP failures, and replays offline. The bounded live audit retained five successful J-Quants responses and five EODHD HTTP 404 responses. It produced no cross-provider value comparison because EODHD supplied no bars; all 60 field groups remain explicit `insufficient_sources` findings.

## Limitations and robustness

- Official pages can change; the current URL, check date, and human-readable version label are discovery evidence, not an immutable snapshot. The committed candidate file intentionally has no document bodies or hashes and therefore cannot support `verified`. A credentialed evaluation must retain a license-permitted raw response or document snapshot, request fingerprint, retrieval time, source/adapter version, and content hash.
- A vendor's general equity/dividend claim does not prove complete coverage for the exact ETF list.
- Publication schedules are dataset guidance, not row-level knowledge timestamps.
- Legal delisting date, last trading date, trust termination, and settlement date are separate facts; none may be inferred from another.
- JPX business-day data does not by itself capture every early close, full-market outage, security halt, or ETF-specific last-trading date.
- Personal-plan pricing does not prove that required exchanges/endpoints are entitled or that indefinite audit retention is lawful.
- Institutional public pages are not a substitute for instrument-level samples and contract confirmation.

## Next actions

1. Treat the current G1/G2 authorization as bounded to this probe; obtain separate approval before any additional paid plan, entitlement, or retained-vendor-response use.
2. Keep the retained live bodies owner-only and outside Git; do not treat EODHD as the JPX daily-price comparator unless a future account/endpoint probe establishes target coverage.
3. Use the immutable partial audit as the bounded M1 result; do not convert its `insufficient_sources` findings into successful reconciliation.
4. In a separately approved comparison sample, reconcile raw close, adjustment factor, distribution amount/dates, lifecycle dates, calendar state, volume/trading value, and quote-quality fields without selecting a source winner.
5. Obtain written confirmation for ETF coverage, revision semantics, storage/retention, derived results, private audit replay, cancellation handling, and exact plan costs.
6. Add a separate official FX/fixing sample and calendar/lifecycle artifact where the market-data bundle is incomplete.
7. Bring the resulting evidence and proposed production gate to the user for O-001 approval. Only then add a selected-bundle schema and production Point-in-Time adapter.

## Further questions

- Is Quant Pilot guaranteed to remain private, personal, and non-commercial for the full retention period?
- What exact raw-data retention horizon is required for forward-test and later audit replay?
- Which 5–10 ETFs should constitute the credentialed coverage sample before O-004 is finalized?
- Is a self-captured revision history acceptable when the provider overwrites corrections, or must the source contract expose native revisions?
- Is historical aggregated JPX spread data sufficient for the first cost model, or is executable quote/order-book history required?
