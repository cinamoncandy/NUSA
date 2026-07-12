import { createHash } from "node:crypto";

export type DataSource = "MARKET" | "MACRO" | "NEWS" | "ONCHAIN" | "ETF" | "FUNDING" | "OI" | "RISK";

export interface RawObservation {
  readonly id: string;
  readonly source: DataSource;
  readonly symbol: string;
  readonly feature: string;
  readonly value: number;
  readonly observedAt: number;
  readonly cadenceMs: number;
  readonly unit: string;
  readonly provider: string;
}

export interface FeaturePoint {
  readonly key: string;
  readonly source: DataSource;
  readonly symbol: string;
  readonly feature: string;
  readonly value: number;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly quality: "GOOD" | "STALE" | "REJECTED";
  readonly provenanceHash: string;
}

export interface FeaturePipelineResult {
  readonly features: readonly FeaturePoint[];
  readonly rejectedObservationIds: readonly string[];
  readonly fingerprint: string;
  readonly generatedAt: number;
}

const canonical = (value: unknown): string => JSON.stringify(value);
const hash = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");

export function buildFeaturePipeline(now: number, observations: readonly RawObservation[], maxCadenceMultiplier = 3): FeaturePipelineResult {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative safe integer");
  if (!Number.isFinite(maxCadenceMultiplier) || maxCadenceMultiplier < 1) throw new Error("maxCadenceMultiplier must be at least 1");

  const ids = new Set<string>();
  const keys = new Set<string>();
  const accepted: FeaturePoint[] = [];
  const rejected: string[] = [];

  for (const item of [...observations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!item.id.trim()) throw new Error("observation.id is required");
    if (ids.has(item.id)) throw new Error(`duplicate observation id: ${item.id}`);
    ids.add(item.id);
    if (!item.symbol.trim() || !item.feature.trim() || !item.unit.trim() || !item.provider.trim()) throw new Error(`observation metadata is incomplete: ${item.id}`);
    if (!Number.isFinite(item.value)) {
      rejected.push(item.id);
      continue;
    }
    if (!Number.isSafeInteger(item.observedAt) || item.observedAt < 0 || item.observedAt > now) throw new Error(`observation timestamp is invalid: ${item.id}`);
    if (!Number.isSafeInteger(item.cadenceMs) || item.cadenceMs <= 0) throw new Error(`observation cadence is invalid: ${item.id}`);

    const symbol = item.symbol.trim().toUpperCase();
    const feature = item.feature.trim();
    const key = `${symbol}|${item.source}|${feature}`;
    if (keys.has(key)) throw new Error(`duplicate feature key: ${key}`);
    keys.add(key);

    const expiresAt = item.observedAt + Math.round(item.cadenceMs * maxCadenceMultiplier);
    const quality: FeaturePoint["quality"] = expiresAt < now ? "STALE" : "GOOD";
    const provenanceHash = hash({ cadenceMs: item.cadenceMs, feature, provider: item.provider.trim(), source: item.source, symbol, unit: item.unit.trim() });
    accepted.push(Object.freeze({ key, source: item.source, symbol, feature, value: item.value, observedAt: item.observedAt, expiresAt, quality, provenanceHash }));
  }

  const semanticFingerprint = hash(accepted.map((item) => ({ key: item.key, provenanceHash: item.provenanceHash })));
  return Object.freeze({
    features: Object.freeze(accepted),
    rejectedObservationIds: Object.freeze(rejected),
    fingerprint: semanticFingerprint,
    generatedAt: now
  });
}
