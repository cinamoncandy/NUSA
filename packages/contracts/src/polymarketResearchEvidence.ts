import { researchHardeningHash } from "./researchHardening";

export const POLYMARKET_RESEARCH_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type PolymarketDataHealth = "LIVE" | "LAGGED" | "STALE" | "FALLBACK" | "OUTAGE";
export type PolymarketResearchEligibility = "ELIGIBLE" | "INSUFFICIENT";
export type PolymarketTransport = "CLOB_WS" | "CLOB_REST" | "DATA_API" | "POLYGON";

export type PolymarketEvidenceReasonCode =
  | "MISSING_SOURCE_IDENTITY"
  | "MISSING_MARKET_IDENTITY"
  | "INVALID_DATA_HEALTH"
  | "DATA_HEALTH_LAGGED"
  | "DATA_HEALTH_STALE"
  | "DATA_HEALTH_FALLBACK"
  | "DATA_HEALTH_OUTAGE"
  | "INVALID_OBSERVATION_TIME"
  | "INVALID_EVALUATION_TIME"
  | "INVALID_STALE_WINDOW"
  | "OBSERVATION_IN_FUTURE"
  | "OBSERVATION_STALE"
  | "INVALID_PROVENANCE_HASH"
  | "PROVENANCE_TIME_MISMATCH"
  | "INVALID_CAPTURE_TIME"
  | "MISSING_RELEVANCE"
  | "INVALID_RELEVANCE"
  | "INVALID_RELEVANCE_HASH"
  | "MISSING_FEATURES"
  | "INVALID_FEATURE_NAME"
  | "INVALID_FEATURE_VALUE";

export interface PolymarketResearchSourceInput {
  readonly sourceId: string;
  readonly transport: PolymarketTransport;
  readonly health: PolymarketDataHealth;
}

export interface PolymarketResearchProvenanceInput {
  readonly sourceContentSha256: string;
  readonly sourceObservedAt: number;
  readonly capturedAt: number;
}

export interface PolymarketAssetRelevanceInput {
  readonly asset: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly ruleHash: string;
}

export interface PolymarketResearchEvidenceInput {
  readonly source: PolymarketResearchSourceInput;
  readonly marketId: string;
  readonly eventId?: string;
  readonly observedAt: number;
  readonly evaluationTimestamp: number;
  readonly staleWindowMs: number;
  readonly provenance: PolymarketResearchProvenanceInput;
  readonly relevance?: PolymarketAssetRelevanceInput;
  readonly features: Readonly<Record<string, unknown>>;
}

export interface PolymarketResearchSource {
  readonly kind: "POLYMARKET_PUBLIC";
  readonly sourceId: string;
  readonly transport: PolymarketTransport;
  readonly health: PolymarketDataHealth;
}

export interface PolymarketResearchProvenance {
  readonly sourceContentSha256: string;
  readonly sourceObservedAt: number;
  readonly capturedAt: number;
}

export interface PolymarketAssetRelevance {
  readonly asset: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly ruleHash: string;
}

export interface PolymarketResearchEvidence {
  readonly schemaVersion: typeof POLYMARKET_RESEARCH_EVIDENCE_SCHEMA_VERSION;
  readonly source: PolymarketResearchSource;
  readonly marketId: string;
  readonly eventId?: string;
  readonly observedAt: number;
  readonly evaluationTimestamp: number;
  readonly staleWindowMs: number;
  readonly provenance: PolymarketResearchProvenance;
  readonly relevance: PolymarketAssetRelevance | null;
  readonly features: Readonly<Record<string, number | null>>;
  readonly eligibility: PolymarketResearchEligibility;
  readonly reasonCodes: readonly PolymarketEvidenceReasonCode[];
  readonly researchOnly: true;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly orderExecutionAllowed: false;
  readonly evidenceHash: string;
}

const DATA_HEALTH_VALUES = new Set<PolymarketDataHealth>(["LIVE", "LAGGED", "STALE", "FALLBACK", "OUTAGE"]);
const SHA256 = /^[a-f0-9]{64}$/i;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeFeatures(
  input: Readonly<Record<string, unknown>>,
  reasons: PolymarketEvidenceReasonCode[],
): Readonly<Record<string, number | null>> {
  const entries = Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) reasons.push("MISSING_FEATURES");

  const normalized: Record<string, number | null> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!key) {
      reasons.push("INVALID_FEATURE_NAME");
      continue;
    }
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      reasons.push("INVALID_FEATURE_VALUE");
      normalized[key] = null;
      continue;
    }
    normalized[key] = Object.is(rawValue, -0) ? 0 : rawValue;
  }

  if (Object.keys(normalized).length === 0) reasons.push("MISSING_FEATURES");
  return Object.freeze(normalized);
}

function normalizeRelevance(
  input: PolymarketAssetRelevanceInput | undefined,
  reasons: PolymarketEvidenceReasonCode[],
): PolymarketAssetRelevance | null {
  if (input === undefined) {
    reasons.push("MISSING_RELEVANCE");
    return null;
  }

  const relevance = Object.freeze({
    asset: normalizeText(input.asset),
    ruleId: normalizeText(input.ruleId),
    ruleVersion: normalizeText(input.ruleVersion),
    ruleHash: normalizeText(input.ruleHash).toLowerCase(),
  });
  if (!hasText(relevance.asset) || !hasText(relevance.ruleId) || !hasText(relevance.ruleVersion)) reasons.push("INVALID_RELEVANCE");
  if (!SHA256.test(relevance.ruleHash)) reasons.push("INVALID_RELEVANCE_HASH");
  return relevance;
}

function dataHealthReason(health: unknown): PolymarketEvidenceReasonCode | null {
  switch (health) {
    case "LIVE": return null;
    case "LAGGED": return "DATA_HEALTH_LAGGED";
    case "STALE": return "DATA_HEALTH_STALE";
    case "FALLBACK": return "DATA_HEALTH_FALLBACK";
    case "OUTAGE": return "DATA_HEALTH_OUTAGE";
    default: return "INVALID_DATA_HEALTH";
  }
}

export function adaptPolymarketResearchEvidence(input: PolymarketResearchEvidenceInput): PolymarketResearchEvidence {
  const reasons: PolymarketEvidenceReasonCode[] = [];
  const sourceId = normalizeText(input.source.sourceId);
  const marketId = normalizeText(input.marketId);
  const eventId = input.eventId === undefined ? undefined : normalizeText(input.eventId);

  if (!sourceId) reasons.push("MISSING_SOURCE_IDENTITY");
  if (!marketId) reasons.push("MISSING_MARKET_IDENTITY");

  const healthReason = dataHealthReason(input.source.health);
  if (healthReason !== null) reasons.push(healthReason);

  const observedAtValid = isSafeTimestamp(input.observedAt);
  const evaluationTimestampValid = isSafeTimestamp(input.evaluationTimestamp);
  const staleWindowValid = Number.isSafeInteger(input.staleWindowMs) && input.staleWindowMs > 0;
  if (!observedAtValid) reasons.push("INVALID_OBSERVATION_TIME");
  if (!evaluationTimestampValid) reasons.push("INVALID_EVALUATION_TIME");
  if (!staleWindowValid) reasons.push("INVALID_STALE_WINDOW");
  if (observedAtValid && evaluationTimestampValid) {
    if (input.observedAt > input.evaluationTimestamp) reasons.push("OBSERVATION_IN_FUTURE");
    if (staleWindowValid && input.evaluationTimestamp - input.observedAt > input.staleWindowMs) reasons.push("OBSERVATION_STALE");
  }

  const sourceContentSha256 = normalizeText(input.provenance.sourceContentSha256).toLowerCase();
  if (!SHA256.test(sourceContentSha256)) reasons.push("INVALID_PROVENANCE_HASH");
  if (!isSafeTimestamp(input.provenance.sourceObservedAt) || input.provenance.sourceObservedAt !== input.observedAt) reasons.push("PROVENANCE_TIME_MISMATCH");
  if (
    !isSafeTimestamp(input.provenance.capturedAt)
    || (observedAtValid && input.provenance.capturedAt < input.observedAt)
    || (evaluationTimestampValid && input.provenance.capturedAt > input.evaluationTimestamp)
  ) reasons.push("INVALID_CAPTURE_TIME");

  const sourceHealth = DATA_HEALTH_VALUES.has(input.source.health) ? input.source.health : "OUTAGE";
  const source = Object.freeze({
    kind: "POLYMARKET_PUBLIC" as const,
    sourceId,
    transport: input.source.transport,
    health: sourceHealth,
  });
  const provenance = Object.freeze({
    sourceContentSha256,
    sourceObservedAt: input.provenance.sourceObservedAt,
    capturedAt: input.provenance.capturedAt,
  });
  const relevance = normalizeRelevance(input.relevance, reasons);
  const features = normalizeFeatures(input.features, reasons);
  const reasonCodes = Object.freeze([...new Set(reasons)].sort()) as readonly PolymarketEvidenceReasonCode[];

  const unsigned = {
    schemaVersion: POLYMARKET_RESEARCH_EVIDENCE_SCHEMA_VERSION,
    source,
    marketId,
    eventId,
    observedAt: input.observedAt,
    evaluationTimestamp: input.evaluationTimestamp,
    staleWindowMs: input.staleWindowMs,
    provenance,
    relevance,
    features,
    eligibility: reasonCodes.length === 0 ? "ELIGIBLE" as const : "INSUFFICIENT" as const,
    reasonCodes,
    researchOnly: true as const,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
    orderExecutionAllowed: false as const,
  };

  return Object.freeze({ ...unsigned, evidenceHash: researchHardeningHash(unsigned) });
}

export const PolymarketResearchEvidenceAdapter = Object.freeze({
  adapt: adaptPolymarketResearchEvidence,
});
