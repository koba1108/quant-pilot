import {
  buildVersionedDataArtifact,
  assertVersionedDataArtifact,
  type VersionedDataArtifact,
} from "../data/provenance.ts";
import {
  assertUniverseMasterIntegrity,
  UNIVERSE_MASTER_SCHEMA_VERSION,
  type UniverseMaster,
} from "../data/universe-master.ts";

export const PRE_FORWARD_UNIVERSE_SNAPSHOT_SCHEMA_VERSION = "pre-forward-universe-snapshot-v1" as const;
export const PRE_FORWARD_UNIVERSE_SNAPSHOT_ADAPTER_VERSION = "pre-forward-universe-snapshot-adapter-v1" as const;

export interface PreForwardUniverseSnapshotPayload {
  schemaVersion: typeof PRE_FORWARD_UNIVERSE_SNAPSHOT_SCHEMA_VERSION;
  disposition: "research_only";
  master: UniverseMaster;
}

export function assertPreForwardUniverseSnapshotArtifact(
  artifact: VersionedDataArtifact<PreForwardUniverseSnapshotPayload>,
): void {
  assertVersionedDataArtifact(artifact);
  if (artifact.provenance.artifactKind !== "universe"
    || artifact.provenance.source !== "quant-pilot"
    || artifact.provenance.dataset !== "pre-forward-universe-snapshot"
    || artifact.provenance.sourceVersion !== UNIVERSE_MASTER_SCHEMA_VERSION
    || artifact.provenance.adapterVersion !== PRE_FORWARD_UNIVERSE_SNAPSHOT_ADAPTER_VERSION
    || artifact.payload.schemaVersion !== PRE_FORWARD_UNIVERSE_SNAPSHOT_SCHEMA_VERSION
    || artifact.payload.disposition !== "research_only") {
    throw new Error("Pre-forward Universe snapshot artifact identity is invalid.");
  }
  assertUniverseMasterIntegrity(artifact.payload.master);
  if (artifact.provenance.recordId !== artifact.payload.master.fingerprint
    || artifact.provenance.observedAt !== artifact.provenance.availableAt
    || artifact.provenance.availableAt !== artifact.provenance.retrievedAt) {
    throw new Error("Pre-forward Universe snapshot provenance is not bound to its retained master.");
  }
}

export function buildPreForwardUniverseSnapshotArtifact(
  master: UniverseMaster,
  createdAt: string,
): VersionedDataArtifact<PreForwardUniverseSnapshotPayload> {
  assertUniverseMasterIntegrity(master);
  const artifact = buildVersionedDataArtifact<PreForwardUniverseSnapshotPayload>({
    artifactKind: "universe",
    payload: {
      schemaVersion: PRE_FORWARD_UNIVERSE_SNAPSHOT_SCHEMA_VERSION,
      disposition: "research_only",
      master,
    },
    source: "quant-pilot",
    dataset: "pre-forward-universe-snapshot",
    sourceVersion: UNIVERSE_MASTER_SCHEMA_VERSION,
    adapterVersion: PRE_FORWARD_UNIVERSE_SNAPSHOT_ADAPTER_VERSION,
    observedAt: createdAt,
    availableAt: createdAt,
    retrievedAt: createdAt,
    request: {
      masterFingerprint: master.fingerprint,
      recordCount: master.records.length,
    },
    recordId: master.fingerprint,
  });
  assertPreForwardUniverseSnapshotArtifact(artifact);
  return artifact;
}
