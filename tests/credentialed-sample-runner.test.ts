import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertCredentialedSampleAuditPayload,
  captureCredentialedSample,
  credentialedSampleExitCode,
  replayCredentialedSample,
} from "../src/data/credentialed-sample-runner.ts";
import { FileArtifactStore } from "../src/data/artifact-store.ts";
import {
  buildVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../src/data/provenance.ts";
import {
  reconcileComparableObservations,
  type ComparableObservation,
  type ComparableObservationEvidence,
} from "../src/data/reconciliation.ts";
import { validateCredentialedSampleConfig } from "../src/data/credentialed-sample-config.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const fixtureConfigPath = join(repositoryRoot, "research/provider-samples/fixture.config.json");

type MutableConfig = Record<string, any>;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<MutableConfig> {
  return JSON.parse(await readFile(path, "utf8")) as MutableConfig;
}

async function writeConfig(
  temporaryRoot: string,
  mode: "fixture" | "live" = "fixture",
): Promise<{ configPath: string; artifactRoot: string; config: MutableConfig }> {
  const config = await readJson(fixtureConfigPath);
  config.mode = mode;
  config.artifactRoot = { kind: "absolute", path: join(temporaryRoot, "artifacts") };
  if (mode === "live") {
    for (const provider of config.providers as MutableConfig[]) delete provider.fixtureFile;
    config.credentialUseAuthorized = true;
    config.costAuthorized = true;
    config.rawRetentionAuthorized = true;
    config.licenseRetentionConfirmed = true;
  }
  const configPath = join(temporaryRoot, `${mode}.config.json`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { configPath, artifactRoot: config.artifactRoot.path, config };
}

async function withTemporaryConfig<T>(
  run: (setup: { configPath: string; artifactRoot: string; config: MutableConfig; temporaryRoot: string }) => Promise<T>,
  mode: "fixture" | "live" = "fixture",
): Promise<T> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "quant-pilot-credentialed-sample-"));
  try {
    return await run({ ...(await writeConfig(temporaryRoot, mode)), temporaryRoot });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function artifactPath(artifactRoot: string, artifactId: string): string {
  return join(artifactRoot, `${artifactId.slice("sha256:".length)}.json`);
}

test("fixture capture builds artifacts and replay reproduces the canonical audit", async () => {
  await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
    const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    assertCredentialedSampleAuditPayload(captured.payload);
    assert.equal(captured.payload.mode, "fixture");
    assert.equal(captured.payload.instrumentIds.length, 5);
    assert.equal(captured.payload.artifacts.rawResponseIds.length, 10);
    assert.equal(captured.payload.artifacts.dailyBarsIds.length, 10);
    assert.equal(captured.payload.artifacts.observationIds.length, 105);
    assert.equal(captured.payload.reconciliation.mode, "advisory");
    assert.equal(captured.payload.reconciliation.status, "advisory");

    const replayed = await replayCredentialedSample(configPath, captured.provenance.artifactId, {
      cwd: repositoryRoot,
    });
    assert.equal(canonicalJson(replayed), canonicalJson(captured));
    assert.equal((await readdir(artifactRoot)).length, 126);
  });
});

test("repeated fixture capture is idempotent and does not change retained artifacts", async () => {
  await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
    const first = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    const firstFiles = (await readdir(artifactRoot)).sort();
    const firstBytes = await Promise.all(firstFiles.map((file) => readFile(join(artifactRoot, file), "utf8")));
    const second = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    const secondFiles = (await readdir(artifactRoot)).sort();
    const secondBytes = await Promise.all(secondFiles.map((file) => readFile(join(artifactRoot, file), "utf8")));
    assert.equal(canonicalJson(second), canonicalJson(first));
    assert.deepEqual(secondFiles, firstFiles);
    assert.deepEqual(secondBytes, firstBytes);
  });
});

test("replay rejects tampered raw, daily-bars, and reconciliation-observation artifacts", async () => {
  for (const target of ["raw", "daily", "observation"] as const) {
    await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
      const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
      const id = target === "raw"
        ? captured.payload.artifacts.rawResponseIds[0]!
        : target === "daily"
          ? captured.payload.artifacts.dailyBarsIds[0]!
          : captured.payload.artifacts.observationIds[0]!;
      const path = artifactPath(artifactRoot, id);
      const artifact = await readJson(path);
      if (target === "raw") {
        artifact.payload.response.bodyBase64 = Buffer.from("tampered raw body").toString("base64");
      } else if (target === "daily") {
        artifact.payload.bars[0].close += 1;
      } else {
        artifact.payload.value += 1;
      }
      await writeFile(path, `${JSON.stringify(artifact)}\n`, "utf8");
      await assert.rejects(
        () => replayCredentialedSample(configPath, captured.provenance.artifactId, { cwd: repositoryRoot }),
        /contentHash/,
      );
    });
  }
});

test("replay derives the reconciliation cutoff from evidence instead of trusting the audit", async () => {
  await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
    const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    const store = new FileArtifactStore(artifactRoot);
    const observations = await Promise.all(captured.payload.artifacts.observationIds.map(async (id) => {
      const artifact = await store.read<ComparableObservationEvidence>(id);
      return { ...artifact.payload, artifact } satisfies ComparableObservation;
    }));
    const forgedDecisionDate = "2025-01-08T00:00:00Z";
    const forgedReconciliation = reconcileComparableObservations(
      observations,
      forgedDecisionDate,
      captured.payload.reconciliation.policy,
    );
    assert.equal(forgedReconciliation.groups.length, 0, "probe must exclude all later-available observations");
    const payloadWithoutFingerprint = {
      ...structuredClone(captured.payload),
      reconciliation: forgedReconciliation,
    };
    const { fingerprint: _discarded, ...forgedBody } = payloadWithoutFingerprint;
    const forgedPayload = {
      ...forgedBody,
      fingerprint: sha256Canonical(forgedBody),
    };
    const forgedAudit: VersionedDataArtifact<typeof captured.payload> = buildVersionedDataArtifact({
      artifactKind: "provider_capability_evidence",
      payload: forgedPayload,
      source: "quant-pilot",
      dataset: "credentialed-sample-audit",
      sourceVersion: forgedPayload.schemaVersion,
      adapterVersion: forgedPayload.runnerVersion,
      observedAt: `${forgedPayload.range.end}T00:00:00Z`,
      availableAt: forgedDecisionDate,
      retrievedAt: forgedDecisionDate,
      request: {
        sampleDefinitionFingerprint: forgedPayload.sampleDefinitionFingerprint,
        artifacts: forgedPayload.artifacts,
      },
      recordId: forgedPayload.sampleDefinitionFingerprint,
    });
    await store.put(forgedAudit);

    await assert.rejects(
      () => replayCredentialedSample(configPath, forgedAudit.provenance.artifactId, { cwd: repositoryRoot }),
      /decisionDate does not match the latest evidence availability/,
    );
  });
});

test("replay manifest retains complete raw lineage and explicit non-TR availability labels", async () => {
  await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
    const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    const rawIds = new Set(captured.payload.artifacts.rawResponseIds);
    const dailyIds = new Set(captured.payload.artifacts.dailyBarsIds);
    for (const id of captured.payload.artifacts.dailyBarsIds) {
      const artifact = await readJson(artifactPath(artifactRoot, id));
      assert.ok(artifact.payload.rawArtifactIds.length > 0);
      for (const rawId of artifact.payload.rawArtifactIds) assert.ok(rawIds.has(rawId));
      assert.equal(artifact.payload.returnClassification.adjustedClose, "provider_adjusted_not_total_return");
      assert.equal(artifact.payload.availabilityBasis, "artifact_retrieved_at_not_source_native_row_availability");
    }
    for (const id of captured.payload.artifacts.observationIds) {
      const artifact = await readJson(artifactPath(artifactRoot, id));
      assert.ok(dailyIds.has(artifact.payload.parentArtifactId));
      assert.equal(artifact.payload.parentProvenance.artifactId, artifact.payload.parentArtifactId);
    }
    assert.equal(captured.payload.availabilityModel, "retrieval_time_only_not_source_native_row_availability");
    assert.ok(captured.payload.missingCapabilities.includes("source_native_row_available_at"));
    assert.ok(captured.payload.missingCapabilities.includes("etf_distributions_and_corporate_actions"));
  });
});

test("missing trading value remains insufficient_sources rather than being filled", async () => {
  await withTemporaryConfig(async ({ configPath }) => {
    const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    const tradingValueGroups = captured.payload.reconciliation.groups.filter((group) => group.key.field === "tradingValue");
    assert.equal(tradingValueGroups.length, 15);
    assert.ok(tradingValueGroups.every((group) => group.status === "insufficient_sources"));
    assert.ok(captured.payload.reconciliation.issues.some((issue) => issue.checkId === "reconciliation.insufficient_sources"));
  });
});

test("duplicate independence groups are rejected before creating an artifact directory", async () => {
  await withTemporaryConfig(async ({ configPath, artifactRoot, config }) => {
    config.providers[1].independenceGroup = config.providers[0].independenceGroup;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => captureCredentialedSample(configPath, { cwd: repositoryRoot }),
      /providers\.independenceGroup contains duplicates/,
    );
    assert.equal(await pathExists(artifactRoot), false);
  });
});

test("all four live runtime authorization gates run before fetch or artifact-directory creation", async () => {
  for (const gate of ["credentialUse", "cost", "rawRetention", "licenseRetention"] as const) {
    await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
      const authorization = {
        credentialUse: true,
        cost: true,
        rawRetention: true,
        licenseRetention: true,
        [gate]: false,
      };
      let fetchCalled = false;
      await assert.rejects(
        () => captureCredentialedSample(configPath, {
          cwd: repositoryRoot,
          liveAuthorization: authorization,
          fetchImpl: (async () => {
            fetchCalled = true;
            throw new Error("fetch must not run");
          }) as unknown as typeof fetch,
        }),
        /Live capture requires --authorize|Live capture requires --confirm-license-retention/,
      );
      assert.equal(fetchCalled, false);
      assert.equal(await pathExists(artifactRoot), false);
    }, "live");
  }
});

test("live capture reports a missing credential without contacting a provider", async () => {
  await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
    let fetchCalled = false;
    await assert.rejects(
      () => captureCredentialedSample(configPath, {
        cwd: repositoryRoot,
        env: {},
        liveAuthorization: {
          credentialUse: true,
          cost: true,
          rawRetention: true,
          licenseRetention: true,
        },
        fetchImpl: (async () => {
          fetchCalled = true;
          throw new Error("fetch must not run");
        }) as unknown as typeof fetch,
      }),
      /Required credential environment variable is missing:/,
    );
    assert.equal(fetchCalled, false);
    assert.equal(await pathExists(artifactRoot), false);
  }, "live");
});

test("live capture rejects an unsafe artifact root before contacting a provider", async () => {
  if (process.platform === "win32") return;
  await withTemporaryConfig(async ({ configPath, artifactRoot }) => {
    await mkdir(artifactRoot, { recursive: true });
    await chmod(artifactRoot, 0o755);
    let fetchCalled = false;
    await assert.rejects(
      () => captureCredentialedSample(configPath, {
        cwd: repositoryRoot,
        env: {
          JQUANTS_API_KEY: "authorized-jquants-token",
          EODHD_API_TOKEN: "authorized-eodhd-token",
        },
        liveAuthorization: {
          credentialUse: true,
          cost: true,
          rawRetention: true,
          licenseRetention: true,
        },
        fetchImpl: (async () => {
          fetchCalled = true;
          throw new Error("fetch must not run");
        }) as unknown as typeof fetch,
      }),
      /root permissions must be owner-only/,
    );
    assert.equal(fetchCalled, false);
  }, "live");
});

test("public capture boundary remains research-only and CLI require flags fail closed", async () => {
  await withTemporaryConfig(async ({ configPath }) => {
    const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    assert.equal(captured.payload.disposition, "research_only");
    assert.equal(captured.payload.productionSelection, "not_selected");
    assert.equal(captured.payload.canEnableEtfRealistic, false);

    for (const flag of ["--require-live-evidence", "--require-production"]) {
      const result = spawnSync(
        process.execPath,
        ["run", "src/data/credentialed-sample-runner.ts", `--config=${configPath}`, flag],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1, `${flag}: ${result.stderr}`);
    }
  });
});

test("audit validation rejects a refingerprinted report that weakens live-evidence boundaries", async () => {
  await withTemporaryConfig(async ({ configPath }) => {
    const captured = await captureCredentialedSample(configPath, { cwd: repositoryRoot });
    for (const mutate of [
      (payload: MutableConfig) => { payload.mode = "live"; },
      (payload: MutableConfig) => { payload.evidenceTier = "credentialed_sample_unverified"; },
      (payload: MutableConfig) => { payload.missingCapabilities = []; },
      (payload: MutableConfig) => { payload.artifacts.rawResponseIds = []; },
      (payload: MutableConfig) => { payload.reconciliation.policy.mode = "required"; },
      (payload: MutableConfig) => { payload.providers[0].credentialEnvVar = "AWS_SECRET_ACCESS_KEY"; },
    ]) {
      const payload = structuredClone(captured.payload) as unknown as MutableConfig;
      mutate(payload);
      const { fingerprint: _discarded, ...body } = payload;
      payload.fingerprint = sha256Canonical(body);
      assert.throws(
        () => assertCredentialedSampleAuditPayload(payload as never),
        /execution mode|evidence tier|missing-capability|artifact manifest|runner policy|credential environment/,
      );
    }

    assert.equal(credentialedSampleExitCode(captured.payload, true, false), 1);
    assert.equal(credentialedSampleExitCode(captured.payload, false, true), 1);
  });
});
