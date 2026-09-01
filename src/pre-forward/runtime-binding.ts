import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { canonicalJson, sha256Canonical } from "../data/provenance.ts";
import { compareText } from "../determinism.ts";
import { PRE_FORWARD_MODE, type PreForwardStrategyConfig } from "./config.ts";
import { PreForwardLedger } from "./ledger.ts";
import { resolvePreForwardArtifactRoot } from "./runtime-paths.ts";

export const PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION = "pre-forward-runtime-binding-v3" as const;
export const PRE_FORWARD_RUNTIME_ENROLLMENT_SCHEMA_VERSION = "pre-forward-runtime-enrollment-set-v1" as const;

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
}

interface PreForwardRuntimeEnrollment {
  mode: typeof PRE_FORWARD_MODE;
  portfolioId: string;
  strategy: PreForwardStrategyConfig["strategy"];
  artifactRootPath: string;
  ledgerPath: string;
  bindingFingerprint: string;
  enrollmentFingerprint: string;
}

interface PreForwardRuntimeEnrollmentSet {
  schemaVersion: typeof PRE_FORWARD_RUNTIME_ENROLLMENT_SCHEMA_VERSION;
  mode: typeof PRE_FORWARD_MODE;
  portfolioIds: readonly string[];
  enrollments: readonly PreForwardRuntimeEnrollment[];
  enrollmentSetFingerprint: string;
}

const BINDING_ROOT = {
  kind: "relative",
  path: "data/generated/pre-forward/runtime-bindings",
} as const;
const BINDING_FILE_NAME = "runtime.binding.json";
const ENROLLMENT_ROOT_PARTS = [".quant-pilot", "pre-forward", "runtime-enrollments"] as const;
const ENROLLMENT_FILE_SUFFIX = ".enrollment-set.json";

interface BindingLocations {
  directory: string;
  file: string;
  legacyFile: string;
}

function portfolioRuntimeKey(portfolioId: string): string {
  return sha256Canonical({ mode: PRE_FORWARD_MODE, portfolioId }).slice("sha256:".length);
}

function bindingLocations(bindingRoot: string, portfolioId: string): BindingLocations {
  const key = portfolioRuntimeKey(portfolioId);
  const directory = join(bindingRoot, key);
  return {
    directory,
    file: join(directory, BINDING_FILE_NAME),
    legacyFile: join(bindingRoot, `${key}.binding.json`),
  };
}

function enrollmentSetFile(enrollmentRoot: string, portfolioIds: readonly string[]): string {
  const key = sha256Canonical({
    mode: PRE_FORWARD_MODE,
    portfolioIds: [...portfolioIds].sort(compareText),
  }).slice("sha256:".length);
  return join(enrollmentRoot, `${key}${ENROLLMENT_FILE_SUFFIX}`);
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

function buildEnrollment(binding: PreForwardRuntimeBinding): PreForwardRuntimeEnrollment {
  const body = {
    mode: binding.mode,
    portfolioId: binding.portfolioId,
    strategy: binding.strategy,
    artifactRootPath: binding.artifactRootPath,
    ledgerPath: binding.ledgerPath,
    bindingFingerprint: binding.bindingFingerprint,
  };
  return { ...body, enrollmentFingerprint: sha256Canonical(body) };
}

function buildEnrollmentSet(
  bindings: readonly PreForwardRuntimeBinding[],
): PreForwardRuntimeEnrollmentSet {
  const enrollments = bindings
    .map(buildEnrollment)
    .sort((left, right) => compareText(left.portfolioId, right.portfolioId));
  const body = {
    schemaVersion: PRE_FORWARD_RUNTIME_ENROLLMENT_SCHEMA_VERSION,
    mode: PRE_FORWARD_MODE,
    portfolioIds: enrollments.map((enrollment) => enrollment.portfolioId),
    enrollments,
  };
  return { ...body, enrollmentSetFingerprint: sha256Canonical(body) };
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

function assertEnrollment(value: unknown, expectedPortfolioId: string): PreForwardRuntimeEnrollment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pre-forward runtime enrollment must be an object.");
  }
  const enrollment = value as PreForwardRuntimeEnrollment;
  const keys = Object.keys(enrollment).sort(compareText);
  const expectedKeys = [
    "artifactRootPath",
    "bindingFingerprint",
    "enrollmentFingerprint",
    "ledgerPath",
    "mode",
    "portfolioId",
    "strategy",
  ];
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)
    || enrollment.mode !== PRE_FORWARD_MODE
    || enrollment.portfolioId !== expectedPortfolioId) {
    throw new Error(`Pre-forward runtime enrollment is invalid for ${expectedPortfolioId}.`);
  }
  const binding = assertBinding({
    schemaVersion: PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION,
    mode: enrollment.mode,
    portfolioId: enrollment.portfolioId,
    strategy: enrollment.strategy,
    artifactRootPath: enrollment.artifactRootPath,
    ledgerPath: enrollment.ledgerPath,
    bindingFingerprint: enrollment.bindingFingerprint,
  }, expectedPortfolioId);
  if (canonicalJson(enrollment) !== canonicalJson(buildEnrollment(binding))) {
    throw new Error(`Pre-forward runtime enrollment is invalid for ${expectedPortfolioId}.`);
  }
  return enrollment;
}

function assertEnrollmentSet(
  value: unknown,
  expectedPortfolioIds: readonly string[],
): PreForwardRuntimeEnrollmentSet {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pre-forward runtime enrollment set must be an object.");
  }
  const enrollmentSet = value as PreForwardRuntimeEnrollmentSet;
  const keys = Object.keys(enrollmentSet).sort(compareText);
  const expectedKeys = [
    "enrollmentSetFingerprint",
    "enrollments",
    "mode",
    "portfolioIds",
    "schemaVersion",
  ];
  const sortedExpectedPortfolioIds = [...expectedPortfolioIds].sort(compareText);
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)
    || enrollmentSet.schemaVersion !== PRE_FORWARD_RUNTIME_ENROLLMENT_SCHEMA_VERSION
    || enrollmentSet.mode !== PRE_FORWARD_MODE
    || !Array.isArray(enrollmentSet.portfolioIds)
    || !Array.isArray(enrollmentSet.enrollments)
    || canonicalJson(enrollmentSet.portfolioIds) !== canonicalJson(sortedExpectedPortfolioIds)
    || enrollmentSet.enrollments.length !== sortedExpectedPortfolioIds.length) {
    throw new Error("Pre-forward runtime enrollment set is invalid.");
  }
  const enrollments = enrollmentSet.enrollments.map((enrollment, index) => (
    assertEnrollment(enrollment, sortedExpectedPortfolioIds[index]!)
  ));
  const body = {
    schemaVersion: enrollmentSet.schemaVersion,
    mode: enrollmentSet.mode,
    portfolioIds: enrollmentSet.portfolioIds,
    enrollments,
  };
  if (enrollmentSet.enrollmentSetFingerprint !== sha256Canonical(body)) {
    throw new Error("Pre-forward runtime enrollment set fingerprint is invalid.");
  }
  return enrollmentSet;
}

function assertEnrollmentMatchesBinding(
  enrollment: PreForwardRuntimeEnrollment,
  binding: PreForwardRuntimeBinding,
): void {
  if (canonicalJson(enrollment) !== canonicalJson(buildEnrollment(binding))) {
    throw new Error(
      `Pre-forward runtime enrollment disagrees with the binding for ${binding.portfolioId}; `
        + "recovery requires an explicit audited process.",
    );
  }
}

async function resolveEnrollmentRoot(cwd: string): Promise<string> {
  const repositoryRoot = await realpath(cwd);
  const declared = join(repositoryRoot, ...ENROLLMENT_ROOT_PARTS);
  await mkdir(declared, { recursive: true, mode: 0o700 });
  const physical = await realpath(declared);
  const fromRepository = relative(repositoryRoot, physical);
  if (fromRepository === "" || fromRepository.startsWith("..") || isAbsolute(fromRepository)) {
    throw new Error("Pre-forward runtime enrollment root escaped the repository.");
  }
  const metadata = await lstat(physical);
  if (!metadata.isDirectory()) throw new Error("Pre-forward runtime enrollment root must be a directory.");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("Pre-forward runtime enrollment root must be owner-only (0700).");
  }
  return physical;
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

async function readEnrollmentSet(
  file: string,
  expectedPortfolioIds: readonly string[],
): Promise<PreForwardRuntimeEnrollmentSet> {
  const metadata = await lstat(file);
  if (!metadata.isFile()) throw new Error("Pre-forward runtime enrollment set must be a regular file.");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("Pre-forward runtime enrollment set must be owner-only (0600).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    throw new Error("Pre-forward runtime enrollment set is not valid JSON.", { cause: error });
  }
  return assertEnrollmentSet(parsed, expectedPortfolioIds);
}

async function readOptionalEnrollmentSet(
  enrollmentRoot: string,
  portfolioIds: readonly string[],
): Promise<PreForwardRuntimeEnrollmentSet | undefined> {
  const file = enrollmentSetFile(enrollmentRoot, portfolioIds);
  try {
    return await readEnrollmentSet(file, portfolioIds);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function publishEnrollmentSet(
  enrollmentRoot: string,
  expected: PreForwardRuntimeEnrollmentSet,
): Promise<PreForwardRuntimeEnrollmentSet> {
  const file = enrollmentSetFile(enrollmentRoot, expected.portfolioIds);
  try {
    const stored = await readEnrollmentSet(file, expected.portfolioIds);
    if (canonicalJson(stored) !== canonicalJson(expected)) {
      throw new Error("Pre-forward runtime enrollment set conflicts with existing evidence.");
    }
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporaryDirectory = await mkdtemp(join(enrollmentRoot, ".enrollment-tmp-"));
  const temporaryFile = join(temporaryDirectory, "runtime.enrollment-set.json");
  try {
    await writeFile(temporaryFile, `${canonicalJson(expected)}\n`, { flag: "wx", mode: 0o600 });
    try {
      await link(temporaryFile, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  const stored = await readEnrollmentSet(file, expected.portfolioIds);
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    throw new Error("Pre-forward runtime enrollment set conflicts with existing evidence.");
  }
  return stored;
}

async function createBinding(
  bindingRoot: string,
  expected: PreForwardRuntimeBinding,
): Promise<PreForwardRuntimeBinding> {
  const locations = bindingLocations(bindingRoot, expected.portfolioId);
  let created = false;
  try {
    await mkdir(locations.directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (created) {
    await assertPrivateDirectory(locations.directory, expected.portfolioId);
    await writeFile(locations.file, `${canonicalJson(expected)}\n`, { flag: "wx", mode: 0o600 });
  }
  const stored = await readBinding(locations, expected.portfolioId);
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    throw new Error(`Pre-forward runtime binding conflicts for ${expected.portfolioId}.`);
  }
  return stored;
}

function validateBindingSet(
  strategies: readonly Pick<PreForwardStrategyConfig, "portfolioId" | "strategy">[],
  bindings: ReadonlyMap<string, PreForwardRuntimeBinding>,
  artifactRootPath: string,
): string {
  const ledgerPaths = new Set<string>();
  for (const strategy of strategies) {
    const binding = bindings.get(strategy.portfolioId);
    if (binding === undefined) {
      throw new Error("Pre-forward runtime bindings are incomplete; recovery requires an explicit audited process.");
    }
    if (binding.strategy !== strategy.strategy) {
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

function validateEnrollmentSet(
  strategies: readonly Pick<PreForwardStrategyConfig, "portfolioId" | "strategy">[],
  bindings: ReadonlyMap<string, PreForwardRuntimeBinding>,
  enrollmentSet: PreForwardRuntimeEnrollmentSet,
): void {
  const enrollmentByPortfolio = new Map(
    enrollmentSet.enrollments.map((enrollment) => [enrollment.portfolioId, enrollment]),
  );
  for (const strategy of strategies) {
    const binding = bindings.get(strategy.portfolioId);
    const enrollment = enrollmentByPortfolio.get(strategy.portfolioId);
    if (binding === undefined || enrollment === undefined) {
      throw new Error(
        "Pre-forward runtime enrollment evidence is incomplete; recovery requires an explicit audited process.",
      );
    }
    assertEnrollmentMatchesBinding(enrollment, binding);
  }
}

export async function resolvePreForwardRuntimeBindings(
  cwd: string,
  strategies: readonly Pick<PreForwardStrategyConfig, "portfolioId" | "strategy">[],
  artifactRootPath: string,
  configuredLedgerPath: string,
  operation: "execute" | "replay",
): Promise<PreForwardRuntimeBindingResolution> {
  const sortedStrategies = [...strategies].sort((left, right) => (
    compareText(left.portfolioId, right.portfolioId)
  ));
  const portfolioIds = sortedStrategies.map((strategy) => strategy.portfolioId);
  const uniquePortfolioIds = [...new Set(portfolioIds)].sort(compareText);
  if (uniquePortfolioIds.length !== portfolioIds.length) {
    throw new Error("Pre-forward portfolio IDs must be unique before runtime binding.");
  }
  const bindingRoot = await resolvePreForwardArtifactRoot(BINDING_ROOT, cwd);
  const enrollmentRoot = await resolveEnrollmentRoot(cwd);
  const enrollmentSet = await readOptionalEnrollmentSet(enrollmentRoot, uniquePortfolioIds);
  const discoveredBindings = new Map<string, PreForwardRuntimeBinding>();
  for (const portfolioId of uniquePortfolioIds) {
    const binding = await readOptionalBinding(bindingRoot, portfolioId);
    if (binding !== undefined) discoveredBindings.set(portfolioId, binding);
  }

  if (enrollmentSet !== undefined) {
    if (discoveredBindings.size !== uniquePortfolioIds.length) {
      throw new Error(
        "Pre-forward runtime bindings are missing while durable enrollment evidence exists; "
          + "recovery requires an explicit audited process.",
      );
    }
    const boundLedgerPath = validateBindingSet(
      sortedStrategies,
      discoveredBindings,
      artifactRootPath,
    );
    validateEnrollmentSet(sortedStrategies, discoveredBindings, enrollmentSet);
    return {
      bindings: discoveredBindings,
      boundLedgerPath,
    };
  }
  if (operation === "replay") {
    throw new Error("Pre-forward runtime enrollment is missing; recovery requires an explicit audited process.");
  }

  if (discoveredBindings.size === uniquePortfolioIds.length) {
    const boundLedgerPath = validateBindingSet(
      sortedStrategies,
      discoveredBindings,
      artifactRootPath,
    );
    const ledger = await PreForwardLedger.openExisting(boundLedgerPath);
    ledger.close();
    const publishedEnrollment = await publishEnrollmentSet(
      enrollmentRoot,
      buildEnrollmentSet(sortedStrategies.map((strategy) => discoveredBindings.get(strategy.portfolioId)!)),
    );
    validateEnrollmentSet(sortedStrategies, discoveredBindings, publishedEnrollment);
    return { bindings: discoveredBindings, boundLedgerPath };
  }

  const expectedBindings = new Map(sortedStrategies.map((strategy) => {
    const binding = buildBinding(
      strategy.portfolioId,
      strategy.strategy,
      artifactRootPath,
      configuredLedgerPath,
    );
    return [strategy.portfolioId, binding] as const;
  }));
  for (const [portfolioId, binding] of discoveredBindings) {
    if (canonicalJson(binding) !== canonicalJson(expectedBindings.get(portfolioId)!)) {
      throw new Error(
        `Incomplete Pre-Forward runtime initialization conflicts for ${portfolioId}; `
          + "recovery requires an explicit audited process.",
      );
    }
  }

  const ledger = await PreForwardLedger.open(configuredLedgerPath);
  try {
    if (sortedStrategies.some((strategy) => ledger.listExistingRuns(strategy.portfolioId).length > 0)) {
      throw new Error(
        "Pre-forward runtime bindings are incomplete for a ledger with committed runs; "
          + "recovery requires an explicit audited process.",
      );
    }
  } finally {
    ledger.close();
  }

  const completedBindings = new Map(discoveredBindings);
  for (const strategy of sortedStrategies) {
    const expected = expectedBindings.get(strategy.portfolioId)!;
    const binding = await createBinding(bindingRoot, expected);
    completedBindings.set(strategy.portfolioId, binding);
  }
  const boundLedgerPath = validateBindingSet(sortedStrategies, completedBindings, artifactRootPath);
  const publishedEnrollment = await publishEnrollmentSet(
    enrollmentRoot,
    buildEnrollmentSet(sortedStrategies.map((strategy) => completedBindings.get(strategy.portfolioId)!)),
  );
  validateEnrollmentSet(sortedStrategies, completedBindings, publishedEnrollment);
  return {
    bindings: completedBindings,
    boundLedgerPath,
  };
}
