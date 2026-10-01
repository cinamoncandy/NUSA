import { createHash } from "node:crypto";
import type { HistoricalDatasetManifest } from "./researchDataset";
import type { UpbitCandleFreshness } from "../exchange/upbitCandleAdapter";

export type ResearchEvidenceKind = "REAL" | "SYNTHETIC";
export type ResearchIntegrityStatus = "VALID" | "INVALID";

export interface PointInTimeBoundary {
  readonly observedAt: number;
  readonly availableAt: number;
  readonly decisionAt: number;
  readonly featureCutoff: number;
}

export interface ResearchSegment {
  readonly id: string;
  readonly startAt: number;
  readonly endAt: number;
}

export interface FeatureIdentity {
  readonly featureId: string;
  readonly featureVersion: string;
  readonly datasetFingerprint: string;
  readonly inputCutoff: number;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface ResearchEvidenceProvenance {
  readonly evidenceKind: ResearchEvidenceKind;
  readonly datasetFingerprint: string;
  readonly featureFingerprint: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly familyId: string;
  readonly engineVersion: string;
  readonly gitCommitSha: string;
  readonly researchRunId: string;
  readonly createdAt: string;
}

export interface ResearchUniverseConstituent {
  readonly market: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly eligibleFrom: number;
  readonly eligibleUntil?: number;
  readonly evidenceRef: string;
}

export interface ResearchUniverseProvenance {
  readonly schemaVersion: 1;
  readonly universeId: string;
  readonly version: string;
  readonly asOf: number;
  readonly availableAt: number;
  readonly selectionPolicyId: string;
  readonly source: string;
  readonly constituents: readonly ResearchUniverseConstituent[];
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: unknown): string => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
};

export function validatePointInTimeBoundary(boundary: PointInTimeBoundary): void {
  for (const [name, value] of Object.entries(boundary)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_POINT_IN_TIME:${name}`);
  }
  if (boundary.observedAt > boundary.availableAt) throw new Error("FUTURE_LEAKAGE:observed_after_available");
  if (boundary.availableAt > boundary.decisionAt) throw new Error("FUTURE_LEAKAGE:unavailable_at_decision");
  if (boundary.featureCutoff > boundary.decisionAt) throw new Error("FUTURE_LEAKAGE:feature_cutoff_after_decision");
  if (boundary.featureCutoff < boundary.observedAt) throw new Error("INVALID_POINT_IN_TIME:feature_cutoff_before_observation");
}

export function featureFingerprint(identity: FeatureIdentity): string {
  if (!identity.featureId.trim() || !identity.featureVersion.trim()) throw new Error("INVALID_FEATURE_IDENTITY");
  if (!/^[0-9a-f]{64}$/.test(identity.datasetFingerprint)) throw new Error("INVALID_DATASET_FINGERPRINT");
  if (!Number.isSafeInteger(identity.inputCutoff) || identity.inputCutoff < 0) throw new Error("INVALID_FEATURE_CUTOFF");
  return sha256(canonical(identity));
}

export function assertFeatureBinding(identity: FeatureIdentity, expectedDatasetFingerprint: string, expectedFingerprint: string): void {
  if (identity.datasetFingerprint !== expectedDatasetFingerprint) throw new Error("DATASET_FINGERPRINT_MISMATCH");
  if (featureFingerprint(identity) !== expectedFingerprint) throw new Error("FEATURE_FINGERPRINT_MISMATCH");
}

export function assertSegmentIsolation(train: ResearchSegment, validation: ResearchSegment | undefined, oos: ResearchSegment): void {
  const segments = [train, ...(validation == null ? [] : [validation]), oos];
  for (const segment of segments) {
    if (!segment.id.trim() || !Number.isSafeInteger(segment.startAt) || !Number.isSafeInteger(segment.endAt) || segment.startAt >= segment.endAt) {
      throw new Error("INVALID_RESEARCH_SEGMENT");
    }
  }
  for (let left = 0; left < segments.length; left += 1) for (let right = left + 1; right < segments.length; right += 1) {
    const a = segments[left]!, b = segments[right]!;
    if (Math.max(a.startAt, b.startAt) < Math.min(a.endAt, b.endAt)) throw new Error("TRAIN_OOS_CONTAMINATION");
  }
  if (train.endAt > oos.startAt || (validation != null && (train.endAt > validation.startAt || validation.endAt > oos.startAt))) {
    throw new Error("RESEARCH_SEGMENT_ORDER_INVALID");
  }
}

export function oosReuseFingerprint(oos: ResearchSegment, datasetFingerprint: string): string {
  if (!/^[0-9a-f]{64}$/.test(datasetFingerprint)) throw new Error("INVALID_DATASET_FINGERPRINT");
  return sha256(canonical({ datasetFingerprint, oos }));
}

export function validateEvidenceProvenance(provenance: ResearchEvidenceProvenance, options: { promotionEligible?: boolean } = {}): void {
  for (const key of ["strategyId","strategyVersion","familyId","engineVersion","gitCommitSha","researchRunId","createdAt"] as const) {
    if (!provenance[key].trim()) throw new Error(`MISSING_PROVENANCE:${key}`);
  }
  if (!/^[0-9a-f]{64}$/.test(provenance.datasetFingerprint)) throw new Error("MISSING_PROVENANCE:datasetFingerprint");
  if (!/^[0-9a-f]{64}$/.test(provenance.featureFingerprint)) throw new Error("MISSING_PROVENANCE:featureFingerprint");
  if (!/^[0-9a-f]{40}$/.test(provenance.gitCommitSha)) throw new Error("INVALID_PROVENANCE:gitCommitSha");
  if (!Number.isFinite(Date.parse(provenance.createdAt))) throw new Error("INVALID_PROVENANCE:createdAt");
  if (options.promotionEligible === true && provenance.evidenceKind !== "REAL") throw new Error("SYNTHETIC_EVIDENCE_PROMOTION_FORBIDDEN");
}

export function validateResearchUniverseProvenance(
  universe: ResearchUniverseProvenance,
  options: { readonly decisionAt?: number; readonly selectionAt?: number } = {},
): void {
  if (universe == null || universe.schemaVersion !== 1) throw new Error("INVALID_RESEARCH_UNIVERSE");
  for (const [name, value] of [
    ["universeId", universe.universeId],
    ["version", universe.version],
    ["selectionPolicyId", universe.selectionPolicyId],
    ["source", universe.source],
  ] as const) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`MISSING_UNIVERSE_PROVENANCE:${name}`);
  }
  if (!Number.isSafeInteger(universe.asOf) || universe.asOf < 0) throw new Error("INVALID_UNIVERSE_AS_OF");
  if (!Number.isSafeInteger(universe.availableAt) || universe.availableAt < universe.asOf) {
    throw new Error("INVALID_UNIVERSE_AVAILABILITY");
  }
  if (options.decisionAt != null && (!Number.isSafeInteger(options.decisionAt) || universe.availableAt > options.decisionAt)) {
    throw new Error("FUTURE_LEAKAGE:universe_unavailable_at_decision");
  }
  if (options.selectionAt != null) {
    if (!Number.isSafeInteger(options.selectionAt) || options.selectionAt < 0) throw new Error("INVALID_UNIVERSE_SELECTION_TIME");
    if (universe.asOf > options.selectionAt || universe.availableAt > options.selectionAt) {
      throw new Error("SURVIVORSHIP_BIAS:universe_snapshot_after_selection");
    }
  }
  if (!Array.isArray(universe.constituents) || universe.constituents.length === 0) {
    throw new Error("EMPTY_RESEARCH_UNIVERSE");
  }
  const markets = new Set<string>();
  for (const constituent of universe.constituents) {
    if (!constituent.market.trim() || !constituent.datasetId.trim() || !constituent.evidenceRef.trim()) {
      throw new Error("MISSING_UNIVERSE_CONSTITUENT_PROVENANCE");
    }
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(constituent.market)) {
      throw new Error("INVALID_UNIVERSE_MARKET_ID");
    }
    if (!/^[0-9a-f]{64}$/.test(constituent.datasetContentSha256)) {
      throw new Error("INVALID_UNIVERSE_DATASET_FINGERPRINT");
    }
    if (!Number.isSafeInteger(constituent.eligibleFrom) || constituent.eligibleFrom < 0 || constituent.eligibleFrom > universe.asOf) {
      throw new Error("SURVIVORSHIP_BIAS:constituent_not_yet_eligible");
    }
    if (constituent.eligibleUntil != null) {
      if (!Number.isSafeInteger(constituent.eligibleUntil) || constituent.eligibleUntil <= constituent.eligibleFrom) {
        throw new Error("INVALID_UNIVERSE_ELIGIBILITY_RANGE");
      }
      if (constituent.eligibleUntil <= universe.asOf) {
        throw new Error("SURVIVORSHIP_BIAS:constituent_not_eligible_as_of");
      }
    }
    if (markets.has(constituent.market)) throw new Error("DUPLICATE_UNIVERSE_CONSTITUENT");
    markets.add(constituent.market);
  }
}

function normalizedUniverse(universe: ResearchUniverseProvenance): ResearchUniverseProvenance {
  const constituents = universe.constituents.map((constituent) => {
    const normalized = {
      market: constituent.market,
      datasetId: constituent.datasetId.trim(),
      datasetContentSha256: constituent.datasetContentSha256,
      eligibleFrom: constituent.eligibleFrom,
      evidenceRef: constituent.evidenceRef.trim(),
    };
    return constituent.eligibleUntil == null
      ? normalized
      : { ...normalized, eligibleUntil: constituent.eligibleUntil };
  }).sort((left, right) => left.market < right.market ? -1 : left.market > right.market ? 1 : 0);
  return {
    schemaVersion: 1,
    universeId: universe.universeId.trim(),
    version: universe.version.trim(),
    asOf: universe.asOf,
    availableAt: universe.availableAt,
    selectionPolicyId: universe.selectionPolicyId.trim(),
    source: universe.source.trim(),
    constituents,
  };
}

export function researchUniverseFingerprint(universe: ResearchUniverseProvenance): string {
  validateResearchUniverseProvenance(universe);
  return sha256(canonical(normalizedUniverse(universe)));
}

export function assertResearchUniverseDatasetBinding(
  universe: ResearchUniverseProvenance,
  expected: { readonly market: string; readonly datasetId: string; readonly datasetContentSha256: string; readonly decisionAt: number },
): void {
  validateResearchUniverseProvenance(universe, { decisionAt: expected.decisionAt });
  const constituent = universe.constituents.find((item) => item.market === expected.market);
  if (constituent == null) throw new Error("UNIVERSE_DATASET_NOT_CONSTITUENT");
  if (constituent.datasetId !== expected.datasetId || constituent.datasetContentSha256 !== expected.datasetContentSha256) {
    throw new Error("UNIVERSE_DATASET_BINDING_MISMATCH");
  }
}

export function assertResearchUniverseDatasetSetBinding(
  universe: ResearchUniverseProvenance,
  manifests: readonly Readonly<{
    readonly market: string;
    readonly datasetId: string;
    readonly contentSha256: string;
    readonly startOpenTime: number;
    readonly endCloseTime: number;
  }>[],
  options: { readonly decisionAt: number },
): void {
  if (!Array.isArray(manifests) || manifests.length === 0) throw new Error("EMPTY_UNIVERSE_DATASET_SET");
  const selectionAt = Math.min(...manifests.map((manifest) => manifest.startOpenTime));
  validateResearchUniverseProvenance(universe, { decisionAt: options.decisionAt, selectionAt });
  if (universe.constituents.length !== manifests.length) throw new Error("UNIVERSE_DATASET_SET_MISMATCH");
  const manifestMarkets = new Set<string>();
  for (const manifest of manifests) {
    if (manifestMarkets.has(manifest.market)) throw new Error("DUPLICATE_UNIVERSE_DATASET_MARKET");
    manifestMarkets.add(manifest.market);
    const constituent = universe.constituents.find((item) => item.market === manifest.market);
    if (constituent == null) throw new Error("UNIVERSE_DATASET_NOT_CONSTITUENT");
    if (constituent.datasetId !== manifest.datasetId || constituent.datasetContentSha256 !== manifest.contentSha256) {
      throw new Error("UNIVERSE_DATASET_BINDING_MISMATCH");
    }
    if (constituent.eligibleFrom > manifest.startOpenTime) {
      throw new Error("SURVIVORSHIP_BIAS:constituent_not_eligible_at_period_start");
    }
    if (constituent.eligibleUntil != null && constituent.eligibleUntil <= manifest.endCloseTime) {
      throw new Error("SURVIVORSHIP_BIAS:constituent_not_eligible_for_full_period");
    }
  }
}

export function assertResearchUniverseReplay(
  expectedFingerprint: string,
  replayedUniverse: ResearchUniverseProvenance,
): void {
  if (researchUniverseFingerprint(replayedUniverse) !== expectedFingerprint) {
    throw new Error("UNIVERSE_REPLAY_NON_DETERMINISTIC");
  }
}

export function evidenceFingerprint(provenance: ResearchEvidenceProvenance, evidence: unknown): string {
  validateEvidenceProvenance(provenance);
  return sha256(canonical({ provenance, evidence }));
}

export function assertDeterministicReplay(expectedFingerprint: string, provenance: ResearchEvidenceProvenance, replayedEvidence: unknown): void {
  if (evidenceFingerprint(provenance, replayedEvidence) !== expectedFingerprint) throw new Error("REPLAY_NON_DETERMINISTIC");
}

export interface CurrentResearchDatasetIdentityInput {
  readonly manifest: HistoricalDatasetManifest;
  readonly freshness: UpbitCandleFreshness;
  readonly observedAt: number;
}

export interface CurrentResearchDatasetIdentity {
  readonly datasetId: string;
  readonly datasetFingerprint: string;
  readonly source: string;
  readonly market: string;
  readonly interval: string;
  readonly endCloseTime: number;
  readonly observedAt: number;
  readonly expectedLatestCloseTime: number;
  readonly actualLatestCloseTime: number;
  readonly lagIntervals: number;
  readonly fresh: true;
  readonly status: "CURRENT";
}

export function requireCurrentResearchDatasetIdentity(input: CurrentResearchDatasetIdentityInput): CurrentResearchDatasetIdentity {
  const manifest = input.manifest;
  const freshness = input.freshness;
  if (manifest == null || manifest.schemaVersion !== 1) throw new Error("INVALID_CURRENT_DATASET_IDENTITY:manifest");
  for (const key of ["datasetId", "source", "market", "interval"] as const) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) throw new Error(`INVALID_CURRENT_DATASET_IDENTITY:${key}`);
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.contentSha256)) throw new Error("INVALID_CURRENT_DATASET_IDENTITY:datasetFingerprint");
  if (freshness == null || freshness.source !== manifest.source || freshness.market !== manifest.market || freshness.interval !== manifest.interval) {
    throw new Error("CURRENT_DATASET_FRESHNESS_BINDING_MISMATCH");
  }
  for (const [key, value] of [
    ["endCloseTime", manifest.endCloseTime],
    ["observedAt", input.observedAt],
    ["freshnessAsOf", freshness.asOf],
    ["expectedLatestCloseTime", freshness.expectedLatestCloseTime],
    ["actualLatestCloseTime", freshness.actualLatestCloseTime],
    ["lagIntervals", freshness.lagIntervals],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_CURRENT_DATASET_IDENTITY:${key}`);
  }
  if (freshness.asOf !== input.observedAt) throw new Error("CURRENT_DATASET_FRESHNESS_ASOF_MISMATCH");
  if (freshness.actualLatestCloseTime !== manifest.endCloseTime) throw new Error("CURRENT_DATASET_OBSERVATION_MISMATCH");
  if (freshness.expectedLatestCloseTime > input.observedAt || freshness.actualLatestCloseTime > input.observedAt) throw new Error("CURRENT_DATASET_FUTURE_OBSERVATION");
  if (freshness.fresh !== true || freshness.lagIntervals !== 0 || freshness.actualLatestCloseTime !== freshness.expectedLatestCloseTime) {
    throw new Error("STALE_CURRENT_DATASET");
  }
  return Object.freeze({
    datasetId: manifest.datasetId,
    datasetFingerprint: manifest.contentSha256,
    source: manifest.source,
    market: manifest.market,
    interval: manifest.interval,
    endCloseTime: manifest.endCloseTime,
    observedAt: input.observedAt,
    expectedLatestCloseTime: freshness.expectedLatestCloseTime,
    actualLatestCloseTime: freshness.actualLatestCloseTime,
    lagIntervals: freshness.lagIntervals,
    fresh: true,
    status: "CURRENT",
  });
}
