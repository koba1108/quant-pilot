import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256Canonical } from "../data/provenance.ts";
import { compareText } from "../determinism.ts";
import { PRE_FORWARD_MODE } from "./config.ts";
import { resolvePreForwardArtifactRoot } from "./runtime-paths.ts";

export const PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION = "pre-forward-runtime-binding-v1" as const;

interface PreForwardRuntimeBinding {
  schemaVersion: typeof PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION;
  mode: typeof PRE_FORWARD_MODE;
  portfolioId: string;
  artifactRootPath: string;
  bindingFingerprint: string;
}

const BINDING_ROOT = {
  kind: "relative",
  path: "data/generated/pre-forward/runtime-bindings",
} as const;

function buildBinding(portfolioId: string, artifactRootPath: string): PreForwardRuntimeBinding {
  const body = {
    schemaVersion: PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION,
    mode: PRE_FORWARD_MODE,
    portfolioId,
    artifactRootPath,
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
    "mode",
    "portfolioId",
    "schemaVersion",
  ];
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)
    || binding.schemaVersion !== PRE_FORWARD_RUNTIME_BINDING_SCHEMA_VERSION
    || binding.mode !== PRE_FORWARD_MODE
    || binding.portfolioId !== expectedPortfolioId
    || typeof binding.artifactRootPath !== "string"
    || binding.artifactRootPath === ""
    || binding.bindingFingerprint !== buildBinding(
      binding.portfolioId,
      binding.artifactRootPath,
    ).bindingFingerprint) {
    throw new Error(`Pre-forward runtime binding is invalid for ${expectedPortfolioId}.`);
  }
  return binding;
}

async function readBinding(path: string, portfolioId: string): Promise<PreForwardRuntimeBinding> {
  const metadata = await lstat(path);
  if (!metadata.isFile()) throw new Error(`Pre-forward runtime binding must be a regular file for ${portfolioId}.`);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Pre-forward runtime binding must be owner-only for ${portfolioId}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Pre-forward runtime binding is not valid JSON for ${portfolioId}.`, { cause: error });
  }
  return assertBinding(parsed, portfolioId);
}

async function assertOrCreateBinding(
  bindingRoot: string,
  portfolioId: string,
  artifactRootPath: string,
): Promise<void> {
  const key = sha256Canonical({ mode: PRE_FORWARD_MODE, portfolioId }).slice("sha256:".length);
  const path = join(bindingRoot, `${key}.binding.json`);
  const expected = buildBinding(portfolioId, artifactRootPath);
  try {
    const existing = await readBinding(path, portfolioId);
    if (canonicalJson(existing) !== canonicalJson(expected)) {
      throw new Error(
        `Pre-forward artifactRoot relocation for ${portfolioId} requires an explicit audited migration.`,
      );
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await writeFile(path, `${canonicalJson(expected)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stored = await readBinding(path, portfolioId);
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    throw new Error(
      `Pre-forward artifactRoot relocation for ${portfolioId} requires an explicit audited migration.`,
    );
  }
}

export async function assertPreForwardArtifactRootBindings(
  cwd: string,
  portfolioIds: readonly string[],
  artifactRootPath: string,
): Promise<void> {
  const uniquePortfolioIds = [...new Set(portfolioIds)].sort(compareText);
  if (uniquePortfolioIds.length !== portfolioIds.length) {
    throw new Error("Pre-forward portfolio IDs must be unique before runtime binding.");
  }
  const bindingRoot = await resolvePreForwardArtifactRoot(BINDING_ROOT, cwd);
  for (const portfolioId of uniquePortfolioIds) {
    await assertOrCreateBinding(bindingRoot, portfolioId, artifactRootPath);
  }
}
