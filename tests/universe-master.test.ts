import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  evaluateUniverseMembership,
  evaluateUniverseMembershipAtCutoff,
  getUniverseInstrumentDefinition,
  parseUniverseMasterCsv,
  resolveUniverseSnapshot,
} from "../src/data/universe-master.ts";

const fixturePath = "tests/fixtures/universe/universe-master-v1.csv";

test("strict universe master resolves lifecycle, status, and late-known revisions point in time", async () => {
  const master = parseUniverseMasterCsv(await readFile(fixturePath, "utf8"));
  assert.match(master.fingerprint, /^sha256:[0-9a-f]{64}$/);
  const statuses = new Set(["test_candidate"]);
  const policy = { allowedStatuses: statuses, supportedCurrencies: new Set(["JPY"]) };

  assert.equal(evaluateUniverseMembership(master, "ENDED", "2025-01-15", policy).eligible, true);
  assert.equal(
    evaluateUniverseMembership(master, "ENDED", "2025-01-16", policy).reason,
    "past_last_eligible_date",
  );
  assert.equal(evaluateUniverseMembership(master, "FUTURE", "2025-12-31", policy).reason, "not_yet_listed");
  assert.equal(evaluateUniverseMembership(master, "DISABLED", "2025-01-01", policy).reason, "status_not_enabled");

  const beforeCorrection = evaluateUniverseMembership(master, "REVISED", "2025-01-19", policy);
  assert.equal(beforeCorrection.eligible, true);
  assert.equal(beforeCorrection.observationId, "univ-revised-v1");
  const afterCorrection = evaluateUniverseMembership(master, "REVISED", "2025-01-31", policy);
  assert.equal(afterCorrection.eligible, false);
  assert.equal(afterCorrection.reason, "past_last_eligible_date");
  assert.equal(afterCorrection.observationId, "univ-revised-v2");
  assert.equal(afterCorrection.provenance?.recordId, "record-revised-v2");
});

test("universe eligibility separates the effective market date from the metadata information cutoff", async () => {
  const master = parseUniverseMasterCsv(await readFile(fixturePath, "utf8"));
  const policy = {
    allowedStatuses: new Set(["test_candidate"]),
    supportedCurrencies: new Set(["JPY"]),
  };
  const beforeRevisionAvailable = evaluateUniverseMembershipAtCutoff(
    master,
    "REVISED",
    "2025-01-16",
    "2025-01-19T23:59:59Z",
    policy,
  );
  assert.equal(beforeRevisionAvailable.eligible, true);
  assert.equal(beforeRevisionAvailable.observationId, "univ-revised-v1");

  const afterRevisionAvailable = evaluateUniverseMembershipAtCutoff(
    master,
    "REVISED",
    "2025-01-16",
    "2025-01-20T01:00:00Z",
    policy,
  );
  assert.equal(afterRevisionAvailable.eligible, false);
  assert.equal(afterRevisionAvailable.reason, "past_last_eligible_date");
  assert.equal(afterRevisionAvailable.observationId, "univ-revised-v2");
});

test("universe snapshot and instrument definitions are deterministic", async () => {
  const text = await readFile(fixturePath, "utf8");
  const original = parseUniverseMasterCsv(text);
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const reordered = parseUniverseMasterCsv([header, ...rows.reverse()].join("\n"));

  assert.deepEqual(
    resolveUniverseSnapshot(reordered, "2025-01-31", ["test_candidate"], ["JPY"]),
    resolveUniverseSnapshot(original, "2025-01-31", ["test_candidate"], ["JPY"]),
  );
  assert.deepEqual(getUniverseInstrumentDefinition(original, "REVISED"), {
    instrumentId: "instrument-revised",
    code: "REVISED",
    symbol: "synthetic",
    earliestListingDate: "2023-01-02",
    latestPossibleEligibleDate: undefined,
    observationIds: ["univ-revised-v1", "univ-revised-v2"],
  });
});

test("legacy candidate catalog and malformed versioned masters fail closed", async () => {
  assert.throws(
    () => parseUniverseMasterCsv("asset_group,subgroup,code,name,status,role,notes\nX,Y,A,Name,candidate,core,note\n"),
    /exact universe-master-v1 header/,
  );

  const valid = await readFile(fixturePath, "utf8");
  assert.throws(
    () => parseUniverseMasterCsv(valid.replace("univ-beta-v1", "univ-alpha-v1")),
    /Duplicate universe observation_id/,
  );
  assert.throws(
    () => parseUniverseMasterCsv(valid.replace("2025-01-15,2022-12-01", "2022-01-01,2022-12-01")),
    /listing_date must not be after last_eligible_date/,
  );
  assert.throws(
    () => parseUniverseMasterCsv(valid.replace("univ-revised-v1,instrument-revised", "missing-observation,instrument-revised")),
    /supersedes an unknown observation/,
  );
  const nonEtf = parseUniverseMasterCsv(valid.replace(",false,etf,false,false,false,false,TEST,JPY,", ",false,crypto,false,false,false,false,TEST,JPY,"));
  const eligibilityPolicy = { allowedStatuses: new Set(["test_candidate"]), supportedCurrencies: new Set(["JPY"]) };
  assert.equal(
    evaluateUniverseMembership(nonEtf, "ALPHA", "2025-01-01", eligibilityPolicy).reason,
    "instrument_not_etf",
  );
  const prohibited = parseUniverseMasterCsv(valid.replace(",etf,false,false,false,false,TEST,JPY,", ",etf,true,false,false,false,TEST,JPY,"));
  assert.equal(
    evaluateUniverseMembership(prohibited, "ALPHA", "2025-01-01", eligibilityPolicy).reason,
    "prohibited_product_structure",
  );
  const foreign = parseUniverseMasterCsv(valid.replace(",TEST,JPY,", ",TEST,USD,"));
  assert.equal(
    evaluateUniverseMembership(foreign, "ALPHA", "2025-01-01", eligibilityPolicy).reason,
    "currency_not_supported",
  );
});
