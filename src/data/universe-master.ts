import { readFile } from "node:fs/promises";
import type { SourceProvenance } from "./provenance.ts";
import { isIsoDateTime, sha256Canonical } from "./provenance.ts";
import { compareText } from "../determinism.ts";

export const UNIVERSE_MASTER_SCHEMA_VERSION = "universe-master-v1" as const;

const HEADERS = [
  "schema_version",
  "observation_id",
  "supersedes_observation_id",
  "instrument_id",
  "code",
  "symbol",
  "name",
  "asset_group",
  "subgroup",
  "status",
  "role",
  "is_theme",
  "instrument_type",
  "is_us_equity",
  "is_crypto_asset",
  "is_leveraged",
  "is_inverse",
  "exchange",
  "currency",
  "listing_date",
  "last_eligible_date",
  "observed_at",
  "available_at",
  "source",
  "dataset",
  "retrieved_at",
  "source_version",
  "record_id",
  "notes",
] as const;

export interface UniverseMasterRecord {
  schemaVersion: typeof UNIVERSE_MASTER_SCHEMA_VERSION;
  observationId: string;
  supersedesObservationId?: string;
  instrumentId: string;
  code: string;
  symbol: string;
  name: string;
  assetGroup: string;
  subgroup: string;
  status: string;
  role: string;
  isTheme: boolean;
  instrumentType: string;
  isUsEquity: boolean;
  isCryptoAsset: boolean;
  isLeveraged: boolean;
  isInverse: boolean;
  exchange: string;
  currency: string;
  listingDate: string;
  lastEligibleDate?: string;
  observedAt: string;
  availableAt: string;
  provenance: Required<Pick<SourceProvenance, "source" | "dataset" | "retrievedAt" | "sourceVersion" | "recordId">>;
  notes?: string;
}

export interface UniverseMaster {
  schemaVersion: typeof UNIVERSE_MASTER_SCHEMA_VERSION;
  records: readonly UniverseMasterRecord[];
  fingerprint: string;
}

export type UniverseExclusionReason =
  | "metadata_unavailable"
  | "not_yet_listed"
  | "past_last_eligible_date"
  | "instrument_not_etf"
  | "prohibited_product_structure"
  | "currency_not_supported"
  | "status_not_enabled";

export interface UniverseEligibilityPolicy {
  allowedStatuses: ReadonlySet<string>;
  supportedCurrencies: ReadonlySet<string>;
}

export interface UniverseMembershipDecision {
  code: string;
  decisionDate: string;
  eligible: boolean;
  reason?: UniverseExclusionReason;
  observationId?: string;
  status?: string;
  listingDate?: string;
  lastEligibleDate?: string;
  observedAt?: string;
  availableAt?: string;
  instrumentType?: string;
  isUsEquity?: boolean;
  isCryptoAsset?: boolean;
  isLeveraged?: boolean;
  isInverse?: boolean;
  currency?: string;
  provenance?: UniverseMasterRecord["provenance"];
}

export interface UniverseInstrumentDefinition {
  instrumentId: string;
  code: string;
  symbol: string;
  earliestListingDate: string;
  latestPossibleEligibleDate?: string;
  observationIds: readonly string[];
}

function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field !== "") throw new Error("Malformed CSV quote in universe master.");
      quoted = true;
    } else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(field.trim());
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quote in universe master.");
  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function required(value: string, field: string, line: number): string {
  if (value === "") throw new Error(`Missing ${field} in universe master at line ${line}.`);
  return value;
}

function parseBoolean(value: string, field: string, line: number): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${field} must be true or false in universe master at line ${line}.`);
}

function endOfDecisionDate(value: string): { date: string; cutoffMs: number } {
  if (isIsoDate(value)) {
    return { date: value, cutoffMs: Date.parse(`${value}T23:59:59.999Z`) };
  }
  if (!isIsoDateTime(value)) throw new Error(`Invalid universe decision timestamp: ${value}.`);
  const parsed = Date.parse(value);
  return { date: new Date(parsed).toISOString().slice(0, 10), cutoffMs: parsed };
}

function validateRevisionChains(records: readonly UniverseMasterRecord[]): void {
  const byObservation = new Map(records.map((record) => [record.observationId, record]));
  const successor = new Map<string, string>();
  const byInstrument = new Map<string, UniverseMasterRecord[]>();
  const codeToInstrument = new Map<string, string>();

  for (const record of records) {
    const priorInstrument = codeToInstrument.get(record.code);
    if (priorInstrument !== undefined && priorInstrument !== record.instrumentId) {
      throw new Error(`Universe code ${record.code} maps to multiple instrument_id values.`);
    }
    codeToInstrument.set(record.code, record.instrumentId);
    const group = byInstrument.get(record.instrumentId) ?? [];
    group.push(record);
    byInstrument.set(record.instrumentId, group);

    if (record.supersedesObservationId === undefined) continue;
    const predecessor = byObservation.get(record.supersedesObservationId);
    if (predecessor === undefined) {
      throw new Error(`Universe observation ${record.observationId} supersedes an unknown observation.`);
    }
    if (predecessor.instrumentId !== record.instrumentId) {
      throw new Error(`Universe observation ${record.observationId} supersedes a different instrument.`);
    }
    if (Date.parse(predecessor.availableAt) >= Date.parse(record.availableAt)) {
      throw new Error(`Universe observation ${record.observationId} must become available after its predecessor.`);
    }
    if (successor.has(predecessor.observationId)) {
      throw new Error(`Universe observation ${predecessor.observationId} has an ambiguous revision branch.`);
    }
    successor.set(predecessor.observationId, record.observationId);
  }

  for (const [instrumentId, group] of byInstrument) {
    const roots = group.filter((record) => record.supersedesObservationId === undefined);
    if (roots.length !== 1) {
      throw new Error(`Universe instrument ${instrumentId} must have exactly one revision-chain root.`);
    }
    const stable = group[0]!;
    for (const record of group.slice(1)) {
      if (record.code !== stable.code || record.symbol !== stable.symbol) {
        throw new Error(`Universe instrument ${instrumentId} changes code or symbol within one revision chain.`);
      }
    }
    let visited = 0;
    let current: UniverseMasterRecord | undefined = roots[0];
    const seen = new Set<string>();
    while (current !== undefined) {
      if (seen.has(current.observationId)) {
        throw new Error(`Universe instrument ${instrumentId} contains a revision cycle.`);
      }
      seen.add(current.observationId);
      visited++;
      const nextId = successor.get(current.observationId);
      current = nextId === undefined ? undefined : byObservation.get(nextId);
    }
    if (visited !== group.length) {
      throw new Error(`Universe instrument ${instrumentId} has disconnected revision history.`);
    }
  }
}

export function parseUniverseMasterCsv(text: string): UniverseMaster {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("Universe master must contain a header and at least one data row.");
  const header = rows[0]!;
  if (new Set(header).size !== header.length) throw new Error("Universe master contains duplicate headers.");
  if (header.length !== HEADERS.length || header.some((value, index) => value !== HEADERS[index])) {
    throw new Error(`Universe master must use the exact ${UNIVERSE_MASTER_SCHEMA_VERSION} header.`);
  }

  const records: UniverseMasterRecord[] = [];
  const observationIds = new Set<string>();
  const recordIds = new Set<string>();
  for (const [offset, columns] of rows.slice(1).entries()) {
    const line = offset + 2;
    if (columns.length !== HEADERS.length) {
      throw new Error(`Universe master line ${line} has ${columns.length} columns; expected ${HEADERS.length}.`);
    }
    const cell = (headerName: typeof HEADERS[number]) => columns[HEADERS.indexOf(headerName)]!;
    const schemaVersion = required(cell("schema_version"), "schema_version", line);
    if (schemaVersion !== UNIVERSE_MASTER_SCHEMA_VERSION) {
      throw new Error(`Unsupported universe schema_version at line ${line}: ${schemaVersion}.`);
    }
    const observationId = required(cell("observation_id"), "observation_id", line);
    if (observationIds.has(observationId)) throw new Error(`Duplicate universe observation_id: ${observationId}.`);
    observationIds.add(observationId);
    const recordId = required(cell("record_id"), "record_id", line);
    if (recordIds.has(recordId)) throw new Error(`Duplicate universe record_id: ${recordId}.`);
    recordIds.add(recordId);

    const listingDate = required(cell("listing_date"), "listing_date", line);
    const lastEligibleDate = cell("last_eligible_date") || undefined;
    if (!isIsoDate(listingDate)) throw new Error(`Invalid listing_date at universe master line ${line}.`);
    if (lastEligibleDate !== undefined && !isIsoDate(lastEligibleDate)) {
      throw new Error(`Invalid last_eligible_date at universe master line ${line}.`);
    }
    if (lastEligibleDate !== undefined && listingDate > lastEligibleDate) {
      throw new Error(`listing_date must not be after last_eligible_date at universe master line ${line}.`);
    }

    const observedAt = required(cell("observed_at"), "observed_at", line);
    const availableAt = required(cell("available_at"), "available_at", line);
    const retrievedAt = required(cell("retrieved_at"), "retrieved_at", line);
    for (const [field, value] of [["observed_at", observedAt], ["available_at", availableAt], ["retrieved_at", retrievedAt]] as const) {
      if (!isIsoDateTime(value)) throw new Error(`Invalid ${field} at universe master line ${line}.`);
    }
    if (Date.parse(observedAt) > Date.parse(availableAt) || Date.parse(availableAt) > Date.parse(retrievedAt)) {
      throw new Error(`Universe timestamps must satisfy observed_at <= available_at <= retrieved_at at line ${line}.`);
    }

    records.push({
      schemaVersion: UNIVERSE_MASTER_SCHEMA_VERSION,
      observationId,
      supersedesObservationId: cell("supersedes_observation_id") || undefined,
      instrumentId: required(cell("instrument_id"), "instrument_id", line),
      code: required(cell("code"), "code", line),
      symbol: required(cell("symbol"), "symbol", line),
      name: required(cell("name"), "name", line),
      assetGroup: required(cell("asset_group"), "asset_group", line),
      subgroup: required(cell("subgroup"), "subgroup", line),
      status: required(cell("status"), "status", line),
      role: required(cell("role"), "role", line),
      isTheme: parseBoolean(cell("is_theme"), "is_theme", line),
      instrumentType: required(cell("instrument_type"), "instrument_type", line),
      isUsEquity: parseBoolean(cell("is_us_equity"), "is_us_equity", line),
      isCryptoAsset: parseBoolean(cell("is_crypto_asset"), "is_crypto_asset", line),
      isLeveraged: parseBoolean(cell("is_leveraged"), "is_leveraged", line),
      isInverse: parseBoolean(cell("is_inverse"), "is_inverse", line),
      exchange: required(cell("exchange"), "exchange", line),
      currency: required(cell("currency"), "currency", line),
      listingDate,
      lastEligibleDate,
      observedAt,
      availableAt,
      provenance: {
        source: required(cell("source"), "source", line),
        dataset: required(cell("dataset"), "dataset", line),
        retrievedAt,
        sourceVersion: required(cell("source_version"), "source_version", line),
        recordId,
      },
      notes: cell("notes") || undefined,
    });
  }

  validateRevisionChains(records);
  records.sort((left, right) => compareText(left.instrumentId, right.instrumentId)
    || Date.parse(left.availableAt) - Date.parse(right.availableAt)
    || compareText(left.observationId, right.observationId));
  const master = { schemaVersion: UNIVERSE_MASTER_SCHEMA_VERSION, records };
  return { ...master, fingerprint: sha256Canonical(master) };
}

export async function loadUniverseMaster(path: string): Promise<UniverseMaster> {
  return parseUniverseMasterCsv(await readFile(path, "utf8"));
}

export function assertUniverseMasterIntegrity(master: UniverseMaster): void {
  if (master.schemaVersion !== UNIVERSE_MASTER_SCHEMA_VERSION) {
    throw new Error(`Unsupported universe schemaVersion: ${String(master.schemaVersion)}.`);
  }
  validateRevisionChains(master.records);
  const fingerprint = sha256Canonical({ schemaVersion: master.schemaVersion, records: master.records });
  if (fingerprint !== master.fingerprint) {
    throw new Error("Universe master fingerprint does not match its current records.");
  }
}

function recordsForCode(master: UniverseMaster, code: string): UniverseMasterRecord[] {
  return master.records.filter((record) => record.code === code);
}

export function resolveUniverseRecordAsOf(
  master: UniverseMaster,
  code: string,
  decisionDate: string,
): UniverseMasterRecord | undefined {
  const { cutoffMs } = endOfDecisionDate(decisionDate);
  return recordsForCode(master, code)
    .filter((record) => Date.parse(record.availableAt) <= cutoffMs)
    .sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt)
      || compareText(left.observationId, right.observationId))
    .at(-1);
}

export function evaluateUniverseMembership(
  master: UniverseMaster,
  code: string,
  decisionDate: string,
  policy: UniverseEligibilityPolicy,
): UniverseMembershipDecision {
  if (policy.allowedStatuses.size === 0) throw new Error("allowedStatuses must be explicitly non-empty.");
  if (policy.supportedCurrencies.size === 0) throw new Error("supportedCurrencies must be explicitly non-empty.");
  const { date } = endOfDecisionDate(decisionDate);
  const record = resolveUniverseRecordAsOf(master, code, decisionDate);
  if (record === undefined) return { code, decisionDate: date, eligible: false, reason: "metadata_unavailable" };

  const common = {
    code,
    decisionDate: date,
    observationId: record.observationId,
    status: record.status,
    listingDate: record.listingDate,
    lastEligibleDate: record.lastEligibleDate,
    observedAt: record.observedAt,
    availableAt: record.availableAt,
    instrumentType: record.instrumentType,
    isUsEquity: record.isUsEquity,
    isCryptoAsset: record.isCryptoAsset,
    isLeveraged: record.isLeveraged,
    isInverse: record.isInverse,
    currency: record.currency,
    provenance: record.provenance,
  };
  if (date < record.listingDate) return { ...common, eligible: false, reason: "not_yet_listed" };
  if (record.lastEligibleDate !== undefined && date > record.lastEligibleDate) {
    return { ...common, eligible: false, reason: "past_last_eligible_date" };
  }
  if (record.instrumentType.toLowerCase() !== "etf") {
    return { ...common, eligible: false, reason: "instrument_not_etf" };
  }
  if (record.isUsEquity || record.isCryptoAsset || record.isLeveraged || record.isInverse) {
    return { ...common, eligible: false, reason: "prohibited_product_structure" };
  }
  if (!policy.supportedCurrencies.has(record.currency)) {
    return { ...common, eligible: false, reason: "currency_not_supported" };
  }
  if (!policy.allowedStatuses.has(record.status)) return { ...common, eligible: false, reason: "status_not_enabled" };
  return { ...common, eligible: true };
}

export function resolveUniverseSnapshot(
  master: UniverseMaster,
  decisionDate: string,
  allowedStatuses: readonly string[],
  supportedCurrencies: readonly string[],
): UniverseMembershipDecision[] {
  const policy = { allowedStatuses: new Set(allowedStatuses), supportedCurrencies: new Set(supportedCurrencies) };
  const codes = [...new Set(master.records.map((record) => record.code))].sort(compareText);
  return codes.map((code) => evaluateUniverseMembership(master, code, decisionDate, policy));
}

export function getUniverseInstrumentDefinition(
  master: UniverseMaster,
  code: string,
): UniverseInstrumentDefinition {
  const records = recordsForCode(master, code);
  if (records.length === 0) throw new Error(`Universe master has no record for configured code ${code}.`);
  const lastDates = records.map((record) => record.lastEligibleDate);
  return {
    instrumentId: records[0]!.instrumentId,
    code,
    symbol: records[0]!.symbol,
    earliestListingDate: records.map((record) => record.listingDate).sort(compareText)[0]!,
    latestPossibleEligibleDate: lastDates.some((date) => date === undefined)
      ? undefined
      : (lastDates as string[]).sort(compareText).at(-1),
    observationIds: records.map((record) => record.observationId).sort(compareText),
  };
}
