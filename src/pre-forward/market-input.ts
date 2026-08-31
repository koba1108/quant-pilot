import type { DailyBar } from "../data/models.ts";
import { assertDailyBars } from "../data/provider.ts";
import {
  assertVersionedDataArtifact,
  buildVersionedDataArtifact,
  sha256Canonical,
  type VersionedDataArtifact,
} from "../data/provenance.ts";

export const PRE_FORWARD_DAILY_BARS_SCHEMA_VERSION = "pre-forward-daily-bars-v2" as const;

export interface PreForwardSyntheticReturnEventCoverage {
  basis: "synthetic_complete_no_events_v1";
  startDate: string;
  endDate: string;
  corporateActions: "complete";
  distributions: "complete";
  availableAt: string;
}

export interface PreForwardDailyBarsPayload {
  schemaVersion: typeof PRE_FORWARD_DAILY_BARS_SCHEMA_VERSION;
  evidenceTier: "synthetic_fixture";
  stableId: string;
  currency: "JPY";
  returnClassification: {
    close: "unadjusted_price";
    adjustedClose: "provider_adjusted_not_total_return";
  };
  availabilityBasis: "synthetic_same_day_close_v1";
  returnEventCoverage: PreForwardSyntheticReturnEventCoverage;
  bars: readonly DailyBar[];
}

export interface BuildPreForwardDailyBarsFixtureInput {
  code: string;
  bars: readonly DailyBar[];
  observedAt: string;
  availableAt: string;
  retrievedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPreForwardDailyBarsArtifact(
  artifact: VersionedDataArtifact<PreForwardDailyBarsPayload>,
): void {
  assertVersionedDataArtifact(artifact);
  if (artifact.provenance.artifactKind !== "daily_bars") {
    throw new Error("Pre-forward daily-bars artifact must use artifactKind=daily_bars.");
  }
  const payload: unknown = artifact.payload;
  if (!isRecord(payload) || payload.schemaVersion !== PRE_FORWARD_DAILY_BARS_SCHEMA_VERSION) {
    throw new Error("Pre-forward daily-bars artifact has an unsupported payload schema.");
  }
  if (payload.evidenceTier !== "synthetic_fixture") {
    throw new Error("Committed pre-forward fixture artifacts must remain synthetic_fixture.");
  }
  if (typeof payload.stableId !== "string" || payload.stableId.trim() === "") {
    throw new Error("Pre-forward daily-bars stableId must be non-empty.");
  }
  if (payload.currency !== "JPY") throw new Error("Pre-forward fixture daily bars must use JPY.");
  if (!isRecord(payload.returnClassification)
    || payload.returnClassification.close !== "unadjusted_price"
    || payload.returnClassification.adjustedClose !== "provider_adjusted_not_total_return") {
    throw new Error("Pre-forward fixture return classifications are invalid.");
  }
  if (payload.availabilityBasis !== "synthetic_same_day_close_v1") {
    throw new Error("Pre-forward fixture availability basis is invalid.");
  }
  if (!Array.isArray(payload.bars)) throw new Error("Pre-forward fixture bars must be an array.");
  const bars = assertDailyBars(payload.bars as DailyBar[], payload.stableId);
  const firstTradingDate = bars[0]!.tradingDate;
  const lastTradingDate = bars.at(-1)!.tradingDate;
  if (lastTradingDate > artifact.provenance.observedAt.slice(0, 10)
    || lastTradingDate > artifact.provenance.availableAt.slice(0, 10)) {
    throw new Error("Pre-forward daily-bars artifact cannot predate a contained trading date.");
  }
  if (!isRecord(payload.returnEventCoverage)) {
    throw new Error("Pre-forward fixture return-event coverage must be explicit.");
  }
  const coverage = payload.returnEventCoverage;
  if (coverage.basis !== "synthetic_complete_no_events_v1"
    || coverage.startDate !== firstTradingDate
    || coverage.endDate !== lastTradingDate
    || coverage.corporateActions !== "complete"
    || coverage.distributions !== "complete"
    || coverage.availableAt !== artifact.provenance.availableAt) {
    throw new Error("Pre-forward fixture return-event coverage is invalid or incomplete.");
  }
}

export function buildPreForwardDailyBarsFixture(
  input: BuildPreForwardDailyBarsFixtureInput,
): VersionedDataArtifact<PreForwardDailyBarsPayload> {
  const bars = assertDailyBars(input.bars.map((bar) => ({ ...bar })), input.code);
  const payload: PreForwardDailyBarsPayload = {
    schemaVersion: PRE_FORWARD_DAILY_BARS_SCHEMA_VERSION,
    evidenceTier: "synthetic_fixture",
    stableId: input.code,
    currency: "JPY",
    returnClassification: {
      close: "unadjusted_price",
      adjustedClose: "provider_adjusted_not_total_return",
    },
    availabilityBasis: "synthetic_same_day_close_v1",
    returnEventCoverage: {
      basis: "synthetic_complete_no_events_v1",
      startDate: bars[0]!.tradingDate,
      endDate: bars.at(-1)!.tradingDate,
      corporateActions: "complete",
      distributions: "complete",
      availableAt: input.availableAt,
    },
    bars,
  };
  const artifact = buildVersionedDataArtifact({
    artifactKind: "daily_bars",
    payload,
    source: "quant-pilot-synthetic-fixture",
    dataset: "pre-forward-daily-bars-fixture",
    sourceVersion: PRE_FORWARD_DAILY_BARS_SCHEMA_VERSION,
    adapterVersion: "pre-forward-fixture-seeder-v2",
    observedAt: input.observedAt,
    availableAt: input.availableAt,
    retrievedAt: input.retrievedAt,
    request: {
      code: input.code,
      firstTradingDate: bars[0]!.tradingDate,
      lastTradingDate: bars.at(-1)!.tradingDate,
      barCount: bars.length,
    },
    recordId: `pre-forward-fixture:${input.code}:${bars[0]!.tradingDate}:${bars.at(-1)!.tradingDate}`,
  });
  assertPreForwardDailyBarsArtifact(artifact);
  return artifact;
}

export type PreForwardEvidenceTier = "synthetic_fixture" | "credentialed_sample_unverified";

export interface LoadedPreForwardSeries {
  code: string;
  currency: "JPY";
  bars: readonly DailyBar[];
  artifactId: string;
  source: string;
  dataset: string;
  sourceVersion: string;
  adapterVersion: string;
  observedAt: string;
  availableAt: string;
  retrievedAt: string;
  returnBasis: "provider_adjusted_not_total_return";
  availabilityBasis:
    | "synthetic_same_day_close_v1"
    | "artifact_retrieved_at_not_source_native_row_availability";
  returnEventCoverage?: PreForwardSyntheticReturnEventCoverage;
}

export interface LoadedPreForwardInput {
  evidenceTier: PreForwardEvidenceTier;
  disposition: "research_only";
  inputArtifactIds: readonly string[];
  parentAuditArtifactId?: string;
  series: readonly LoadedPreForwardSeries[];
  missingCapabilities: readonly string[];
  limitations: readonly string[];
  integrityFingerprint: string;
}

type UnsealedLoadedPreForwardInput = Omit<LoadedPreForwardInput, "integrityFingerprint">;

export function loadedPreForwardInputIntegrityFingerprint(
  input: LoadedPreForwardInput | UnsealedLoadedPreForwardInput,
): string {
  const { integrityFingerprint: _integrityFingerprint, ...body } = input as LoadedPreForwardInput;
  return sha256Canonical(body);
}

export function sealLoadedPreForwardInput(input: UnsealedLoadedPreForwardInput): LoadedPreForwardInput {
  return { ...input, integrityFingerprint: loadedPreForwardInputIntegrityFingerprint(input) };
}

export function assertLoadedPreForwardInputIntegrity(input: LoadedPreForwardInput): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.integrityFingerprint)
    || loadedPreForwardInputIntegrityFingerprint(input) !== input.integrityFingerprint) {
    throw new Error("Loaded pre-forward inputs changed after artifact validation.");
  }
}
