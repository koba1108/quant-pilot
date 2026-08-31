import {
  assertVersionedDataArtifact,
  buildVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../data/provenance.ts";
import {
  PRE_FORWARD_CONFIG_SCHEMA_VERSION,
  validatePreForwardConfig,
  type PreForwardConfig,
} from "./config.ts";

export const PRE_FORWARD_CONFIG_SNAPSHOT_SCHEMA_VERSION = "pre-forward-config-snapshot-v1" as const;
export const PRE_FORWARD_CONFIG_SNAPSHOT_ADAPTER_VERSION = "pre-forward-config-snapshot-adapter-v1" as const;

export interface PreForwardConfigSnapshotPayload {
  schemaVersion: typeof PRE_FORWARD_CONFIG_SNAPSHOT_SCHEMA_VERSION;
  disposition: "research_only";
  config: PreForwardConfig;
  configFingerprint: string;
}

export function assertPreForwardConfigSnapshotArtifact(
  artifact: VersionedDataArtifact<PreForwardConfigSnapshotPayload>,
): void {
  assertVersionedDataArtifact(artifact);
  if (artifact.provenance.artifactKind !== "configuration"
    || artifact.provenance.source !== "quant-pilot"
    || artifact.provenance.dataset !== "pre-forward-config-snapshot"
    || artifact.provenance.sourceVersion !== PRE_FORWARD_CONFIG_SCHEMA_VERSION
    || artifact.provenance.adapterVersion !== PRE_FORWARD_CONFIG_SNAPSHOT_ADAPTER_VERSION
    || artifact.payload.schemaVersion !== PRE_FORWARD_CONFIG_SNAPSHOT_SCHEMA_VERSION
    || artifact.payload.disposition !== "research_only") {
    throw new Error("Pre-forward config snapshot artifact identity is invalid.");
  }
  const validatedConfig = validatePreForwardConfig(artifact.payload.config);
  if (canonicalJson(validatedConfig) !== canonicalJson(artifact.payload.config)
    || artifact.payload.configFingerprint !== sha256Canonical(validatedConfig)
    || artifact.provenance.recordId !== artifact.payload.configFingerprint
    || artifact.provenance.observedAt !== artifact.provenance.availableAt
    || artifact.provenance.availableAt !== artifact.provenance.retrievedAt) {
    throw new Error("Pre-forward config snapshot provenance is not bound to its validated config.");
  }
}

export function buildPreForwardConfigSnapshotArtifact(
  config: PreForwardConfig,
  createdAt: string,
): VersionedDataArtifact<PreForwardConfigSnapshotPayload> {
  const validatedConfig = validatePreForwardConfig(config);
  if (canonicalJson(validatedConfig) !== canonicalJson(config)) {
    throw new Error("Pre-forward config changed after validation.");
  }
  const configFingerprint = sha256Canonical(validatedConfig);
  const artifact = buildVersionedDataArtifact<PreForwardConfigSnapshotPayload>({
    artifactKind: "configuration",
    payload: {
      schemaVersion: PRE_FORWARD_CONFIG_SNAPSHOT_SCHEMA_VERSION,
      disposition: "research_only",
      config: validatedConfig,
      configFingerprint,
    },
    source: "quant-pilot",
    dataset: "pre-forward-config-snapshot",
    sourceVersion: PRE_FORWARD_CONFIG_SCHEMA_VERSION,
    adapterVersion: PRE_FORWARD_CONFIG_SNAPSHOT_ADAPTER_VERSION,
    observedAt: createdAt,
    availableAt: createdAt,
    retrievedAt: createdAt,
    request: { configFingerprint },
    recordId: configFingerprint,
  });
  assertPreForwardConfigSnapshotArtifact(artifact);
  return artifact;
}
