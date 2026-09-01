import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonicalJson, sha256Canonical } from "../data/provenance.ts";
import { compareText } from "../determinism.ts";
import { PRE_FORWARD_MODE, type PreForwardStrategyConfig } from "./config.ts";
import { resolvePreForwardArtifactRoot } from "./runtime-paths.ts";

export const PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION = "pre-forward-runtime-binding-v3" as const;

export interface PreForwardRuntimeBinding {
  schemaVersion: typeof PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION;
  mode: typeof PRE_FORWARD_MODE;
  portfolioId: string;
  strategy: PreForwardStrategyConfig["strategy"];
  artifactRootPath: string;
  ledgerPath: string;
  bindingFingerprint: string;
}

export interface PreForwardRuntimeBindingResolution {
  bindings: ReadonlyMap<string, PreForwardRuntimeBinding>;
  boundLedgerPath: string;
  freshInitialization: boolean;
}

const BINDING_ROOT = {
  kind: "relative",
  path: "data/generated/pre-forward/runtime-bindings",
} as const;
const BINDING_FILE_NAME = "runtime.binding.json";

interface BindingLocations {
  directory: string;
  file: string;
  legacyFile: string;
}

function bindingLocations(bindingRoot: string, portfolioId: string): BindingLocations {
  const key = sha256Canonical({ mode: PRE_FORWARD_MODE, portfolioId }).slice("sha256:".length);
  const directory = join(bindingRoot, key);
  return {
    directory,
    file: join(directory, BINDING_FILE_NAME),
    legacyFile: join(bindingRoot, `${key}.binding.json`),
  };
}

function buildBinding(
  portfolioId: string,
  strategy: PreForwardStrategyConfig["strategy"],
  artifactRootPath: string,
  ledgerPath: string,
): PreForwardRuntimeBinding {
  const body = {
    schemaVersion: PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION,
    mode: PRE_FORWARD_MODE,
    portfolioId,
    strategy,
    artifactRootPath,
    ledgerPath,
  };
  return { ...body, bindingFingerprint: sha256Canonical(body) };
}

function assertBinding(value: unknown, expectedPortfolioId: string): PreForwardRuntimeBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pre-forward runtime binding must be an object.");
  }
  const binding = value as PreForwardRuntimeBinding;
  const keys = Object.keys(binding).sort(compareText);
  const expectedKeys = [
    "artifactRootPath",
    "bindingFingerprint",
    "ledgerPath",
    "mode",
    "portfolioId",
    "schemaVersion",
    "strategy",
  ];
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)
    || binding.schemaVersion !== PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION
    || binding.mode !== PRE_FORWARD_MODE
    || binding.portfolioId !== expectedPortfolioId
    || (binding.strategy !== "trend" && binding.strategy !== "rotation")
    || typeof binding.artifactRootPath !== "string"
    || binding.artifactRootPath === ""
    || !isAbsolute(binding.artifactRootPath)
    || typeof binding.ledgerPath !== "string"
    || binding.ledgerPath === ""
    || !isAbsolute(binding.ledgerPath)
    || binding.bindingFingerprint !== buildBinding(
      binding.portfolioId,
      binding.strategy,
      binding.artifactRootPath,
      binding.ledgerPath,
    ).bindingFingerprint) {
    throw new Error(`Pre-forward runtime binding is invalid for ${expectedPortfolioId}.`);
  }
  return binding;
}

async function assertPrivateDirectory(path: string, portfolioId: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory()) {
    throw new Error(`Pre-forward runtime binding directory is invalid for ${portfolioId}.`);
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Pre-forward runtime binding directory must be owner-only for ${portfolioId}.`);
  }
}

async function assertLegacyBindingAbsent(locations: BindingLocations, portfolioId: string): Promise<void> {
  try {
    await lstat(locations.legacyFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Legacy Pre-Forward runtime binding for ${portfolioId} requires an explicit audited migration.`,
  );
}

async function readBinding(locations: BindingLocations, portfolioId: string): Promise<PreForwardRuntimeBinding> {
  await assertPrivateDirectory(locations.directory, portfolioId);
  let metadata;
  try {
    metadata = await lstat(locations.file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Pre-forward runtime binding is missing for ${portfolioId}; recovery requires an explicit audited process.`,
        { cause: error },
      );
    }
    throw error;
  }
  if (!metadata.isFile()) throw new Error(`Pre-forward runtime binding must be a regular file for ${portfolioId}.`);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Pre-forward runtime binding must be owner-only for ${portfolioId}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(locations.file, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Pre-forward runtime binding is not valid JSON for ${portfolioId}.`, { cause: error });
  }
  return assertBinding(parsed, portfolioId);
}

async function readOptionalBinding(
  bindingRoot: string,
  portfolioId: string,
): Promise<PreForwardRuntimeBinding | undefined> {
  const locations = bindingLocations(bindingRoot, portfolioId);
  await assertLegacyBindingAbsent(locations, portfolioId);
  try {
    await lstat(locations.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return readBinding(locations, portfolioId);
}

async function createBinding(
  bindingRoot: string,
  expected: PreForwardRuntimeBinding,
): Promise<{ binding: PreForwardRuntimeBinding; created: boolean }> {
  const locations = bindingLocations(bindingRoot, expected.portfolioId);
  let created = false;
  try {
    await mkdir(locations.directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (!created) return { binding: await readBinding(locations, expected.portfolioId), created: false };
  await assertPrivateDirectory(locations.directory, expected.portfolioId);
  await writeFile(locations.file, `${canonicalJson(expected)}\n`, { flag: "wx", mode: 0o600 });
  const stored = await readBinding(locations, expected.portfolioId);
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    throw new Error(`Pre-forward runtime binding write was not deterministic for ${expected.portfolioId}.`);
  }
  return { binding: stored, created: true };
}

function validateBindingSet(
  strategies: readonly Pick<PreForwardStrategyConfig, "portfolioId" | "strategy">[],
  bindings: ReadonlyMap<string, PreForwardRuntimeBinding>,
  artifactRootPath: string,
  enforceStrategyIdentity: boolean,
): string {
  const ledgerPaths = new Set<string>();
  for (const strategy of strategies) {
    const binding = bindings.get(strategy.portfolioId);
    if (binding === undefined) {
      throw new Error("Pre-forward runtime bindings are incomplete; recovery requires an explicit audited process.");
    }
    if (enforceStrategyIdentity && binding.strategy !== strategy.strategy) {
      throw new Error(
        `Pre-forward strategy reassignment for ${strategy.portfolioId} requires an explicit audited amendment.`,
      );
    }
    if (binding.artifactRootPath !== artifactRootPath) {
      throw new Error(
        `Pre-forward artifactRoot relocation for ${strategy.portfolioId} requires an explicit audited migration.`,
      );
    }
    ledgerPaths.add(binding.ledgerPath);
  }
  if (ledgerPaths.size !== 1) {
    throw new Error("Pre-forward portfolio runtime bindings disagree on the physical ledger path.");
  }
  return [...ledgerPaths][0]!;
}

export async function resolvePreForwardRuntimeBindings(
  cwd: string,
  strategies: readonly Pick<PreForwardStrategyConfig, "portfolioId" | "strategy">[],
  artifactRootPath: string,
  configuredLedgerPath: string,
  operation: "execute" | "replay",
): Promise<PreForwardRuntimeBindingResolution> {
  const enforceStrategyIdentity = operation === "execute";
  const sortedStrategies = [...strategies].sort((left, right) => (
    compareText(left.portfolioId, right.portfolioId)
  ));
  const portfolioIds = sortedStrategies.map((strategy) => strategy.portfolioId);
  const uniquePortfolioIds = [...new Set(portfolioIds)].sort(compareText);
  if (uniquePortfolioIds.length !== portfolioIds.length) {
    throw new Error("Pre-forward portfolio IDs must be unique before runtime binding.");
  }
  const bindingRoot = await resolvePreForwardArtifactRoot(BINDING_ROOT, cwd);
  const discovered = new Map<string, PreForwardRuntimeBinding>();
  for (const portfolioId of uniquePortfolioIds) {
    const binding = await readOptionalBinding(bindingRoot, portfolioId);
    if (binding !== undefined) discovered.set(portfolioId, binding);
  }

  if (discovered.size > 0 && discovered.size !== uniquePortfolioIds.length) {
    throw new Error("Pre-forward runtime bindings are incomplete; recovery requires an explicit audited process.");
  }
  if (discovered.size === uniquePortfolioIds.length) {
    return {
      bindings: discovered,
      boundLedgerPath: validateBindingSet(
        sortedStrategies,
        discovered,
        artifactRootPath,
        enforceStrategyIdentity,
      ),
      freshInitialization: false,
    };
  }
  if (operation === "replay") {
    throw new Error("Pre-forward runtime binding is missing; recovery requires an explicit audited process.");
  }

  const createdBindings = new Map<string, PreForwardRuntimeBinding>();
  for (const strategy of sortedStrategies) {
    const expected = buildBinding(
      strategy.portfolioId,
      strategy.strategy,
      artifactRootPath,
      configuredLedgerPath,
    );
    const result = await createBinding(bindingRoot, expected);
    createdBindings.set(strategy.portfolioId, result.binding);
    if (!result.created) {
      for (const remainingStrategy of sortedStrategies.slice(createdBindings.size)) {
        const binding = await readOptionalBinding(bindingRoot, remainingStrategy.portfolioId);
        if (binding !== undefined) createdBindings.set(remainingStrategy.portfolioId, binding);
      }
      return {
        bindings: createdBindings,
        boundLedgerPath: validateBindingSet(
          sortedStrategies,
          createdBindings,
          artifactRootPath,
          enforceStrategyIdentity,
        ),
        freshInitialization: false,
      };
    }
  }
  return {
    bindings: createdBindings,
    boundLedgerPath: validateBindingSet(
      sortedStrategies,
      createdBindings,
      artifactRootPath,
      enforceStrategyIdentity,
    ),
    freshInitialization: true,
  };
}
