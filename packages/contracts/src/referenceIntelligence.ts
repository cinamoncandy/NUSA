import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

export type ReferenceIntelligenceSourceType =
  | "PAPER"
  | "OPEN_SOURCE"
  | "COMMERCIAL_PRODUCT"
  | "MODEL"
  | "DOCUMENTATION"
  | "BENCHMARK"
  | "VIDEO"
  | "BLOG"
  | "OTHER";

export type ReferenceIntelligenceCategory =
  | "AI_PLATFORM"
  | "AGENT_SYSTEM"
  | "DEVELOPER_AUTOMATION"
  | "TRADING_RESEARCH"
  | "STRATEGY"
  | "PORTFOLIO_RISK"
  | "MARKET_DATA"
  | "DATA_INTEGRITY"
  | "OBSERVABILITY_SRE"
  | "LEDGER_PERFORMANCE"
  | "UI_UX"
  | "INTEGRATION_E2E"
  | "RELEASE_AUDIT"
  | "SYSTEM_ARCHITECTURE";

export type ReferenceCanonicalOwner =
  | "CORE"
  | "EVOLVE"
  | "AUTOPILOT"
  | "RESEARCH_INTELLIGENCE_AXIOM"
  | "STRATEGY_FAMILY"
  | "PORTFOLIO_RISK"
  | "MARKET_DATA"
  | "DATA_RESEARCH_INTEGRITY"
  | "OBSERVABILITY_SRE"
  | "AI_PLATFORM_MODEL_ROUTER"
  | "LEDGER_PERFORMANCE_EVIDENCE"
  | "UIUX"
  | "INTEGRATION_E2E"
  | "RELEASE_AUDIT";

export type ReferenceEvidenceStrength =
  | "CLAIM_ONLY"
  | "PRIMARY_SOURCE"
  | "INDEPENDENT_SUPPORT"
  | "NUSA_REPRODUCED";

export type ReferenceEstimate = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type ReferenceComparisonDimension =
  | "VERIFIED_USEFUL_OUTCOME_TIME"
  | "OWNER_PERCEIVED_LATENCY"
  | "COST_PER_VERIFIED_RESULT"
  | "AUTONOMY"
  | "BOUNDED_RECOVERY"
  | "EVIDENCE_INTEGRITY"
  | "REPRODUCIBILITY"
  | "OBSERVABILITY"
  | "CONFLICT_RATE"
  | "REWORK_RATE"
  | "STALE_WORK_RATE"
  | "HUMAN_INTERVENTION"
  | "SAFETY_AUTHORITY_SEPARATION"
  | "ECONOMIC_OUTCOME_QUALITY"
  | "INFORMATION_CLARITY"
  | "MOBILE_USABILITY"
  | "OTHER";

export type ReferenceComparisonVerdict =
  | "REFERENCE_BETTER"
  | "NUSA_BETTER"
  | "PARITY"
  | "UNKNOWN";

export interface ReferenceComparisonEvidence {
  readonly dimension: ReferenceComparisonDimension;
  readonly verdict: ReferenceComparisonVerdict;
  readonly evidenceRefs: readonly string[];
  readonly note: string;
}

export type ReferenceExpectedValueDimension =
  | "ECONOMIC"
  | "PERFORMANCE"
  | "LATENCY"
  | "COST"
  | "AUTONOMY"
  | "RELIABILITY"
  | "SAFETY"
  | "UX"
  | "REUSABILITY";

export interface ReferenceIntelligenceAuthorityBoundary {
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ReferenceIntelligenceInput {
  readonly sourceType: ReferenceIntelligenceSourceType;
  readonly sourceLocator: string;
  readonly sourceUrl?: string;
  readonly sourceVersion: string;
  readonly discoveredAt: string;
  readonly sourcePublishedAt?: string;
  readonly category: ReferenceIntelligenceCategory;
  readonly title: string;
  readonly description: string;
  readonly claimedAdvantage: string;
  readonly evidenceStrength: ReferenceEvidenceStrength;
  readonly evidenceRefs: readonly string[];
  readonly comparisons: readonly ReferenceComparisonEvidence[];
  readonly principleToAbsorb: readonly string[];
  readonly doNotAbsorb: readonly string[];
  readonly nusaGap: readonly string[];
  readonly rootCause: readonly string[];
  readonly proposedImprovement: readonly string[];
  readonly canonicalOwner: ReferenceCanonicalOwner;
  readonly validationProposal: readonly string[];
  readonly measurement: readonly string[];
  readonly expectedValueDimensions: readonly ReferenceExpectedValueDimension[];
  readonly expectedValueMagnitude: ReferenceEstimate;
  readonly implementationCost: ReferenceEstimate;
  readonly regressionRisk: ReferenceEstimate;
  readonly remainingUncertainty: readonly string[];
  readonly relatedReferenceIds?: readonly string[];
}

export interface ReferenceIntelligenceRecord extends ReferenceIntelligenceInput, ReferenceIntelligenceAuthorityBoundary {
  readonly schemaVersion: 1;
  readonly referenceId: string;
  readonly identityFingerprint: string;
  readonly priorityScore: "UNSCORED_EVIDENCE_BOUND";
}

const TEXT_MAX = 20_000;
const IDENTITY_PREFIX = "refi:";

function requireText(value: string, field: string, max = TEXT_MAX): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(field + " is invalid");
  return normalized;
}

function optionalHttps(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("sourceUrl must use HTTPS");
  url.hash = "";
  return url.toString();
}

function requireIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(field + " must be an ISO timestamp");
  return new Date(value).toISOString();
}

function uniqueText(values: readonly string[], field: string): readonly string[] {
  return Object.freeze(
    [...new Set(values.map((value) => requireText(value, field, 4_000)))].sort((a, b) => a.localeCompare(b)),
  );
}

function uniqueEnum<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort((a, b) => a.localeCompare(b)));
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
}

export const DEFAULT_REFERENCE_OWNER: Readonly<Record<ReferenceIntelligenceCategory, ReferenceCanonicalOwner>> =
  Object.freeze({
    AI_PLATFORM: "AI_PLATFORM_MODEL_ROUTER",
    AGENT_SYSTEM: "EVOLVE",
    DEVELOPER_AUTOMATION: "AUTOPILOT",
    TRADING_RESEARCH: "RESEARCH_INTELLIGENCE_AXIOM",
    STRATEGY: "STRATEGY_FAMILY",
    PORTFOLIO_RISK: "PORTFOLIO_RISK",
    MARKET_DATA: "MARKET_DATA",
    DATA_INTEGRITY: "DATA_RESEARCH_INTEGRITY",
    OBSERVABILITY_SRE: "OBSERVABILITY_SRE",
    LEDGER_PERFORMANCE: "LEDGER_PERFORMANCE_EVIDENCE",
    UI_UX: "UIUX",
    INTEGRATION_E2E: "INTEGRATION_E2E",
    RELEASE_AUDIT: "RELEASE_AUDIT",
    SYSTEM_ARCHITECTURE: "CORE",
  });

export function createReferenceIntelligenceRecord(
  input: ReferenceIntelligenceInput,
): ReferenceIntelligenceRecord {
  const discoveredAt = requireIso(input.discoveredAt, "discoveredAt");
  const sourcePublishedAt = input.sourcePublishedAt == null
    ? undefined
    : requireIso(input.sourcePublishedAt, "sourcePublishedAt");
  if (sourcePublishedAt != null && Date.parse(sourcePublishedAt) > Date.parse(discoveredAt)) {
    throw new Error("sourcePublishedAt cannot be after discoveredAt");
  }

  const canonicalOwner = input.canonicalOwner;
  const sourceLocator = requireText(input.sourceLocator, "sourceLocator", 4_000);
  const sourceVersion = requireText(input.sourceVersion, "sourceVersion", 1_000);
  const title = requireText(input.title, "title", 2_000);
  const description = requireText(input.description, "description");
  const claimedAdvantage = requireText(input.claimedAdvantage, "claimedAdvantage");
  const evidenceRefs = uniqueText(input.evidenceRefs, "evidenceRefs");
  if (input.comparisons.length === 0) throw new Error("comparisons requires at least one dimension");
  const comparisons = Object.freeze(
    [...input.comparisons]
      .map((comparison) => Object.freeze({
        dimension: comparison.dimension,
        verdict: comparison.verdict,
        evidenceRefs: uniqueText(comparison.evidenceRefs, "comparison.evidenceRefs"),
        note: requireText(comparison.note, "comparison.note", 4_000),
      }))
      .sort((left, right) => left.dimension.localeCompare(right.dimension)),
  );
  for (const comparison of comparisons) {
    if (
      comparison.verdict !== "UNKNOWN" &&
      comparison.evidenceRefs.length === 0
    ) {
      throw new Error("non-UNKNOWN comparison requires evidenceRefs");
    }
  }
  const principleToAbsorb = uniqueText(input.principleToAbsorb, "principleToAbsorb");
  const doNotAbsorb = uniqueText(input.doNotAbsorb, "doNotAbsorb");
  const nusaGap = uniqueText(input.nusaGap, "nusaGap");
  const rootCause = uniqueText(input.rootCause, "rootCause");
  const proposedImprovement = uniqueText(input.proposedImprovement, "proposedImprovement");
  const validationProposal = uniqueText(input.validationProposal, "validationProposal");
  const measurement = uniqueText(input.measurement, "measurement");
  const expectedValueDimensions = uniqueEnum(input.expectedValueDimensions);
  const remainingUncertainty = uniqueText(input.remainingUncertainty, "remainingUncertainty");
  const relatedReferenceIds = uniqueText(input.relatedReferenceIds ?? [], "relatedReferenceIds");

  if (nusaGap.length === 0) throw new Error("nusaGap requires at least one bounded gap");
  if (proposedImprovement.length === 0) throw new Error("proposedImprovement requires at least one candidate");
  if (validationProposal.length === 0) throw new Error("validationProposal requires at least one falsifiable check");
  if (measurement.length === 0) throw new Error("measurement requires at least one before/after metric");
  if (expectedValueDimensions.length === 0) throw new Error("expectedValueDimensions requires at least one dimension");

  const identityFingerprint = hash({
    sourceType: input.sourceType,
    sourceLocator,
    sourceVersion,
    category: input.category,
    claimedAdvantage,
    principleToAbsorb,
    nusaGap,
    proposedImprovement,
    canonicalOwner,
  });

  return Object.freeze({
    schemaVersion: 1 as const,
    referenceId: IDENTITY_PREFIX + identityFingerprint,
    identityFingerprint,
    sourceType: input.sourceType,
    sourceLocator,
    ...(input.sourceUrl == null ? {} : { sourceUrl: optionalHttps(input.sourceUrl) }),
    sourceVersion,
    discoveredAt,
    ...(sourcePublishedAt == null ? {} : { sourcePublishedAt }),
    category: input.category,
    title,
    description,
    claimedAdvantage,
    evidenceStrength: input.evidenceStrength,
    evidenceRefs,
    comparisons,
    principleToAbsorb,
    doNotAbsorb,
    nusaGap,
    rootCause,
    proposedImprovement,
    canonicalOwner,
    validationProposal,
    measurement,
    expectedValueDimensions,
    expectedValueMagnitude: input.expectedValueMagnitude,
    implementationCost: input.implementationCost,
    regressionRisk: input.regressionRisk,
    remainingUncertainty,
    relatedReferenceIds,
    priorityScore: "UNSCORED_EVIDENCE_BOUND" as const,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

export function validateReferenceOwnerRouting(
  record: ReferenceIntelligenceRecord,
): Readonly<{
  expectedOwner: ReferenceCanonicalOwner;
  actualOwner: ReferenceCanonicalOwner;
  requiresCoreResolution: boolean;
}> {
  const expectedOwner = DEFAULT_REFERENCE_OWNER[record.category];
  return Object.freeze({
    expectedOwner,
    actualOwner: record.canonicalOwner,
    requiresCoreResolution: expectedOwner !== record.canonicalOwner,
  });
}

export function canEnterReferenceValidation(
  record: ReferenceIntelligenceRecord,
): boolean {
  return (
    record.nusaGap.length > 0 &&
    record.proposedImprovement.length > 0 &&
    record.validationProposal.length > 0 &&
    record.measurement.length > 0 &&
    record.evidenceStrength !== "CLAIM_ONLY"
  );
}
