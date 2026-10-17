import { createHash } from "node:crypto";

export type ResearchInterval = "1m" | "3m" | "5m" | "10m" | "15m" | "30m" | "60m" | "240m" | "1d";
export type CandleContinuityStatus = "CONTIGUOUS" | "MISSING_INTERVALS" | "IRREGULAR_INTERVAL" | "DUPLICATE" | "OVERLAP";
export type MissingCandlePolicy = "REJECT" | "ALLOW";

export interface CanonicalResearchCandle {
  readonly market: string;
  readonly interval: ResearchInterval;
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly quoteVolume?: number;
  readonly tradeCount?: number;
}

export interface MissingCandleRange { readonly afterCloseTime: number; readonly beforeOpenTime: number; readonly missingIntervals: number; }
export interface ResearchDatasetValidation { readonly candles: readonly CanonicalResearchCandle[]; readonly continuityStatus: CandleContinuityStatus; readonly missingCandleCount: number; readonly missingRanges: readonly MissingCandleRange[]; readonly warnings: readonly string[]; }

/**
 * Material provenance that must change whenever any transformation, contract, quality evidence,
 * derived lineage or replay environment capable of changing dataset semantics changes.
 * Every field is a full SHA-256 fingerprint so the manifest binds identities without embedding
 * mutable source documents. rawSourceIdentitySha256s is canonicalized by sorting before hashing.
 */
export interface ResearchDatasetProvenanceV2 {
  readonly rawSourceIdentitySha256s: readonly string[];
  readonly transformationGraphSha256: string;
  readonly transformationConfigSha256: string;
  readonly schemaContractSha256: string;
  readonly qualitySuiteSha256: string;
  readonly qualityResultsSha256: string;
  readonly derivedFeatureLineageSha256: string;
  readonly replayRuntimeSha256: string;
}

export interface HistoricalDatasetManifest {
  readonly schemaVersion: 1 | 2;
  readonly datasetId: string;
  readonly source: string;
  readonly market: string;
  readonly interval: ResearchInterval;
  readonly candleCount: number;
  readonly startOpenTime: number;
  readonly endCloseTime: number;
  readonly timezone: "UTC";
  readonly ordering: "OPEN_TIME_ASC";
  readonly missingCandlePolicy: MissingCandlePolicy;
  readonly missingCandleCount: number;
  readonly createdAt: string;
  readonly contentSha256: string;
  readonly sourceRequest?: string;
  readonly notes?: string;
  /** Required when schemaVersion === 2; absent for immutable historical v1 manifests. */
  readonly provenance?: ResearchDatasetProvenanceV2;
}
export interface CreateManifestOptions { readonly source: string; readonly allowMissing?: boolean; readonly createdAt?: string; readonly sourceRequest?: string; readonly notes?: string; }

const SHA256 = /^[a-f0-9]{64}$/;

function canonicalCandle(candle: CanonicalResearchCandle): Record<string, string | number> {
  const output: Record<string, string | number> = { market: candle.market, interval: candle.interval, openTime: candle.openTime, closeTime: candle.closeTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
  if (candle.quoteVolume != null) output.quoteVolume = candle.quoteVolume;
  if (candle.tradeCount != null) output.tradeCount = candle.tradeCount;
  return output;
}

export function canonicalSerializeResearchCandles(candles: readonly CanonicalResearchCandle[]): string {
  return JSON.stringify(candles.map(canonicalCandle));
}

export function calculateResearchCandleSha256(candles: readonly CanonicalResearchCandle[]): string {
  return createHash("sha256").update(canonicalSerializeResearchCandles(candles), "utf8").digest("hex");
}

function requireSha256(value: string, field: string): string {
  if (!SHA256.test(value)) throw new Error(`invalid ${field}: expected lowercase sha256`);
  return value;
}

export function canonicalSerializeResearchDatasetProvenanceV2(provenance: ResearchDatasetProvenanceV2): string {
  if (!Array.isArray(provenance.rawSourceIdentitySha256s) || provenance.rawSourceIdentitySha256s.length === 0) throw new Error("invalid rawSourceIdentitySha256s: at least one source identity is required");
  const rawSourceIdentitySha256s = [...provenance.rawSourceIdentitySha256s].map((value) => requireSha256(value, "rawSourceIdentitySha256s")).sort();
  if (new Set(rawSourceIdentitySha256s).size !== rawSourceIdentitySha256s.length) throw new Error("invalid rawSourceIdentitySha256s: duplicate source identity");
  return JSON.stringify({
    rawSourceIdentitySha256s,
    transformationGraphSha256: requireSha256(provenance.transformationGraphSha256, "transformationGraphSha256"),
    transformationConfigSha256: requireSha256(provenance.transformationConfigSha256, "transformationConfigSha256"),
    schemaContractSha256: requireSha256(provenance.schemaContractSha256, "schemaContractSha256"),
    qualitySuiteSha256: requireSha256(provenance.qualitySuiteSha256, "qualitySuiteSha256"),
    qualityResultsSha256: requireSha256(provenance.qualityResultsSha256, "qualityResultsSha256"),
    derivedFeatureLineageSha256: requireSha256(provenance.derivedFeatureLineageSha256, "derivedFeatureLineageSha256"),
    replayRuntimeSha256: requireSha256(provenance.replayRuntimeSha256, "replayRuntimeSha256"),
  });
}

export function calculateResearchDatasetProvenanceSha256(provenance: ResearchDatasetProvenanceV2): string {
  return createHash("sha256").update(canonicalSerializeResearchDatasetProvenanceV2(provenance), "utf8").digest("hex");
}

function datasetIdPrefix(source: string, candles: readonly CanonicalResearchCandle[]): string {
  if (candles.length === 0) throw new Error("cannot calculate dataset identity for an empty candle set");
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const datePart = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "");
  return `${source.replace(/[^a-zA-Z0-9]+/g, "-")}_${first.market.replace(/[^a-zA-Z0-9]+/g, "-")}_${first.interval}_${datePart(first.openTime)}_${datePart(last.closeTime)}`;
}

/** Legacy v1 identity. Kept unchanged so historical manifests are never rewritten. */
export function calculateResearchDatasetId(source: string, candles: readonly CanonicalResearchCandle[], contentSha256: string): string {
  return `${datasetIdPrefix(source, candles)}_${contentSha256.slice(0, 12)}`;
}

/**
 * v2 identity binds candle bytes and all material transitive provenance. Equal candle bytes are
 * deliberately insufficient for identity equality when transformation/quality/replay semantics differ.
 */
export function calculateResearchDatasetIdV2(source: string, candles: readonly CanonicalResearchCandle[], contentSha256: string, provenance: ResearchDatasetProvenanceV2): string {
  requireSha256(contentSha256, "contentSha256");
  const provenanceSha256 = calculateResearchDatasetProvenanceSha256(provenance);
  return `${datasetIdPrefix(source, candles)}_v2_${contentSha256.slice(0, 12)}_${provenanceSha256.slice(0, 12)}`;
}
