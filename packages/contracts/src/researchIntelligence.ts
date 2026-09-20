import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

export type ResearchIntelligenceSourceType =
  | "ARXIV"
  | "SEMANTIC_SCHOLAR"
  | "OPENREVIEW"
  | "SSRN"
  | "GITHUB"
  | "INSTITUTION"
  | "EXCHANGE"
  | "JOURNAL"
  | "DATASET"
  | "OTHER";

export type ResearchIntelligenceNovelty =
  | "NEW"
  | "INCREMENTAL"
  | "DUPLICATE"
  | "CONTRADICTORY"
  | "REPLICATION"
  | "SUPERSEDED";

export type ResearchIntelligenceAvailability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export type ResearchIntelligenceReproducibility =
  | "NOT_ATTEMPTED"
  | "PARTIAL"
  | "REPRODUCED"
  | "FAILED"
  | "CONFLICTING";
export type ResearchIntelligenceEvidenceQuality =
  | "PRIMARY_SOURCE_CLAIM_ONLY"
  | "CODE_AVAILABLE_UNVERIFIED"
  | "REPRODUCED"
  | "INDEPENDENTLY_REPLICATED"
  | "CONTRADICTORY"
  | "INVALID";
export type ResearchIntelligenceRelevance = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type ResearchIntelligenceEstimate = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
export type ResearchIntelligenceSourceVerification =
  | "VERIFIED_PRIMARY_SOURCE"
  | "UNVERIFIED"
  | "REJECTED";
export type ResearchIntelligenceValidationStatus =
  | "DISCOVERED"
  | "SOURCE_VERIFIED"
  | "HOLD"
  | "ROUTED_TO_AXIOM"
  | "REJECTED";
export type ResearchIntelligenceHandoffStatus =
  | "NOT_READY"
  | "READY_FOR_AXIOM_REVIEW"
  | "ROUTED_TO_AXIOM_REVIEW"
  | "DUPLICATE_SUPPRESSED";

export interface ResearchIntelligenceAuthorityBoundary {
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ResearchIntelligenceSourceDefinition {
  readonly sourceType: ResearchIntelligenceSourceType;
  readonly sourceId: string;
  readonly baseUrl: string;
  readonly trustRole: "PRIMARY_SOURCE" | "DISCOVERY_ONLY";
  readonly defaultCadenceMinutes: number;
  readonly enabledByDefault: boolean;
}

export const CANONICAL_RESEARCH_INTELLIGENCE_SOURCES: readonly ResearchIntelligenceSourceDefinition[] =
  Object.freeze([
    Object.freeze({
      sourceType: "ARXIV" as const,
      sourceId: "arxiv",
      baseUrl: "https://export.arxiv.org",
      trustRole: "PRIMARY_SOURCE" as const,
      defaultCadenceMinutes: 720,
      enabledByDefault: true,
    }),
    Object.freeze({
      sourceType: "SEMANTIC_SCHOLAR" as const,
      sourceId: "semantic-scholar",
      baseUrl: "https://api.semanticscholar.org",
      trustRole: "PRIMARY_SOURCE" as const,
      defaultCadenceMinutes: 720,
      enabledByDefault: false,
    }),
    Object.freeze({
      sourceType: "OPENREVIEW" as const,
      sourceId: "openreview",
      baseUrl: "https://api2.openreview.net",
      trustRole: "PRIMARY_SOURCE" as const,
      defaultCadenceMinutes: 720,
      enabledByDefault: false,
    }),
    Object.freeze({
      sourceType: "SSRN" as const,
      sourceId: "ssrn",
      baseUrl: "https://www.ssrn.com",
      trustRole: "PRIMARY_SOURCE" as const,
      defaultCadenceMinutes: 720,
      enabledByDefault: false,
    }),
    Object.freeze({
      sourceType: "GITHUB" as const,
      sourceId: "github",
      baseUrl: "https://api.github.com",
      trustRole: "DISCOVERY_ONLY" as const,
      defaultCadenceMinutes: 180,
      enabledByDefault: false,
    }),
  ]);

export interface ResearchIntelligenceRecord extends ResearchIntelligenceAuthorityBoundary {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly sourceId: string;
  readonly sourceType: ResearchIntelligenceSourceType;
  readonly sourceUrl: string;
  readonly sourceVerification: ResearchIntelligenceSourceVerification;
  readonly title: string;
  readonly authors: readonly string[];
  readonly publishedAt: string;
  readonly discoveredAt: string;
  readonly rawContentSha256: string;
  readonly contentFingerprint: string;
  readonly hypothesisSemanticFingerprint?: string;
  readonly topic: readonly string[];
  readonly market: string;
  readonly timeframe: string;
  readonly method: string;
  readonly claimedContribution: string;
  readonly testableHypothesis: string;
  readonly assumptions: readonly string[];
  readonly requiredData: readonly string[];
  readonly codeAvailable: ResearchIntelligenceAvailability;
  readonly datasetAvailable: ResearchIntelligenceAvailability;
  readonly reproducibilityStatus: ResearchIntelligenceReproducibility;
  readonly novelty: ResearchIntelligenceNovelty;
  readonly evidenceQuality: ResearchIntelligenceEvidenceQuality;
  readonly nusaRelevance: ResearchIntelligenceRelevance;
  readonly implementationCost: ResearchIntelligenceEstimate;
  readonly expectedEconomicValue: ResearchIntelligenceEstimate;
  readonly leakageRisk: ResearchIntelligenceEstimate;
  readonly overfittingRisk: ResearchIntelligenceEstimate;
  readonly regimeDependence: ResearchIntelligenceEstimate;
  readonly transactionCostSensitivity: ResearchIntelligenceEstimate;
  readonly researchPriority: "UNSCORED_INSUFFICIENT_EVIDENCE";
  readonly validationStatus: ResearchIntelligenceValidationStatus;
  readonly failureReason?: string;
  readonly relatedExistingResearch: readonly string[];
  readonly axiomHandoffStatus: ResearchIntelligenceHandoffStatus;
}

export interface ResearchIntelligenceRecordInput {
  readonly sourceId: string;
  readonly sourceType: ResearchIntelligenceSourceType;
  readonly sourceUrl: string;
  readonly sourceVerification: ResearchIntelligenceSourceVerification;
  readonly title: string;
  readonly authors: readonly string[];
  readonly publishedAt: string;
  readonly discoveredAt: string;
  readonly rawContentSha256: string;
  readonly topic: readonly string[];
  readonly market: string;
  readonly timeframe: string;
  readonly method: string;
  readonly claimedContribution: string;
  readonly testableHypothesis: string;
  readonly assumptions: readonly string[];
  readonly requiredData: readonly string[];
  readonly codeAvailable?: ResearchIntelligenceAvailability;
  readonly datasetAvailable?: ResearchIntelligenceAvailability;
  readonly reproducibilityStatus?: ResearchIntelligenceReproducibility;
  readonly novelty?: ResearchIntelligenceNovelty;
  readonly evidenceQuality?: ResearchIntelligenceEvidenceQuality;
  readonly nusaRelevance?: ResearchIntelligenceRelevance;
  readonly implementationCost?: ResearchIntelligenceEstimate;
  readonly expectedEconomicValue?: ResearchIntelligenceEstimate;
  readonly leakageRisk?: ResearchIntelligenceEstimate;
  readonly overfittingRisk?: ResearchIntelligenceEstimate;
  readonly regimeDependence?: ResearchIntelligenceEstimate;
  readonly transactionCostSensitivity?: ResearchIntelligenceEstimate;
  readonly validationStatus?: ResearchIntelligenceValidationStatus;
  readonly failureReason?: string;
  readonly relatedExistingResearch?: readonly string[];
  readonly axiomHandoffStatus?: ResearchIntelligenceHandoffStatus;
}

export interface AxiomResearchIntelligenceHandoff extends ResearchIntelligenceAuthorityBoundary {
  readonly schemaVersion: 1;
  readonly handoffId: string;
  readonly sourceRecordId: string;
  readonly sourceContentFingerprint: string;
  readonly testableHypothesis: string;
  readonly hypothesisSemanticFingerprint: string;
  readonly sourceReferences: readonly string[];
  readonly assumptions: readonly string[];
  readonly requiredData: readonly string[];
  readonly market: string;
  readonly timeframe: string;
  readonly method: string;
  readonly novelty: ResearchIntelligenceNovelty;
  readonly integrityChecksRequired: readonly (
    | "POINT_IN_TIME"
    | "LOOKAHEAD_LEAKAGE"
    | "SURVIVORSHIP"
    | "PROVENANCE"
    | "REPRODUCIBILITY"
    | "TRANSACTION_COSTS"
  )[];
  readonly requiresCanonicalValidation: true;
  readonly strategyPromotionAllowed: false;
  readonly paperAllocationAllowed: false;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const ID = /^[A-Za-z0-9._:/-]{1,256}$/;

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
}

function requireText(value: string, field: string, maxLength = 20_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(field + " is invalid");
  return normalized;
}

function requireIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(field + " must be an ISO timestamp");
  return new Date(value).toISOString();
}

function requireHttps(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("sourceUrl must be a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("sourceUrl must use HTTPS");
  url.hash = "";
  return url.toString();
}

function freezeArray(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value) => requireText(value, field, 4_000));
  return Object.freeze([...new Set(normalized)].sort((left, right) => left.localeCompare(right)));
}

function normalizeSemanticText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function researchIntelligenceHypothesisSemanticFingerprint(input: {
  readonly testableHypothesis: string;
  readonly market: string;
  readonly timeframe: string;
  readonly method: string;
}): string {
  return sha256({
    testableHypothesis: normalizeSemanticText(requireText(input.testableHypothesis, "testableHypothesis")),
    market: normalizeSemanticText(requireText(input.market, "market", 512)),
    timeframe: normalizeSemanticText(requireText(input.timeframe, "timeframe", 512)),
    method: normalizeSemanticText(requireText(input.method, "method", 2_000)),
  });
}

export function createResearchIntelligenceRecord(
  input: ResearchIntelligenceRecordInput,
): ResearchIntelligenceRecord {
  if (!ID.test(input.sourceId)) throw new Error("sourceId is invalid");
  if (!SHA256.test(input.rawContentSha256)) throw new Error("rawContentSha256 must be SHA-256");
  const sourceUrl = requireHttps(input.sourceUrl);
  const publishedAt = requireIso(input.publishedAt, "publishedAt");
  const discoveredAt = requireIso(input.discoveredAt, "discoveredAt");
  if (Date.parse(publishedAt) > Date.parse(discoveredAt)) {
    throw new Error("publishedAt cannot be after discoveredAt");
  }

  const title = requireText(input.title, "title", 2_000);
  const authors = freezeArray(input.authors, "authors");
  const topic = freezeArray(input.topic, "topic");
  const assumptions = freezeArray(input.assumptions, "assumptions");
  const requiredData = freezeArray(input.requiredData, "requiredData");
  const relatedExistingResearch = freezeArray(
    input.relatedExistingResearch ?? [],
    "relatedExistingResearch",
  );
  const market = requireText(input.market, "market", 512);
  const timeframe = requireText(input.timeframe, "timeframe", 512);
  const method = requireText(input.method, "method", 2_000);
  const claimedContribution = requireText(
    input.claimedContribution,
    "claimedContribution",
    20_000,
  );
  const testableHypothesis = requireText(input.testableHypothesis, "testableHypothesis", 8_000);
  const hypothesisSemanticFingerprint = researchIntelligenceHypothesisSemanticFingerprint({
    testableHypothesis,
    market,
    timeframe,
    method,
  });
  const contentFingerprint = sha256({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceUrl,
    rawContentSha256: input.rawContentSha256.toLowerCase(),
  });
  const recordId = "ri:" + sha256({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    contentFingerprint,
  });

  return Object.freeze({
    schemaVersion: 1 as const,
    recordId,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    sourceUrl,
    sourceVerification: input.sourceVerification,
    title,
    authors,
    publishedAt,
    discoveredAt,
    rawContentSha256: input.rawContentSha256.toLowerCase(),
    contentFingerprint,
    hypothesisSemanticFingerprint,
    topic,
    market,
    timeframe,
    method,
    claimedContribution,
    testableHypothesis,
    assumptions,
    requiredData,
    codeAvailable: input.codeAvailable ?? "UNKNOWN",
    datasetAvailable: input.datasetAvailable ?? "UNKNOWN",
    reproducibilityStatus: input.reproducibilityStatus ?? "NOT_ATTEMPTED",
    novelty: input.novelty ?? "NEW",
    evidenceQuality: input.evidenceQuality ?? "PRIMARY_SOURCE_CLAIM_ONLY",
    nusaRelevance: input.nusaRelevance ?? "UNKNOWN",
    implementationCost: input.implementationCost ?? "UNKNOWN",
    expectedEconomicValue: input.expectedEconomicValue ?? "UNKNOWN",
    leakageRisk: input.leakageRisk ?? "UNKNOWN",
    overfittingRisk: input.overfittingRisk ?? "UNKNOWN",
    regimeDependence: input.regimeDependence ?? "UNKNOWN",
    transactionCostSensitivity: input.transactionCostSensitivity ?? "UNKNOWN",
    researchPriority: "UNSCORED_INSUFFICIENT_EVIDENCE" as const,
    validationStatus: input.validationStatus ?? (
      input.sourceVerification === "VERIFIED_PRIMARY_SOURCE" ? "SOURCE_VERIFIED" : "DISCOVERED"
    ),
    ...(input.failureReason == null ? {} : {
      failureReason: requireText(input.failureReason, "failureReason", 4_000),
    }),
    relatedExistingResearch,
    axiomHandoffStatus: input.axiomHandoffStatus ?? "NOT_READY",
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

export function classifyResearchIntelligenceRelation(
  candidate: ResearchIntelligenceRecord,
  existing: readonly ResearchIntelligenceRecord[],
): {
  readonly novelty: ResearchIntelligenceNovelty;
  readonly relatedExistingResearch: readonly string[];
} {
  const sameSource = existing.filter(
    (record) => record.sourceType === candidate.sourceType && record.sourceId === candidate.sourceId,
  );
  if (sameSource.some((record) => record.contentFingerprint === candidate.contentFingerprint)) {
    return Object.freeze({
      novelty: "DUPLICATE" as const,
      relatedExistingResearch: Object.freeze(
        sameSource
          .filter((record) => record.contentFingerprint === candidate.contentFingerprint)
          .map((record) => record.recordId)
          .sort(),
      ),
    });
  }
  if (sameSource.length > 0) {
    return Object.freeze({
      novelty: "INCREMENTAL" as const,
      relatedExistingResearch: Object.freeze(sameSource.map((record) => record.recordId).sort()),
    });
  }

  const replication = existing.filter(
    (record) =>
      record.hypothesisSemanticFingerprint === candidate.hypothesisSemanticFingerprint &&
      record.sourceId !== candidate.sourceId,
  );
  if (replication.length > 0) {
    return Object.freeze({
      novelty: "REPLICATION" as const,
      relatedExistingResearch: Object.freeze(replication.map((record) => record.recordId).sort()),
    });
  }

  return Object.freeze({
    novelty: "NEW" as const,
    relatedExistingResearch: Object.freeze([]),
  });
}

export function reclassifyResearchIntelligenceRecord(
  record: ResearchIntelligenceRecord,
  classification: ReturnType<typeof classifyResearchIntelligenceRelation>,
): ResearchIntelligenceRecord {
  return Object.freeze({
    ...record,
    novelty: classification.novelty,
    relatedExistingResearch: classification.relatedExistingResearch,
    axiomHandoffStatus:
      classification.novelty === "DUPLICATE"
        ? "DUPLICATE_SUPPRESSED"
        : record.axiomHandoffStatus,
  });
}

export function createAxiomResearchIntelligenceHandoff(
  record: ResearchIntelligenceRecord,
): AxiomResearchIntelligenceHandoff {
  if (record.sourceVerification !== "VERIFIED_PRIMARY_SOURCE") {
    throw new Error("AXIOM handoff requires verified primary-source provenance");
  }
  if (record.novelty === "DUPLICATE") {
    throw new Error("duplicate research must not be handed to AXIOM again");
  }
  if (record.evidenceQuality === "INVALID") {
    throw new Error("invalid research evidence must not be handed to AXIOM");
  }
  if (!record.hypothesisSemanticFingerprint) {
    throw new Error("AXIOM handoff requires a testable hypothesis fingerprint");
  }

  const integrityChecksRequired = Object.freeze([
    "POINT_IN_TIME" as const,
    "LOOKAHEAD_LEAKAGE" as const,
    "SURVIVORSHIP" as const,
    "PROVENANCE" as const,
    "REPRODUCIBILITY" as const,
    "TRANSACTION_COSTS" as const,
  ]);
  const handoffId = "axiom-ri:" + sha256({
    sourceRecordId: record.recordId,
    sourceContentFingerprint: record.contentFingerprint,
    hypothesisSemanticFingerprint: record.hypothesisSemanticFingerprint,
    integrityChecksRequired,
  });

  return Object.freeze({
    schemaVersion: 1 as const,
    handoffId,
    sourceRecordId: record.recordId,
    sourceContentFingerprint: record.contentFingerprint,
    testableHypothesis: record.testableHypothesis,
    hypothesisSemanticFingerprint: record.hypothesisSemanticFingerprint,
    sourceReferences: Object.freeze([record.sourceUrl]),
    assumptions: record.assumptions,
    requiredData: record.requiredData,
    market: record.market,
    timeframe: record.timeframe,
    method: record.method,
    novelty: record.novelty,
    integrityChecksRequired,
    requiresCanonicalValidation: true as const,
    strategyPromotionAllowed: false as const,
    paperAllocationAllowed: false as const,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}
