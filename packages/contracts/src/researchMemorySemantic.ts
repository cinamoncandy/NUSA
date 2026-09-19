import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

export type ResearchMemorySemanticClass =
  | "OBSERVATION"
  | "HYPOTHESIS"
  | "EVIDENCE"
  | "LESSON"
  | "STRATEGY_CANDIDATE"
  | "REJECTED"
  | "RETIRED";

export type ResearchMemoryEvidenceValidity =
  | "CURRENT"
  | "SUPERSEDED"
  | "REVALIDATION_REQUIRED"
  | "INVALID_PROVENANCE";

export type ResearchMemoryCausalAttribution =
  | "SIGNAL"
  | "REGIME"
  | "DATA"
  | "EXECUTION_RUNTIME"
  | "TRANSACTION_COST"
  | "RISK_SIZING"
  | "SAMPLE_STATISTICS"
  | "MULTIPLE_TESTING"
  | "MIXED_UNRESOLVED";

export type ResearchMemoryEvidenceOrigin =
  | "CANONICAL_EVALUATOR"
  | "PAPER_EMPIRICAL"
  | "AI_ADVISORY"
  | "EXTERNAL_HYPOTHESIS_PRIOR"
  | "UNKNOWN_UNTRUSTED";

export type ResearchMemoryRelationType =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "SUPERSEDES"
  | "REVALIDATES";

export type ResearchMemoryArtifactKind =
  | "RESEARCH_HYPOTHESIS"
  | "RESEARCH_EXPERIMENT"
  | "HYPOTHESIS_LIFECYCLE_EVENT"
  | "EVALUATION_LEDGER_RECORD"
  | "FACTORY_DECISION"
  | "CLOUD_MEMORY_RECORD";

export type ResearchMemoryArtifactDigestKind =
  | "CANONICAL_EXISTING_SHA256"
  | "LEGACY_ARTIFACT_SHA256_V1";

export interface ResearchMemoryArtifactRef {
  readonly artifactKind: ResearchMemoryArtifactKind;
  readonly artifactId: string;
  readonly artifactContentSha256: string;
  readonly artifactDigestKind: ResearchMemoryArtifactDigestKind;
}

export interface ResearchMemoryAuthorityBoundary {
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ResearchMemorySemanticEvent extends ResearchMemoryAuthorityBoundary {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly artifact: ResearchMemoryArtifactRef;
  readonly semanticClass: ResearchMemorySemanticClass;
  readonly validity: ResearchMemoryEvidenceValidity;
  readonly causalAttribution?: ResearchMemoryCausalAttribution;
  readonly evidenceOrigin: ResearchMemoryEvidenceOrigin;
  readonly evaluatorSemanticsId?: string;
  readonly independenceGroupId?: string;
  readonly actor: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ResearchMemoryRelationEvent extends ResearchMemoryAuthorityBoundary {
  readonly schemaVersion: 1;
  readonly relationId: string;
  readonly relationType: ResearchMemoryRelationType;
  readonly source: ResearchMemoryArtifactRef;
  readonly target: ResearchMemoryArtifactRef;
  readonly actor: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export type ResearchMemorySemanticEventInput = Omit<ResearchMemorySemanticEvent, "eventId">;
export type ResearchMemoryRelationEventInput = Omit<ResearchMemoryRelationEvent, "relationId">;

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const EMPIRICAL_ORIGINS = new Set<ResearchMemoryEvidenceOrigin>([
  "CANONICAL_EVALUATOR",
  "PAPER_EMPIRICAL",
]);

const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");

const nonEmpty = (value: string, field: string): void => {
  if (!value.trim()) throw new Error("RESEARCH_MEMORY_SEMANTIC_INVALID:" + field);
};

function validateAuthority(value: ResearchMemoryAuthorityBoundary): void {
  if (
    value.authority !== "PAPER_ONLY" ||
    value.liveAuthority !== "NONE" ||
    value.productionMutationAllowed !== false ||
    value.aiAuthority !== "ZERO_AUTHORITY"
  ) {
    throw new Error("RESEARCH_MEMORY_SEMANTIC_AUTHORITY_INVALID");
  }
}

export function validateResearchMemoryArtifactRef(value: ResearchMemoryArtifactRef): void {
  if (!IDENTIFIER.test(value.artifactId) || !SHA256.test(value.artifactContentSha256)) {
    throw new Error("RESEARCH_MEMORY_ARTIFACT_REF_INVALID");
  }
  if (
    value.artifactDigestKind !== "CANONICAL_EXISTING_SHA256" &&
    value.artifactDigestKind !== "LEGACY_ARTIFACT_SHA256_V1"
  ) {
    throw new Error("RESEARCH_MEMORY_ARTIFACT_REF_INVALID");
  }
}

export function researchMemoryArtifactDigestV1(value: unknown): string {
  return digest({ version: 1, value });
}

function semanticIdentity(value: ResearchMemorySemanticEventInput): string {
  return digest({
    kind: "RESEARCH_MEMORY_SEMANTIC_EVENT_V1",
    artifact: value.artifact,
    semanticClass: value.semanticClass,
    validity: value.validity,
    causalAttribution: value.causalAttribution ?? null,
    evidenceOrigin: value.evidenceOrigin,
    evaluatorSemanticsId: value.evaluatorSemanticsId ?? null,
    independenceGroupId: value.independenceGroupId ?? null,
  });
}

function relationIdentity(value: ResearchMemoryRelationEventInput): string {
  return digest({
    kind: "RESEARCH_MEMORY_RELATION_EVENT_V1",
    relationType: value.relationType,
    source: value.source,
    target: value.target,
  });
}

export function createResearchMemorySemanticEvent(
  input: ResearchMemorySemanticEventInput,
): ResearchMemorySemanticEvent {
  const event = Object.freeze({ ...input, eventId: semanticIdentity(input) });
  validateResearchMemorySemanticEvent(event);
  return event;
}

export function createResearchMemoryRelationEvent(
  input: ResearchMemoryRelationEventInput,
): ResearchMemoryRelationEvent {
  const relation = Object.freeze({ ...input, relationId: relationIdentity(input) });
  validateResearchMemoryRelationEvent(relation);
  return relation;
}

export function validateResearchMemorySemanticEvent(value: ResearchMemorySemanticEvent): void {
  if (value.schemaVersion !== 1 || !SHA256.test(value.eventId)) {
    throw new Error("RESEARCH_MEMORY_SEMANTIC_EVENT_INVALID");
  }
  validateAuthority(value);
  validateResearchMemoryArtifactRef(value.artifact);
  nonEmpty(value.actor, "actor");
  nonEmpty(value.reason, "reason");
  if (!Number.isFinite(Date.parse(value.occurredAt))) {
    throw new Error("RESEARCH_MEMORY_SEMANTIC_INVALID:occurredAt");
  }
  if (value.evaluatorSemanticsId != null) nonEmpty(value.evaluatorSemanticsId, "evaluatorSemanticsId");
  if (value.independenceGroupId != null) nonEmpty(value.independenceGroupId, "independenceGroupId");

  const empirical = EMPIRICAL_ORIGINS.has(value.evidenceOrigin);
  if (
    value.validity === "CURRENT" &&
    (value.semanticClass === "EVIDENCE" || value.semanticClass === "LESSON") &&
    (!empirical || value.evaluatorSemanticsId == null || value.independenceGroupId == null)
  ) {
    throw new Error("RESEARCH_MEMORY_CURRENT_EMPIRICAL_PROVENANCE_REQUIRED");
  }

  const { eventId: _eventId, ...input } = value;
  if (value.eventId !== semanticIdentity(input)) {
    throw new Error("RESEARCH_MEMORY_SEMANTIC_EVENT_ID_MISMATCH");
  }
}

export function validateResearchMemoryRelationEvent(value: ResearchMemoryRelationEvent): void {
  if (value.schemaVersion !== 1 || !SHA256.test(value.relationId)) {
    throw new Error("RESEARCH_MEMORY_RELATION_EVENT_INVALID");
  }
  validateAuthority(value);
  validateResearchMemoryArtifactRef(value.source);
  validateResearchMemoryArtifactRef(value.target);
  nonEmpty(value.actor, "actor");
  nonEmpty(value.reason, "reason");
  if (!Number.isFinite(Date.parse(value.occurredAt))) {
    throw new Error("RESEARCH_MEMORY_SEMANTIC_INVALID:occurredAt");
  }
  if (
    value.source.artifactKind === value.target.artifactKind &&
    value.source.artifactId === value.target.artifactId &&
    value.source.artifactContentSha256 === value.target.artifactContentSha256
  ) {
    throw new Error("RESEARCH_MEMORY_SELF_RELATION_FORBIDDEN");
  }

  const { relationId: _relationId, ...input } = value;
  if (value.relationId !== relationIdentity(input)) {
    throw new Error("RESEARCH_MEMORY_RELATION_EVENT_ID_MISMATCH");
  }
}
