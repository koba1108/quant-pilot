import {
  CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION,
  validateCredentialedSampleConfig,
  type CredentialedSampleConfig,
} from "../data/credentialed-sample-config.ts";
import {
  assertVersionedDataArtifact,
  buildVersionedDataArtifact,
  canonicalJson,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../data/provenance.ts";

export const PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_SCHEMA_VERSION
  = "pre-forward-credentialed-config-snapshot-v1" as const;
export const PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_ADAPTER_VERSION
  = "pre-forward-credentialed-config-snapshot-adapter-v1" as const;

export interface PreForwardCredentialedConfigSnapshotPayload {
  schemaVersion: typeof PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_SCHEMA_VERSION;
  disposition: "research_only";
  config: CredentialedSampleConfig;
  configFingerprint: string;
}

export function assertPreForwardCredentialedConfigSnapshotArtifact(
  artifact: VersionedDataArtifact<PreForwardCredentialedConfigSnapshotPayload>,
): void {
  assertVersionedDataArtifact(artifact);
  if (artifact.provenance.artifactKind !== "configuration"
    || artifact.provenance.source !== "quant-pilot"
    || artifact.provenance.dataset !== "pre-forward-credentialed-sample-config-snapshot"
    || artifact.provenance.sourceVersion !== CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION
    || artifact.provenance.adapterVersion !== PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_ADAPTER_VERSION
    || artifact.payload.schemaVersion !== PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_SCHEMA_VERSION
    || artifact.payload.disposition !== "research_only") {
    throw new Error("Pre-forward credentialed-sample config snapshot identity is invalid.");
  }
  const validatedConfig = validateCredentialedSampleConfig(artifact.payload.config);
  if (canonicalJson(validatedConfig) !== canonicalJson(artifact.payload.config)
    || artifact.payload.configFingerprint !== sha256Canonical(validatedConfig)
    || artifact.provenance.recordId !== artifact.payload.configFingerprint
    || artifact.provenance.observedAt !== artifact.provenance.availableAt
    || artifact.provenance.availableAt !== artifact.provenance.retrievedAt) {
    throw new Error("Pre-forward credentialed-sample config snapshot is not bound to its validated config.");
  }
}

export function buildPreForwardCredentialedConfigSnapshotArtifact(
  config: CredentialedSampleConfig,
  createdAt: string,
): VersionedDataArtifact<PreForwardCredentialedConfigSnapshotPayload> {
  const validatedConfig = validateCredentialedSampleConfig(config);
  if (canonicalJson(validatedConfig) !== canonicalJson(config)) {
    throw new Error("Credentialed-sample config changed after validation.");
  }
  const configFingerprint = sha256Canonical(validatedConfig);
  const artifact = buildVersionedDataArtifact<PreForwardCredentialedConfigSnapshotPayload>({
    artifactKind: "configuration",
    payload: {
      schemaVersion: PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_SCHEMA_VERSION,
      disposition: "research_only",
      config: validatedConfig,
      configFingerprint,
    },
    source: "quant-pilot",
    dataset: "pre-forward-credentialed-sample-config-snapshot",
    sourceVersion: CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION,
    adapterVersion: PRE_FORWARD_CREDENTIALED_CONFIG_SNAPSHOT_ADAPTER_VERSION,
    observedAt: createdAt,
    availableAt: createdAt,
    retrievedAt: createdAt,
    request: { configFingerprint },
    recordId: configFingerprint,
  });
  assertPreForwardCredentialedConfigSnapshotArtifact(artifact);
  return artifact;
}
