import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  APPROVED_MAJOR_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  assertProviderEvaluationReportIntegrity,
  cloneProviderEvaluationConfig,
  evaluateProviderConfig,
  validateProviderEvaluationConfig,
  type ProviderCapability,
  type ProviderCapabilityRecord,
  type ProviderEvaluationConfig,
  type ProviderEvidence,
} from "../src/data/provider-evaluation.ts";
import {
  buildVersionedDataArtifact,
  sha256Canonical,
  type DataArtifactKind,
  type VersionedDataArtifact,
} from "../src/data/provenance.ts";
import {
  providerEvaluationExitCode,
  runProviderEvaluation,
} from "../src/data/provider-evaluation-runner.ts";

const ARTIFACT_KIND_BY_CAPABILITY: Readonly<Record<ProviderCapability, DataArtifactKind>> = {
  daily_prices: "daily_bars",
  adjustment_factors: "corporate_actions",
  distributions: "distributions",
  corporate_actions: "corporate_actions",
  jpy_fx: "fx_rates",
  historical_universe: "universe",
  listing_delisting: "universe",
  quote_quality: "quote_quality",
  exchange_calendar: "exchange_calendar",
  row_level_availability: "provider_capability_evidence",
  revision_history: "provider_capability_evidence",
  reproducible_access: "provider_capability_evidence",
};

function providerArtifact(providerId: string, capability: ProviderCapability): VersionedDataArtifact<unknown> {
  return buildVersionedDataArtifact({
    artifactKind: ARTIFACT_KIND_BY_CAPABILITY[capability],
    payload: { providerId, capability, sample: [{ semanticDate: "2026-08-28", value: 100 }] },
    source: providerId,
    dataset: capability,
    sourceVersion: "2026-08-28",
    adapterVersion: "example-adapter-v1",
    observedAt: "2026-08-28T16:00:00Z",
    availableAt: "2026-08-28T16:05:00Z",
    retrievedAt: "2026-08-29T00:00:00Z",
    request: { providerId, capability, start: "2026-08-28", end: "2026-08-28" },
  });
}

function documentEvidence(
  evidenceId: string,
  kind: "official_documentation" | "official_terms",
  title: string,
  url: string,
  version: string,
  claim: string,
): ProviderEvidence {
  const snapshot = buildVersionedDataArtifact({
    artifactKind: "provider_document",
    payload: { url, title, version, content: `Synthetic immutable document body for ${evidenceId}: ${claim}` },
    source: "Example",
    dataset: "official-provider-documents",
    sourceVersion: version,
    adapterVersion: "document-snapshot-v1",
    observedAt: "2026-08-29T00:00:00Z",
    availableAt: "2026-08-29T00:00:00Z",
    retrievedAt: "2026-08-29T00:00:00Z",
    request: { url },
    recordId: evidenceId,
  });
  return {
    evidenceId,
    kind,
    version,
    publisher: "Example",
    title,
    url,
    checkedAt: "2026-08-29",
    claim,
    contentHash: snapshot.provenance.contentHash,
    snapshot,
  };
}

function officialEvidence(evidenceId: string, claim: string): ProviderEvidence {
  return documentEvidence(
    evidenceId,
    "official_documentation",
    "API documentation",
    "https://example.com/docs",
    "docs-v1",
    claim,
  );
}

function sampleEvidence(evidenceId: string, artifact: VersionedDataArtifact<unknown>): ProviderEvidence {
  return {
    evidenceId,
    kind: "sample_artifact",
    version: "sample-v1",
    publisher: "Example",
    title: "Credentialed production sample",
    url: "https://example.com/sample-manifest",
    checkedAt: "2026-08-29",
    claim: "A credentialed production sample artifact.",
    contentHash: artifact.provenance.contentHash,
    artifactId: artifact.provenance.artifactId,
    artifact,
  };
}

function capability(
  name: ProviderCapability,
  evidencePrefix: string,
  artifactId: string,
  overrides: Partial<ProviderCapabilityRecord> = {},
): ProviderCapabilityRecord {
  return {
    capability: name,
    status: "partial",
    availabilityModel: "row_level",
    adapterStatus: "production_sample",
    evidenceIds: [`docs-${evidencePrefix}-${name}`, `sample-${evidencePrefix}-${name}`],
    artifactIds: [artifactId],
    limitations: [],
    ...overrides,
  };
}

function productionConfig(): ProviderEvaluationConfig {
  const artifacts = new Map<string, VersionedDataArtifact<unknown>>();
  const evidence: ProviderEvidence[] = [documentEvidence(
    "terms",
    "official_terms",
    "Terms",
    "https://example.com/terms",
    "terms-v1",
    "Required rights are confirmed for the synthetic test contract.",
  )];
  for (const providerId of ["example-a", "example-b"]) {
    for (const name of PROVIDER_CAPABILITIES) {
      const artifact = providerArtifact(providerId, name);
      artifacts.set(`${providerId}:${name}`, artifact);
      evidence.push(officialEvidence(`docs-${providerId}-${name}`, `${providerId} documents ${name}.`));
      evidence.push(sampleEvidence(`sample-${providerId}-${name}`, artifact));
    }
  }
  const candidate = (providerId: string) => ({
    providerId,
    independenceGroup: `${providerId}-organization`,
    displayName: `Example Provider ${providerId}`,
    accessModel: "business_contract" as const,
    capabilities: PROVIDER_CAPABILITIES.map((name) => capability(
      name,
      providerId,
      artifacts.get(`${providerId}:${name}`)!.provenance.artifactId,
    )),
    license: {
      overall: "verified" as const,
      privateResearch: "confirmed" as const,
      persistentStorage: "confirmed" as const,
      derivedResults: "confirmed" as const,
      auditReproduction: "confirmed" as const,
      redistribution: "restricted" as const,
      evidenceIds: ["terms"],
      limitations: ["Redistribution is outside the evaluated use case."],
    },
    commercial: {
      status: "published" as const,
      humanApproved: true,
      summary: "Synthetic approved cost.",
      evidenceIds: ["terms"],
    },
  });
  return {
    schemaVersion: "provider-evaluation-v1",
    evaluatedAt: "2026-08-29",
    selection: "not_selected",
    policy: {
      version: "test-policy-v1",
      status: "approved",
      requiredCapabilities: [...PROVIDER_CAPABILITIES],
      rowLevelRequiredCapabilities: [...APPROVED_MAJOR_CAPABILITIES],
      minIndependentSources: APPROVED_MAJOR_CAPABILITIES.map((capability) => ({ capability, count: 2 })),
      requireOfficialEvidence: true,
      requireVersionedArtifacts: true,
    },
    evidence,
    candidates: [candidate("example-a"), candidate("example-b")],
    bundles: [{
      bundleId: "example-bundle",
      displayName: "Example Bundle",
      sourceIds: ["example-a", "example-b"],
      responsibilities: PROVIDER_CAPABILITIES.map((capability) => ({
        capability,
        providerIds: ["example-a", "example-b"],
      })),
    }],
  };
}

test("versioned sample metadata remains unknown without payload-specific verification", () => {
  const config = productionConfig();
  const report = evaluateProviderConfig(config);
  assert.equal(report.disposition, "unknown");
  assert.equal(report.selection, "not_selected");
  assert.equal(report.failClosed, true);
  assert.equal(report.canEnableEtfRealistic, false);
  assert.equal(report.evidenceFingerprints.length, config.evidence.length);
  assertProviderEvaluationReportIntegrity(report, config);
  assert.equal(providerEvaluationExitCode(report, false), 0);
  assert.equal(providerEvaluationExitCode(report, true), 1);
});

test("evaluation is deterministic under input ordering changes", () => {
  const left = productionConfig();
  const right = cloneProviderEvaluationConfig(left);
  right.evidence = [...right.evidence].reverse();
  right.candidates[0]!.capabilities = [...right.candidates[0]!.capabilities].reverse();
  right.bundles[0]!.responsibilities = [...right.bundles[0]!.responsibilities].reverse();
  assert.deepEqual(evaluateProviderConfig(right), evaluateProviderConfig(left));
});

test("fake artifact IDs and mismatched artifact metadata are rejected", () => {
  const fake = productionConfig();
  const evidence = fake.evidence.find((item) => item.kind === "sample_artifact")!;
  evidence.artifactId = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateProviderEvaluationConfig(fake), /does not match artifact provenance/);

  const missingArtifact = productionConfig();
  const sample = missingArtifact.evidence.find((item) => item.kind === "sample_artifact")!;
  delete sample.artifact;
  assert.throws(() => validateProviderEvaluationConfig(missingArtifact), /requires artifact, contentHash, and artifactId/);

  const missingVersion = productionConfig();
  delete (missingVersion.evidence[0] as unknown as Record<string, unknown>).version;
  assert.throws(() => validateProviderEvaluationConfig(missingVersion), /evidence\[0\]\.version must be a non-empty string/);

  const unhashedOfficialEvidence = productionConfig();
  const docs = unhashedOfficialEvidence.evidence.find((item) => item.kind === "official_documentation")!;
  delete docs.contentHash;
  assert.throws(
    () => validateProviderEvaluationConfig(unhashedOfficialEvidence),
    /must provide contentHash and snapshot together/,
  );

  const mutatedPayload = cloneProviderEvaluationConfig(productionConfig());
  const mutatedSample = mutatedPayload.evidence.find((item) => item.kind === "sample_artifact")!;
  (mutatedSample.artifact!.payload as { sample: { value: number }[] }).sample[0]!.value = 101;
  assert.throws(() => validateProviderEvaluationConfig(mutatedPayload), /contentHash does not match its payload/);

  const mutatedDocument = cloneProviderEvaluationConfig(productionConfig());
  const document = mutatedDocument.evidence.find((item) => item.kind === "official_documentation")!;
  document.snapshot!.payload.content = "forged after capture";
  assert.throws(() => validateProviderEvaluationConfig(mutatedDocument), /contentHash does not match its payload/);

  const unboundDocument = productionConfig();
  const unboundDocs = unboundDocument.evidence.find((item) => item.kind === "official_documentation")!;
  delete unboundDocs.snapshot;
  assert.throws(
    () => validateProviderEvaluationConfig(unboundDocument),
    /must provide contentHash and snapshot together/,
  );
});

test("sample artifacts require semantically compatible artifact kinds", () => {
  const config = productionConfig();
  const candidate = config.candidates[0]!;
  const daily = candidate.capabilities.find((record) => record.capability === "daily_prices")!;
  const distribution = candidate.capabilities.find((record) => record.capability === "distributions")!;
  distribution.artifactIds = daily.artifactIds;
  distribution.evidenceIds = [distribution.evidenceIds[0]!, daily.evidenceIds[1]!];
  assert.throws(
    () => validateProviderEvaluationConfig(config),
    /artifactKind=daily_bars cannot evidence distributions/,
  );
});

test("provider-evaluation-v1 rejects verified capability claims", () => {
  const config = productionConfig();
  config.candidates[0]!.capabilities[0]!.status = "verified";
  assert.throws(
    () => validateProviderEvaluationConfig(config),
    /status=verified is not supported by provider-evaluation-v1/,
  );
});

test("empty and weak approved policies are rejected", () => {
  const empty = productionConfig();
  empty.policy.requiredCapabilities = [];
  assert.throws(() => validateProviderEvaluationConfig(empty), /must not be empty/);

  const weak = productionConfig();
  weak.policy.requiredCapabilities = ["daily_prices"];
  assert.throws(() => validateProviderEvaluationConfig(weak), /policy row-level capability|must require every provider capability/);

  const weakMajor = productionConfig();
  weakMajor.policy.rowLevelRequiredCapabilities = [];
  assert.throws(() => validateProviderEvaluationConfig(weakMajor), /row-level availability and two independent sources/);
});

test("mixed bundle uses worst-case blocked disposition", () => {
  const config = productionConfig();
  const blockedCandidate = {
    ...config.candidates[0]!,
    providerId: "blocked-provider",
    displayName: "Blocked Provider",
    capabilities: config.candidates[0]!.capabilities.map((record) =>
      record.capability === "daily_prices" ? { ...record, status: "unsupported" as const } : record),
  };
  config.candidates = [...config.candidates, blockedCandidate];
  config.bundles = [config.bundles[0]!, {
    bundleId: "blocked-bundle",
    displayName: "Blocked Bundle",
    sourceIds: ["blocked-provider"],
    responsibilities: PROVIDER_CAPABILITIES.map((capability) => ({ capability, providerIds: ["blocked-provider"] })),
  }];
  const report = evaluateProviderConfig(config);
  assert.equal(report.bundles.find((bundle) => bundle.bundleId === "example-bundle")!.disposition, "unknown");
  assert.equal(report.bundles.find((bundle) => bundle.bundleId === "blocked-bundle")!.disposition, "blocked");
  assert.equal(report.disposition, "blocked");
  assert.equal(providerEvaluationExitCode(report, false), 0);
  assert.equal(providerEvaluationExitCode(report, true), 1);
});

test("sample artifacts must be bound to the provider identity they verify", () => {
  const config = productionConfig();
  const candidate = config.candidates[0]!;
  const foreignArtifactId = config.candidates[1]!.capabilities[0]!.artifactIds[0]!;
  candidate.capabilities = candidate.capabilities.map((record) => record.capability === "daily_prices" ? {
    ...record,
    artifactIds: [foreignArtifactId],
    evidenceIds: [record.evidenceIds[0]!, config.candidates[1]!.capabilities[0]!.evidenceIds[1]!],
  } : record);
  const report = evaluateProviderConfig(config);
  assert.equal(report.disposition, "unknown");
  assert.ok(report.bundles[0]!.issues.some((issue) => issue.checkId === "artifact.provider_binding_mismatch"));
});

test("independent-source counts use explicit organization groups, not provider IDs", () => {
  const config = productionConfig();
  config.candidates[1]!.independenceGroup = config.candidates[0]!.independenceGroup;
  const report = evaluateProviderConfig(config);
  assert.equal(report.disposition, "unknown");
  assert.ok(report.bundles[0]!.issues.some((issue) => issue.checkId === "reconciliation.independence_group_reused"));
  assert.ok(report.bundles[0]!.issues.some((issue) =>
    issue.checkId === "reconciliation.independent_sources_missing" && issue.capability === "daily_prices"));
});

test("commercial unknown with human approval is invalid and unknown license fails closed", () => {
  const commercial = productionConfig();
  commercial.candidates[0]!.commercial.status = "unknown";
  assert.throws(
    () => validateProviderEvaluationConfig(commercial),
    /cannot be human-approved while commercial terms remain unknown/,
  );

  const license = productionConfig();
  license.candidates[0]!.license.overall = "unknown";
  const licenseReport = evaluateProviderConfig(license);
  assert.equal(licenseReport.disposition, "unknown");
  assert.ok(licenseReport.bundles[0]!.issues.some((issue) => issue.checkId === "license.overall.unknown"));

  const unverifiedTerms = productionConfig();
  const terms = unverifiedTerms.evidence.find((item) => item.kind === "official_terms")!;
  delete terms.snapshot;
  delete terms.contentHash;
  assert.throws(
    () => validateProviderEvaluationConfig(unverifiedTerms),
    /overall=verified requires an integrity-checked terms or contract snapshot/,
  );

  const unverifiedRestrictedTerms = productionConfig();
  unverifiedRestrictedTerms.candidates[0]!.license.overall = "restricted";
  const restrictedTerms = unverifiedRestrictedTerms.evidence.find((item) => item.kind === "official_terms")!;
  delete restrictedTerms.snapshot;
  delete restrictedTerms.contentHash;
  assert.throws(
    () => validateProviderEvaluationConfig(unverifiedRestrictedTerms),
    /overall=restricted requires an integrity-checked terms or contract snapshot/,
  );

  const unverifiedCommercial = productionConfig();
  unverifiedCommercial.candidates.forEach((candidate) => {
    candidate.license.overall = "unknown";
  });
  const commercialTerms = unverifiedCommercial.evidence.find((item) => item.kind === "official_terms")!;
  delete commercialTerms.snapshot;
  delete commercialTerms.contentHash;
  assert.throws(
    () => validateProviderEvaluationConfig(unverifiedCommercial),
    /human approval requires an integrity-checked pricing or contract snapshot/,
  );
});

test("report and config refingerprints detect tampering", () => {
  const config = productionConfig();
  const report = evaluateProviderConfig(config);
  (report.bundles[0]!.issues as unknown as { message: string }[]).push({ message: "mutated" });
  assert.throws(() => assertProviderEvaluationReportIntegrity(report, config), /fingerprint does not match/);

  const freshReport = evaluateProviderConfig(config);
  const changedConfig = cloneProviderEvaluationConfig(config);
  changedConfig.evidence[0]!.claim = "changed after evaluation";
  assert.throws(
    () => assertProviderEvaluationReportIntegrity(freshReport, changedConfig),
    /does not match a fresh evaluation/,
  );

  const refingerprinted = evaluateProviderConfig(config);
  refingerprinted.disposition = "pass";
  const { fingerprint: _fingerprint, ...refingerprintedBody } = refingerprinted;
  refingerprinted.fingerprint = sha256Canonical(refingerprintedBody);
  assert.throws(
    () => assertProviderEvaluationReportIntegrity(refingerprinted, config),
    /does not match a fresh evaluation/,
  );
});

test("committed O-001 snapshot is deterministic, blocked, unselected, and audit-runnable", async () => {
  const path = "research/provider-evaluation/o001-candidates.json";
  const first = await runProviderEvaluation(path);
  const second = await runProviderEvaluation(path);
  assert.deepEqual(second, first);
  assert.equal(first.disposition, "blocked");
  assert.equal(first.selection, "not_selected");
  assert.equal(first.failClosed, true);
  assert.equal(first.canEnableEtfRealistic, false);
  assert.equal(first.evidenceFingerprints.length, 22);
  assert.equal(first.bundles.length, 2);
  assert.ok(first.bundles.every((bundle) => bundle.disposition === "blocked" && bundle.failClosed));
  assert.equal(providerEvaluationExitCode(first, false), 0);
  assert.equal(providerEvaluationExitCode(first, true), 1);
});
