import { Database } from "bun:sqlite";
import { chmod, lstat } from "node:fs/promises";
import { canonicalJson, sha256Canonical } from "../data/provenance.ts";
import {
  assertPreForwardDecisionPackage,
  assertVirtualPortfolioState,
  createInitialVirtualPortfolioState,
  type PreForwardDecisionPackage,
  type VirtualPortfolioState,
} from "./decision.ts";

export const PRE_FORWARD_LEDGER_SCHEMA_VERSION = "pre-forward-ledger-v1" as const;
export const PRE_FORWARD_LEDGER_TRANSITION_SCHEMA_VERSION = "pre-forward-ledger-transition-v1" as const;

const ARTIFACT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

interface RunRow {
  run_key: string;
  portfolio_id: string;
  strategy: "trend" | "rotation";
  as_of: string;
  strategy_config_version: string;
  decision_artifact_id: string;
  package_fingerprint: string;
  input_fingerprint: string;
  status: "executed" | "blocked";
  ledger_head_before: string | null;
  ledger_head_after: string | null;
  before_state_fingerprint: string;
  after_state_fingerprint: string;
}

interface EntryRow {
  entry_hash: string;
  portfolio_id: string;
  sequence: number;
  run_key: string;
  previous_entry_hash: string | null;
  payload_json: string;
}

export interface PreForwardLedgerTransitionPayload {
  schemaVersion: typeof PRE_FORWARD_LEDGER_TRANSITION_SCHEMA_VERSION;
  runKey: string;
  decisionArtifactId: string;
  packageFingerprint: string;
  beforeState: VirtualPortfolioState;
  afterState: VirtualPortfolioState;
}

export interface PreForwardLedgerSnapshot {
  state: VirtualPortfolioState;
  headHash?: string;
  sequence: number;
}

export interface PreForwardExistingRun {
  runKey: string;
  portfolioId: string;
  decisionArtifactId: string;
  packageFingerprint: string;
  inputFingerprint: string;
  status: "executed" | "blocked";
  ledgerHeadBefore?: string;
  ledgerHeadAfter?: string;
  beforeStateFingerprint: string;
  afterStateFingerprint: string;
}

export interface PreForwardLedgerAppendResult {
  idempotent: boolean;
  stateTransitionApplied: boolean;
  headBefore?: string;
  headAfter?: string;
}

function optionalHash(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function parseState(value: unknown): VirtualPortfolioState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ledger transition contains an invalid portfolio state.");
  }
  const state = value as VirtualPortfolioState;
  assertVirtualPortfolioState(state);
  return state;
}

function parseTransition(serialized: string): PreForwardLedgerTransitionPayload {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Pre-forward ledger transition is not valid JSON.", { cause: error });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pre-forward ledger transition must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== PRE_FORWARD_LEDGER_TRANSITION_SCHEMA_VERSION
    || typeof record.runKey !== "string"
    || typeof record.decisionArtifactId !== "string"
    || typeof record.packageFingerprint !== "string"
    || !ARTIFACT_ID_PATTERN.test(record.runKey)
    || !ARTIFACT_ID_PATTERN.test(record.decisionArtifactId)
    || !ARTIFACT_ID_PATTERN.test(record.packageFingerprint)) {
    throw new Error("Pre-forward ledger transition identity is invalid.");
  }
  return {
    schemaVersion: PRE_FORWARD_LEDGER_TRANSITION_SCHEMA_VERSION,
    runKey: record.runKey,
    decisionArtifactId: record.decisionArtifactId,
    packageFingerprint: record.packageFingerprint,
    beforeState: parseState(record.beforeState),
    afterState: parseState(record.afterState),
  };
}

function expectedEntryHash(
  portfolioId: string,
  sequence: number,
  previousEntryHash: string | undefined,
  payload: PreForwardLedgerTransitionPayload,
): string {
  return sha256Canonical({ portfolioId, sequence, previousEntryHash, payload });
}

async function assertPrivateDatabaseFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile()) throw new Error("Pre-forward ledger must be a regular file.");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("Pre-forward ledger permissions must be owner-only (0600).");
  }
}

export class PreForwardLedger implements Disposable {
  readonly path: string;
  private readonly database: Database;

  private constructor(path: string, database: Database) {
    this.path = path;
    this.database = database;
  }

  static async open(path: string): Promise<PreForwardLedger> {
    try {
      await assertPrivateDatabaseFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const database = new Database(path, { create: true, readwrite: true, strict: true });
    try {
      await chmod(path, 0o600);
      await assertPrivateDatabaseFile(path);
      database.run("PRAGMA foreign_keys = ON");
      database.run("PRAGMA journal_mode = DELETE");
      database.run("PRAGMA synchronous = FULL");
      database.run("PRAGMA trusted_schema = OFF");
      database.run("PRAGMA busy_timeout = 5000");
      database.run(`
        CREATE TABLE IF NOT EXISTS ledger_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT
      `);
      database.run(`
        CREATE TABLE IF NOT EXISTS pre_forward_runs (
          run_key TEXT PRIMARY KEY,
          portfolio_id TEXT NOT NULL,
          strategy TEXT NOT NULL CHECK (strategy IN ('trend', 'rotation')),
          as_of TEXT NOT NULL,
          strategy_config_version TEXT NOT NULL,
          decision_artifact_id TEXT NOT NULL UNIQUE,
          package_fingerprint TEXT NOT NULL,
          input_fingerprint TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('executed', 'blocked')),
          ledger_head_before TEXT,
          ledger_head_after TEXT,
          before_state_fingerprint TEXT NOT NULL,
          after_state_fingerprint TEXT NOT NULL
        ) STRICT
      `);
      database.run(`
        CREATE TABLE IF NOT EXISTS portfolio_ledger_entries (
          entry_hash TEXT PRIMARY KEY,
          portfolio_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          run_key TEXT NOT NULL UNIQUE REFERENCES pre_forward_runs(run_key),
          previous_entry_hash TEXT,
          payload_json TEXT NOT NULL,
          UNIQUE (portfolio_id, sequence)
        ) STRICT
      `);
      for (const table of ["ledger_metadata", "pre_forward_runs", "portfolio_ledger_entries"]) {
        database.run(`
          CREATE TRIGGER IF NOT EXISTS ${table}_no_update
          BEFORE UPDATE ON ${table}
          BEGIN SELECT RAISE(ABORT, 'pre-forward ledger is append-only'); END
        `);
        database.run(`
          CREATE TRIGGER IF NOT EXISTS ${table}_no_delete
          BEFORE DELETE ON ${table}
          BEGIN SELECT RAISE(ABORT, 'pre-forward ledger is append-only'); END
        `);
      }
      database.run(
        "INSERT OR IGNORE INTO ledger_metadata (key, value) VALUES ('schema_version', ?)",
        [PRE_FORWARD_LEDGER_SCHEMA_VERSION],
      );
      const metadata = database.query<{ value: string }, [string]>(
        "SELECT value FROM ledger_metadata WHERE key = ?",
      ).get("schema_version");
      if (metadata?.value !== PRE_FORWARD_LEDGER_SCHEMA_VERSION) {
        throw new Error(`Unsupported pre-forward ledger schema: ${metadata?.value ?? "missing"}.`);
      }
      const ledger = new PreForwardLedger(path, database);
      ledger.assertAppendOnlyGuards();
      return ledger;
    } catch (error) {
      database.close(true);
      throw error;
    }
  }

  close(): void {
    this.database.close(true);
  }

  [Symbol.dispose](): void {
    this.close();
  }

  getExistingRun(runKey: string): PreForwardExistingRun | undefined {
    const row = this.database.query<RunRow, [string]>(
      "SELECT * FROM pre_forward_runs WHERE run_key = ?",
    ).get(runKey);
    if (row === null) return undefined;
    return {
      runKey: row.run_key,
      portfolioId: row.portfolio_id,
      decisionArtifactId: row.decision_artifact_id,
      packageFingerprint: row.package_fingerprint,
      inputFingerprint: row.input_fingerprint,
      status: row.status,
      ledgerHeadBefore: optionalHash(row.ledger_head_before),
      ledgerHeadAfter: optionalHash(row.ledger_head_after),
      beforeStateFingerprint: row.before_state_fingerprint,
      afterStateFingerprint: row.after_state_fingerprint,
    };
  }

  readPortfolioSnapshot(portfolioId: string, initialCashJpy = 1_000_000): PreForwardLedgerSnapshot {
    const entries = this.database.query<EntryRow, [string]>(
      "SELECT * FROM portfolio_ledger_entries WHERE portfolio_id = ? ORDER BY sequence ASC",
    ).all(portfolioId);
    let state = createInitialVirtualPortfolioState(portfolioId, initialCashJpy);
    let headHash: string | undefined;
    let expectedSequence = 1;
    for (const entry of entries) {
      const payload = parseTransition(entry.payload_json);
      const previous = optionalHash(entry.previous_entry_hash);
      if (entry.sequence !== expectedSequence
        || previous !== headHash
        || entry.run_key !== payload.runKey
        || canonicalJson(payload.beforeState) !== canonicalJson(state)) {
        throw new Error(`Pre-forward ledger chain is inconsistent for ${portfolioId} at sequence ${entry.sequence}.`);
      }
      const expectedHash = expectedEntryHash(portfolioId, entry.sequence, previous, payload);
      if (entry.entry_hash !== expectedHash) {
        throw new Error(`Pre-forward ledger entry hash is invalid for ${portfolioId} at sequence ${entry.sequence}.`);
      }
      const run = this.getExistingRun(entry.run_key);
      if (run === undefined
        || run.status !== "executed"
        || run.decisionArtifactId !== payload.decisionArtifactId
        || run.packageFingerprint !== payload.packageFingerprint
        || run.ledgerHeadBefore !== previous
        || run.ledgerHeadAfter !== entry.entry_hash) {
        throw new Error(`Pre-forward run index is inconsistent with ledger entry ${entry.entry_hash}.`);
      }
      state = payload.afterState;
      headHash = entry.entry_hash;
      expectedSequence++;
    }
    return { state, headHash, sequence: expectedSequence - 1 };
  }

  appendDecision(
    packagePayload: PreForwardDecisionPackage,
    decisionArtifactId: string,
  ): PreForwardLedgerAppendResult {
    assertPreForwardDecisionPackage(packagePayload);
    if (!ARTIFACT_ID_PATTERN.test(decisionArtifactId)) {
      throw new Error("Decision artifact id must be a canonical SHA-256 identifier.");
    }
    const transaction = this.database.transaction((): PreForwardLedgerAppendResult => {
      const existing = this.getExistingRun(packagePayload.runKey);
      if (existing !== undefined) {
        if (existing.decisionArtifactId !== decisionArtifactId
          || existing.packageFingerprint !== packagePayload.packageFingerprint
          || existing.inputFingerprint !== packagePayload.input.inputFingerprint
          || existing.status !== packagePayload.status
          || existing.beforeStateFingerprint !== packagePayload.portfolio.beforeState.fingerprint
          || existing.afterStateFingerprint !== packagePayload.portfolio.afterState.fingerprint) {
          throw new Error(`Pre-forward run key already exists with different evidence: ${packagePayload.runKey}.`);
        }
        this.verifyDecision(packagePayload, decisionArtifactId);
        return {
          idempotent: true,
          stateTransitionApplied: false,
          headBefore: existing.ledgerHeadBefore,
          headAfter: existing.ledgerHeadAfter,
        };
      }
      const current = this.readPortfolioSnapshot(packagePayload.portfolioId);
      if (current.headHash !== packagePayload.ledger.expectedHeadBefore
        || canonicalJson(current.state) !== canonicalJson(packagePayload.portfolio.beforeState)) {
        throw new Error("Pre-forward ledger head or opening state changed before append.");
      }
      let headAfter = current.headHash;
      let entry: EntryRow | undefined;
      if (packagePayload.status === "executed") {
        const payload: PreForwardLedgerTransitionPayload = {
          schemaVersion: PRE_FORWARD_LEDGER_TRANSITION_SCHEMA_VERSION,
          runKey: packagePayload.runKey,
          decisionArtifactId,
          packageFingerprint: packagePayload.packageFingerprint,
          beforeState: packagePayload.portfolio.beforeState,
          afterState: packagePayload.portfolio.afterState,
        };
        const sequence = current.sequence + 1;
        headAfter = expectedEntryHash(packagePayload.portfolioId, sequence, current.headHash, payload);
        entry = {
          entry_hash: headAfter,
          portfolio_id: packagePayload.portfolioId,
          sequence,
          run_key: packagePayload.runKey,
          previous_entry_hash: current.headHash ?? null,
          payload_json: canonicalJson(payload),
        };
      }
      this.database.run(`
        INSERT INTO pre_forward_runs (
          run_key, portfolio_id, strategy, as_of, strategy_config_version, decision_artifact_id,
          package_fingerprint, input_fingerprint, status, ledger_head_before, ledger_head_after,
          before_state_fingerprint, after_state_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        packagePayload.runKey,
        packagePayload.portfolioId,
        packagePayload.strategy.name,
        packagePayload.asOf,
        packagePayload.strategy.strategyConfigVersion,
        decisionArtifactId,
        packagePayload.packageFingerprint,
        packagePayload.input.inputFingerprint,
        packagePayload.status,
        current.headHash ?? null,
        headAfter ?? null,
        packagePayload.portfolio.beforeState.fingerprint,
        packagePayload.portfolio.afterState.fingerprint,
      ]);
      if (entry !== undefined) {
        this.database.run(`
          INSERT INTO portfolio_ledger_entries (
            entry_hash, portfolio_id, sequence, run_key, previous_entry_hash, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          entry.entry_hash,
          entry.portfolio_id,
          entry.sequence,
          entry.run_key,
          entry.previous_entry_hash,
          entry.payload_json,
        ]);
      }
      return {
        idempotent: false,
        stateTransitionApplied: packagePayload.status === "executed",
        headBefore: current.headHash,
        headAfter,
      };
    });
    return transaction.immediate();
  }

  verifyDecision(packagePayload: PreForwardDecisionPackage, decisionArtifactId: string): void {
    assertPreForwardDecisionPackage(packagePayload);
    const run = this.getExistingRun(packagePayload.runKey);
    if (run === undefined
      || run.decisionArtifactId !== decisionArtifactId
      || run.packageFingerprint !== packagePayload.packageFingerprint
      || run.inputFingerprint !== packagePayload.input.inputFingerprint
      || run.status !== packagePayload.status
      || run.beforeStateFingerprint !== packagePayload.portfolio.beforeState.fingerprint
      || run.afterStateFingerprint !== packagePayload.portfolio.afterState.fingerprint) {
      throw new Error("Pre-forward run index does not match its Decision Package.");
    }
    const snapshot = this.readPortfolioSnapshot(packagePayload.portfolioId);
    if (packagePayload.status === "blocked") {
      const entry = this.database.query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM portfolio_ledger_entries WHERE run_key = ?",
      ).get(packagePayload.runKey);
      if (run.ledgerHeadBefore !== run.ledgerHeadAfter) {
        throw new Error("Blocked pre-forward run changed the ledger head.");
      }
      if (entry?.count !== 0) throw new Error("Blocked pre-forward run must not contain a ledger transition.");
      return;
    }
    const entry = this.database.query<EntryRow, [string]>(
      "SELECT * FROM portfolio_ledger_entries WHERE run_key = ?",
    ).get(packagePayload.runKey);
    if (entry === null) throw new Error("Executed pre-forward run is missing its ledger transition.");
    const transition = parseTransition(entry.payload_json);
    if (transition.decisionArtifactId !== decisionArtifactId
      || transition.packageFingerprint !== packagePayload.packageFingerprint
      || canonicalJson(transition.beforeState) !== canonicalJson(packagePayload.portfolio.beforeState)
      || canonicalJson(transition.afterState) !== canonicalJson(packagePayload.portfolio.afterState)
      || entry.entry_hash !== run.ledgerHeadAfter
      || (snapshot.sequence > 0 && snapshot.headHash === undefined)) {
      throw new Error("Executed pre-forward ledger transition does not match its Decision Package.");
    }
  }

  /** Test/audit hook: SQLite triggers must reject this mutation. */
  assertAppendOnlyGuards(): void {
    const metadata = this.database.query<{ value: string }, [string]>(
      "SELECT value FROM ledger_metadata WHERE key = ?",
    ).get("schema_version");
    if (metadata?.value !== PRE_FORWARD_LEDGER_SCHEMA_VERSION) throw new Error("Ledger metadata is missing.");
    try {
      this.database.run("UPDATE ledger_metadata SET value = value WHERE key = 'schema_version'");
    } catch (error) {
      if (String(error).includes("append-only")) return;
      throw error;
    }
    throw new Error("Pre-forward append-only trigger did not reject an update.");
  }
}
