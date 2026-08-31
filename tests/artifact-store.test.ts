import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileArtifactStore } from "../src/data/artifact-store.ts";
import { buildVersionedDataArtifact, canonicalJson } from "../src/data/provenance.ts";

function makeArtifact(value = 100) {
  return buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload: [{ code: "1306", tradingDate: "2025-01-31", close: value }],
    source: "fixture-provider",
    dataset: "daily-bars",
    sourceVersion: "fixture-v1",
    adapterVersion: "adapter-v1",
    observedAt: "2025-01-31T15:00:00Z",
    availableAt: "2025-01-31T16:00:00Z",
    retrievedAt: "2025-02-01T00:00:00Z",
    request: { code: "1306", date: "2025-01-31" },
  });
}

async function withStore(run: (store: FileArtifactStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "quant-pilot-artifact-store-"));
  try {
    await run(new FileArtifactStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("puts and reads an asserted artifact using an id-based filename", async () => {
  await withStore(async (store, root) => {
    const artifact = makeArtifact();
    const artifactId = await store.put(artifact);
    assert.equal(artifactId, artifact.provenance.artifactId);
    assert.equal(canonicalJson(await store.read(artifactId)), canonicalJson(artifact));
    assert.deepEqual(await readdir(root), [`${artifactId.slice("sha256:".length)}.json`]);
    assert.deepEqual(await store.listArtifactIds(), [artifactId]);
    if (process.platform !== "win32") {
      assert.equal((await lstat(root)).mode & 0o777, 0o700);
      assert.equal(
        (await lstat(join(root, `${artifactId.slice("sha256:".length)}.json`))).mode & 0o777,
        0o600,
      );
    }
  });
});

test("repeated puts are idempotent and leave no temporary files", async () => {
  await withStore(async (store, root) => {
    const artifact = makeArtifact();
    await store.put(artifact);
    const first = await readFile(join(root, `${artifact.provenance.artifactId.slice("sha256:".length)}.json`), "utf8");
    assert.equal(await store.put(artifact), artifact.provenance.artifactId);
    const second = await readFile(join(root, `${artifact.provenance.artifactId.slice("sha256:".length)}.json`), "utf8");
    assert.equal(second, first);
    assert.deepEqual(await readdir(root), [`${artifact.provenance.artifactId.slice("sha256:".length)}.json`]);
  });
});

test("read and put fail closed on invalid JSON or tampered payload", async () => {
  await withStore(async (store, root) => {
    const artifact = makeArtifact();
    const filePath = join(root, `${artifact.provenance.artifactId.slice("sha256:".length)}.json`);
    await store.put(artifact);
    await writeFile(filePath, "{not-json", "utf8");
    await assert.rejects(() => store.read(artifact.provenance.artifactId), /not valid JSON/);
    await assert.rejects(() => store.put(artifact), /not valid JSON/);

    await writeFile(filePath, canonicalJson({
      ...artifact,
      payload: [{ code: "1306", tradingDate: "2025-01-31", close: 999 }],
    }), "utf8");
    await assert.rejects(() => store.read(artifact.provenance.artifactId), /contentHash/);
    await assert.rejects(() => store.put(artifact), /contentHash/);
  });
});

test("rejects traversal-shaped ids before touching paths", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.read("sha256:../outside"), /canonical SHA-256/);
    await assert.rejects(() => store.read("../outside"), /canonical SHA-256/);
  });
});

test("rejects group- or world-readable roots and artifact files", async () => {
  if (process.platform === "win32") return;
  await withStore(async (store, root) => {
    const artifact = makeArtifact();
    await chmod(root, 0o755);
    await assert.rejects(() => store.put(artifact), /root permissions must be owner-only/);
    await chmod(root, 0o700);
    await store.put(artifact);
    const filePath = join(root, `${artifact.provenance.artifactId.slice("sha256:".length)}.json`);
    await chmod(filePath, 0o644);
    await assert.rejects(() => store.read(artifact.provenance.artifactId), /file permissions must be owner-only/);
  });
});
