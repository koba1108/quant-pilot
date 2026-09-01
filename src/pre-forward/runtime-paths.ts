import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PreForwardPath } from "./config.ts";

const SAFE_REPOSITORY_ROOTS = ["data/raw/", "data/cache/", "data/generated/", "reports/generated/"];

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function safeRepositoryRuntimePath(repositoryRoot: string, candidate: string): boolean {
  const normalized = relative(repositoryRoot, candidate).replaceAll("\\", "/");
  return SAFE_REPOSITORY_ROOTS.some((prefix) => normalized.startsWith(prefix));
}

export async function resolvePreForwardArtifactRoot(spec: PreForwardPath, cwd: string): Promise<string> {
  const repositoryRoot = await realpath(cwd);
  const declared = spec.kind === "relative" ? resolve(repositoryRoot, spec.path) : resolve(spec.path);
  if (spec.kind === "relative" && (!isInside(repositoryRoot, declared)
    || !safeRepositoryRuntimePath(repositoryRoot, declared))) {
    throw new Error("Relative pre-forward artifactRoot escaped its ignored runtime-data boundary.");
  }
  await mkdir(declared, { recursive: true, mode: 0o700 });
  const physical = await realpath(declared);
  if (spec.kind === "relative" && (!isInside(repositoryRoot, physical)
    || !safeRepositoryRuntimePath(repositoryRoot, physical))) {
    throw new Error("Pre-forward artifactRoot resolves outside its ignored runtime-data boundary.");
  }
  return physical;
}

export async function resolvePreForwardLedgerPath(spec: PreForwardPath, cwd: string): Promise<string> {
  const repositoryRoot = await realpath(cwd);
  const declared = spec.kind === "relative" ? resolve(repositoryRoot, spec.path) : resolve(spec.path);
  if (spec.kind === "relative" && (!isInside(repositoryRoot, declared)
    || !safeRepositoryRuntimePath(repositoryRoot, declared))) {
    throw new Error("Relative pre-forward ledgerPath escaped its ignored runtime-data boundary.");
  }
  const declaredParent = dirname(declared);
  await mkdir(declaredParent, { recursive: true, mode: 0o700 });
  const physicalParent = await realpath(declaredParent);
  if (spec.kind === "relative" && (!isInside(repositoryRoot, physicalParent)
    || !safeRepositoryRuntimePath(repositoryRoot, physicalParent))) {
    throw new Error("Pre-forward ledgerPath resolves outside its ignored runtime-data boundary.");
  }
  const parentMetadata = await lstat(physicalParent);
  if (!parentMetadata.isDirectory()) throw new Error("Pre-forward ledger parent must be a directory.");
  if (process.platform !== "win32" && (parentMetadata.mode & 0o077) !== 0) {
    throw new Error("Pre-forward ledger parent permissions must be owner-only (0700).");
  }
  const physical = join(physicalParent, basename(declared));
  try {
    const metadata = await lstat(physical);
    if (!metadata.isFile()) throw new Error("Pre-forward ledgerPath must be a regular file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return physical;
}

export async function resolveRepositoryInputFile(path: string, cwd: string): Promise<string> {
  const repositoryRoot = await realpath(cwd);
  const declared = resolve(repositoryRoot, path);
  if (!isInside(repositoryRoot, declared)) throw new Error("Pre-forward input file escaped the repository root.");
  const physical = await realpath(declared);
  if (!isInside(repositoryRoot, physical)) throw new Error("Pre-forward input file resolves outside the repository root.");
  const metadata = await lstat(physical);
  if (!metadata.isFile()) throw new Error("Pre-forward input path must be a regular file.");
  return physical;
}

export async function resolvePreForwardRepositoryRoot(configFilePath: string): Promise<string> {
  const physicalConfigPath = await realpath(configFilePath);
  let candidate = dirname(physicalConfigPath);
  while (true) {
    try {
      const gitMetadata = await lstat(join(candidate, ".git"));
      if (gitMetadata.isDirectory() || gitMetadata.isFile()) return realpath(candidate);
      throw new Error("Pre-forward repository .git marker must be a file or directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return dirname(physicalConfigPath);
    candidate = parent;
  }
}
