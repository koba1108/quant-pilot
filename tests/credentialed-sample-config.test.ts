import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION,
  parseCredentialedSampleConfig,
  validateCredentialedSampleConfig,
} from "../src/data/credentialed-sample-config.ts";

function baseConfig(mode: "fixture" | "live" = "fixture"): Record<string, unknown> {
  const provider = (
    providerId: "jquants_v2" | "eodhd_eod",
    source: string,
    independenceGroup: string,
    credentialEnvVar: string,
  ) => ({
    providerId,
    source,
    independenceGroup,
    credentialEnvVar,
    ...(mode === "fixture" ? { fixtureFile: `tests/fixtures/provider-samples/${providerId}.json` } : {}),
  });
  const instruments = Array.from({ length: mode === "live" ? 5 : 1 }, (_, index) => ({
    stableId: `jp.etf.${1305 + index}`,
    currency: "JPY",
    mappings: [
      { providerId: "jquants_v2", providerSymbol: `${1305 + index}` },
      { providerId: "eodhd_eod", providerSymbol: `${1305 + index}.TSE` },
    ],
  }));
  return {
    schemaVersion: CREDENTIALED_SAMPLE_CONFIG_SCHEMA_VERSION,
    mode,
    range: { start: "2024-01-01", end: "2024-12-31" },
    artifactRoot: { kind: "relative", path: "data/raw/credentialed-samples" },
    providers: [
      provider("jquants_v2", "jquants", "jpx", "JQUANTS_API_KEY"),
      provider("eodhd_eod", "eodhd", "eodhd", "EODHD_API_TOKEN"),
    ],
    instruments,
    credentialUseAuthorized: mode === "live",
    costAuthorized: mode === "live",
    rawRetentionAuthorized: mode === "live",
    licenseRetentionConfirmed: mode === "live",
  };
}

test("parses a fixture config and keeps provider/instrument mappings explicit", () => {
  const parsed = parseCredentialedSampleConfig(baseConfig());
  assert.equal(parsed.mode, "fixture");
  assert.equal(parsed.providers[0]!.credentialEnvVar, "JQUANTS_API_KEY");
  assert.equal(parsed.instruments[0]!.mappings[1]!.providerSymbol, "1305.TSE");
  assert.equal(parsed.providers[0]!.fixtureFile, "tests/fixtures/provider-samples/jquants_v2.json");
  assert.equal(parsed.credentialUseAuthorized, false);
  assert.equal(parsed.rawRetentionAuthorized, false);
});

test("requires every independent authorization gate and 5-10 instruments for live mode", () => {
  assert.doesNotThrow(() => validateCredentialedSampleConfig(baseConfig("live")));
  assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig("live"), credentialUseAuthorized: false }), /credentialUseAuthorized=true/);
  assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig("live"), costAuthorized: false }), /costAuthorized=true/);
  assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig("live"), rawRetentionAuthorized: false }), /rawRetentionAuthorized=true/);
  assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig("live"), licenseRetentionConfirmed: false }), /licenseRetentionConfirmed=true/);
  const tooSmall = baseConfig("live");
  (tooSmall.instruments as unknown[]).splice(1);
  assert.throws(() => validateCredentialedSampleConfig(tooSmall), /5 to 10 instruments/);
});

test("fixture mode cannot claim live authorization", () => {
  for (const field of [
    "credentialUseAuthorized",
    "costAuthorized",
    "rawRetentionAuthorized",
    "licenseRetentionConfirmed",
  ] as const) {
    assert.throws(
      () => validateCredentialedSampleConfig({ ...baseConfig(), [field]: true }),
      /fixture mode requires every authorization record to remain false/,
    );
  }
});

test("rejects unknown keys and secret values", () => {
  assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig(), unexpected: true }), /unknown fields/);
  const withSecret = baseConfig();
  (withSecret.providers as Record<string, unknown>[])[0]!.credentialEnvVar = "real-api-secret";
  assert.throws(() => validateCredentialedSampleConfig(withSecret), /environment variable name, not a secret value/);
  const withApiKey = baseConfig();
  (withApiKey.providers as Record<string, unknown>[])[0]!.apiKey = "secret";
  assert.throws(() => validateCredentialedSampleConfig(withApiKey), /unknown fields/);
});

test("rejects duplicate provider, source, independence group, and stable IDs", () => {
  for (const field of ["providerId", "source", "independenceGroup"] as const) {
    const config = baseConfig();
    const providers = config.providers as Record<string, unknown>[];
    providers[1]![field] = providers[0]![field];
    if (field === "providerId") providers[1]!.credentialEnvVar = providers[0]!.credentialEnvVar;
    assert.throws(() => validateCredentialedSampleConfig(config), /duplicates/);
  }
  const duplicateInstrument = baseConfig();
  const duplicateInstruments = duplicateInstrument.instruments as Record<string, unknown>[];
  duplicateInstruments.push(duplicateInstruments[0]!);
  assert.throws(() => validateCredentialedSampleConfig(duplicateInstrument), /instruments\.stableId contains duplicates/);
});

test("binds each provider to its dedicated credential environment variable", () => {
  for (const [index, credentialEnvVar] of [[0, "AWS_SECRET_ACCESS_KEY"], [1, "GITHUB_TOKEN"]] as const) {
    const config = baseConfig();
    (config.providers as Record<string, unknown>[])[index]!.credentialEnvVar = credentialEnvVar;
    assert.throws(
      () => validateCredentialedSampleConfig(config),
      /credentialEnvVar must be (JQUANTS_API_KEY|EODHD_API_TOKEN)/,
    );
  }
});

test("requires stable lowercase source identities", () => {
  for (const field of ["source", "independenceGroup"] as const) {
    const config = baseConfig();
    (config.providers as Record<string, unknown>[])[0]![field] = "JPX Primary";
    assert.throws(() => validateCredentialedSampleConfig(config), /lowercase stable identifier/);
  }
});

test("requires supported providers and a complete per-provider symbol mapping", () => {
  const unsupported = baseConfig();
  (unsupported.providers as Record<string, unknown>[])[0]!.providerId = "bloomberg";
  assert.throws(() => validateCredentialedSampleConfig(unsupported), /providerId must be one of/);
  const incomplete = baseConfig();
  (incomplete.instruments as Record<string, unknown>[])[0]!.mappings = [
    { providerId: "jquants_v2", providerSymbol: "1305" },
  ];
  assert.throws(() => validateCredentialedSampleConfig(incomplete), /exactly one providerSymbol/);

  const oneProvider = baseConfig();
  (oneProvider.providers as unknown[]).splice(1);
  assert.throws(() => validateCredentialedSampleConfig(oneProvider), /exactly the J-Quants and EODHD/);
});

test("permits an explicit live J-Quants-only Pre-Forward primary capture", () => {
  const config = baseConfig("live");
  config.purpose = "pre_forward_primary";
  (config.providers as unknown[]).splice(1);
  (config.providers as Record<string, unknown>[])[0]!.requestIntervalMs = 13_000;
  for (const instrument of config.instruments as Record<string, unknown>[]) {
    (instrument.mappings as unknown[]).splice(1);
  }
  const parsed = validateCredentialedSampleConfig(config);
  assert.equal(parsed.purpose, "pre_forward_primary");
  assert.deepEqual(parsed.providers.map((provider) => provider.providerId), ["jquants_v2"]);
  assert.equal(parsed.providers[0]!.requestIntervalMs, 13_000);

  const comparison = structuredClone(config);
  delete comparison.purpose;
  assert.throws(() => validateCredentialedSampleConfig(comparison), /exactly the J-Quants and EODHD/);

  const wrongProvider = structuredClone(config);
  (wrongProvider.providers as Record<string, unknown>[])[0] = {
    providerId: "eodhd_eod",
    source: "eodhd",
    independenceGroup: "eodhd",
    credentialEnvVar: "EODHD_API_TOKEN",
  };
  for (const instrument of wrongProvider.instruments as Record<string, unknown>[]) {
    instrument.mappings = [{ providerId: "eodhd_eod", providerSymbol: "1308.TSE" }];
  }
  assert.throws(() => validateCredentialedSampleConfig(wrongProvider), /exactly J-Quants/);

  const fixture = baseConfig();
  fixture.purpose = "pre_forward_primary";
  assert.throws(() => validateCredentialedSampleConfig(fixture), /supported only in live mode/);

  for (const requestIntervalMs of [-1, 1.5, 60_001, "13000"]) {
    const invalid = structuredClone(config);
    (invalid.providers as Record<string, unknown>[])[0]!.requestIntervalMs = requestIntervalMs;
    assert.throws(() => validateCredentialedSampleConfig(invalid), /requestIntervalMs/);
  }
});

test("rejects a provider symbol reused for two stable instruments", () => {
  const config = baseConfig("live");
  const instruments = config.instruments as Record<string, unknown>[];
  const secondMappings = instruments[1]!.mappings as Record<string, unknown>[];
  secondMappings[0]!.providerSymbol = "1305";
  assert.throws(
    () => validateCredentialedSampleConfig(config),
    /instruments\.mappings\.jquants_v2\.providerSymbol contains duplicates/,
  );

  secondMappings[0]!.providerSymbol = "1306";
  secondMappings[1]!.providerSymbol = "1305.tse";
  assert.throws(
    () => validateCredentialedSampleConfig(config),
    /instruments\.mappings\.eodhd_eod\.providerSymbol contains duplicates/,
  );
});

test("binds fixture files to fixture mode only", () => {
  const missing = baseConfig();
  delete (missing.providers as Record<string, unknown>[])[0]!.fixtureFile;
  assert.throws(() => validateCredentialedSampleConfig(missing), /fixtureFile/);

  const live = baseConfig("live");
  (live.providers as Record<string, unknown>[])[0]!.fixtureFile = "tests/fixtures/provider-samples/jquants_v2.json";
  assert.throws(() => validateCredentialedSampleConfig(live), /must not configure.*fixtureFile/);

  const traversal = baseConfig();
  (traversal.providers as Record<string, unknown>[])[0]!.fixtureFile = "../secret.json";
  assert.throws(() => validateCredentialedSampleConfig(traversal), /traversal-free/);

  const pacedFixture = baseConfig();
  (pacedFixture.providers as Record<string, unknown>[])[0]!.requestIntervalMs = 1;
  assert.throws(() => validateCredentialedSampleConfig(pacedFixture), /fixture mode must not configure.*requestIntervalMs/);
});

test("validates ISO dates and rejects look-alike or reversed ranges", () => {
  for (const range of [
    { start: "2024-02-30", end: "2024-12-31" },
    { start: "2024-01-01T00:00:00Z", end: "2024-12-31" },
    { start: "2025-01-01", end: "2024-12-31" },
  ]) {
    assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig(), range }), /range\.(start|end)/);
  }
});

test("requires artifact root kind to match a safe relative or absolute path", () => {
  assert.doesNotThrow(() => validateCredentialedSampleConfig({
    ...baseConfig(), artifactRoot: { kind: "absolute", path: "/tmp/quant-pilot-samples" },
  }));
  for (const artifactRoot of [
    { kind: "relative", path: "/tmp/quant-pilot-samples" },
    { kind: "absolute", path: "data/raw/samples" },
    { kind: "relative", path: "../outside" },
    { kind: "relative", path: "src/provider-artifacts" },
    { kind: "relative", path: "https://example.invalid" },
  ]) {
    assert.throws(() => validateCredentialedSampleConfig({ ...baseConfig(), artifactRoot }), /artifactRoot/);
  }
});
