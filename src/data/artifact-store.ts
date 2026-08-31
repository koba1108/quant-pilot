import { link, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  assertVersionedDataArtifact,
  canonicalJson,
  type VersionedDataArtifact,
} from "./provenance.ts";

const ARTIFACT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_FILE_SUFFIX = ".json";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function hasGroupOrOtherPermissions(mode: number): boolean {
  return process.platform !== "win32" && (mode & 0o077) !== 0;
}

function assertArtifactId(artifactId: string): void {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new Error("artifactId must be a canonical SHA-256 identifier.");
  }
}

function assertPathInsideRoot(root: string, candidate: string): void {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const pathFromRoot = relative(rootPath, candidatePath);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Artifact path must remain inside the configured store root.");
  }
}

function artifactFileName(artifactId: string): string {
  assertArtifactId(artifactId);
  return `${artifactId.slice("sha256:".length)}${ARTIFACT_FILE_SUFFIX}`;
}

function parseArtifact<T>(serialized: string, filePath: string): VersionedDataArtifact<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Artifact file is not valid JSON: ${filePath}.`, { cause: error });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Artifact file must contain an object: ${filePath}.`);
  }
  const artifact = parsed as VersionedDataArtifact<T>;
  assertVersionedDataArtifact(artifact);
  return artifact;
}

async function readStoredArtifact<T>(filePath: string): Promise<VersionedDataArtifact<T>> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile()) {
    throw new Error(`Artifact path must be a regular file: ${filePath}.`);
  }
  if (hasGroupOrOtherPermissions(metadata.mode)) {
    throw new Error(`Artifact file permissions must be owner-only (0600): ${filePath}.`);
  }
  return parseArtifact<T>(await readFile(filePath, "utf8"), filePath);
}

/**
 * A small filesystem-backed store for immutable, content-addressed artifacts.
 * Artifacts are addressed by validated content-derived ids. The read-only
 * listing API exists solely for deterministic integrity/index scans; deletion
 * remains outside this boundary.
 */
export class FileArtifactStore {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new Error("Artifact store root must be a non-empty path.");
    }
    this.root = resolve(root);
  }

  private filePath(artifactId: string): string {
    const path = join(this.root, artifactFileName(artifactId));
    assertPathInsideRoot(this.root, path);
    return path;
  }

  private async assertPrivateRoot(): Promise<void> {
    const metadata = await lstat(this.root);
    if (!metadata.isDirectory()) {
      throw new Error(`Artifact store root must be a physical directory: ${this.root}.`);
    }
    if (hasGroupOrOtherPermissions(metadata.mode)) {
      throw new Error(`Artifact store root permissions must be owner-only (0700): ${this.root}.`);
    }
  }

  private async ensurePrivateRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    await this.assertPrivateRoot();
  }

  /** Validate or create the private root before any upstream data is fetched. */
  async prepare(): Promise<void> {
    await this.ensurePrivateRoot();
  }

  async put<T>(artifact: VersionedDataArtifact<T>): Promise<string> {
    assertVersionedDataArtifact(artifact);
    const artifactId = artifact.provenance.artifactId;
    const filePath = this.filePath(artifactId);
    const serialized = canonicalJson(artifact);

    await this.prepare();

    try {
      const existingArtifact = await readStoredArtifact<T>(filePath);
      if (canonicalJson(existingArtifact) !== serialized) {
        throw new Error(`Artifact id already exists with different content: ${artifactId}.`);
      }
      return artifactId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporaryDirectory = await mkdtemp(join(this.root, ".artifact-tmp-"));
    const temporaryPath = join(temporaryDirectory, artifactFileName(artifactId));
    try {
      await writeFile(temporaryPath, `${serialized}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: PRIVATE_FILE_MODE,
      });
      // Hard-linking a temporary file into place is an atomic no-clobber
      // operation on the same filesystem. Unlike rename(), it cannot silently
      // replace an artifact created by a concurrent writer.
      try {
        await link(temporaryPath, filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existingArtifact = await readStoredArtifact<T>(filePath);
        if (canonicalJson(existingArtifact) !== serialized) {
          throw new Error(`Artifact id already exists with different content: ${artifactId}.`);
        }
      }
      return artifactId;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async read<T>(artifactId: string): Promise<VersionedDataArtifact<T>> {
    await this.assertPrivateRoot();
    const filePath = this.filePath(artifactId);
    const artifact = await readStoredArtifact<T>(filePath);
    if (artifact.provenance.artifactId !== artifactId) {
      throw new Error(`Artifact file does not match requested artifactId: ${artifactId}.`);
    }
    return artifact;
  }

  async listArtifactIds(): Promise<readonly string[]> {
    await this.assertPrivateRoot();
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^[0-9a-f]{64}\.json$/.test(entry.name))
      .map((entry) => `sha256:${entry.name.slice(0, -ARTIFACT_FILE_SUFFIX.length)}`)
      .sort();
  }
}
