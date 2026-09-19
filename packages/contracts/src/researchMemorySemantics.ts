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

export type ResearchMemoryValidity =
  | "CURRENT"
  | "SUPERSEDED"
  | "REVALIDATION_REQUIRED"
  | "INVALID_PROVENANCE";

export type ResearchMemoryAttribution =
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
  | "CANONICAL_RESEARCH"
  | "PAPER_FORWARD"
  | "AI_ADVISORY"
  | "HYPOTHESIS_PRIOR"
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

export interface ResearchMemorySemanticInput extends ResearchMemoryAuthorityBoundary {
  readonly artifact: ResearchMemoryArtifactRef;
  readonly semanticClass: ResearchMemorySemanticClass;
  readonly validity: ResearchMemoryValidity;
  readonly attribution: ResearchMemoryAttribution;
  readonly evidenceOrigin: ResearchMemoryEvidenceOrigin;
  readonly evaluatorSemanticsId: string;
  readonly semanticIdentity: string;
  readonly independenceGroupId: string;
  readonly actor: string;
  readonly source: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ResearchMemoryRelationInput extends ResearchMemoryAuthorityBoundary {
  readonly relationType: ResearchMemoryRelationType;
  readonly sourceArtifact: ResearchMemoryArtifactRef;
  readonly targetArtifact: ResearchMemoryArtifactRef;
  readonly actor: string;
  readonly source: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ResearchMemorySemanticEvent extends ResearchMemorySemanticInput {
  readonly eventKind: "SEMANTIC";
  readonly sequence: number;
  readonly identity: string;
  readonly previousHash: string;
  readonly hash: string;
}

export interface ResearchMemoryRelationEvent extends ResearchMemoryRelationInput {
  readonly eventKind: "RELATION";
  readonly sequence: number;
  readonly identity: string;
  readonly previousHash: string;
  readonly hash: string;
}

export type ResearchMemoryOverlayEvent =
  | ResearchMemorySemanticEvent
  | ResearchMemoryRelationEvent;

const genesis = "0".repeat(64);
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const required = (value: string, field: string): void => {
  if (!value.trim()) throw new Error(field + " is required");
};
const digest = (value: string, field: string): void => {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(field + " must be a SHA-256 hex string");
  }
};
const validTime = (value: string): void => {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("occurredAt must be an ISO timestamp");
  }
};

const empiricalOrigins = new Set<ResearchMemoryEvidenceOrigin>([
  "CANONICAL_RESEARCH",
  "PAPER_FORWARD",
]);

function validateAuthority(input: ResearchMemoryAuthorityBoundary): void {
  if (
    input.authority !== "PAPER_ONLY" ||
    input.liveAuthority !== "NONE" ||
    input.productionMutationAllowed !== false ||
    input.aiAuthority !== "ZERO_AUTHORITY"
  ) {
    throw new Error("research memory authority boundary violation");
  }
}

export function validateResearchMemoryArtifactRef(ref: ResearchMemoryArtifactRef): void {
  required(ref.artifactId, "artifactId");
  digest(ref.artifactContentSha256, "artifactContentSha256");
  if (
    ref.artifactDigestKind !== "CANONICAL_EXISTING_SHA256" &&
    ref.artifactDigestKind !== "LEGACY_ARTIFACT_SHA256_V1"
  ) {
    throw new Error("unsupported artifact digest kind");
  }
}

export const researchMemoryArtifactDigestV1 = (value: unknown): string =>
  sha256(canonicalResearchJson({ version: 1, value }));

function canonicalSemanticInput(
  input: ResearchMemorySemanticInput,
): Readonly<ResearchMemorySemanticInput> {
  validateAuthority(input);
  validateResearchMemoryArtifactRef(input.artifact);
  for (const [field, value] of [
    ["evaluatorSemanticsId", input.evaluatorSemanticsId],
    ["semanticIdentity", input.semanticIdentity],
    ["independenceGroupId", input.independenceGroupId],
    ["actor", input.actor],
    ["source", input.source],
    ["reason", input.reason],
  ] as const) {
    required(value, field);
  }
  validTime(input.occurredAt);

  const empirical = empiricalOrigins.has(input.evidenceOrigin);
  if (
    input.validity === "CURRENT" &&
    (input.semanticClass === "EVIDENCE" || input.semanticClass === "LESSON") &&
    !empirical
  ) {
    throw new Error("CURRENT empirical memory requires canonical empirical evidence origin");
  }
  if (input.semanticClass === "LESSON" && input.validity !== "CURRENT") {
    throw new Error("LESSON requires CURRENT validity");
  }

  return Object.freeze({
    ...input,
    artifact: Object.freeze({ ...input.artifact }),
  });
}

function canonicalRelationInput(
  input: ResearchMemoryRelationInput,
): Readonly<ResearchMemoryRelationInput> {
  validateAuthority(input);
  validateResearchMemoryArtifactRef(input.sourceArtifact);
  validateResearchMemoryArtifactRef(input.targetArtifact);
  for (const [field, value] of [
    ["actor", input.actor],
    ["source", input.source],
    ["reason", input.reason],
  ] as const) {
    required(value, field);
  }
  validTime(input.occurredAt);
  if (
    input.sourceArtifact.artifactKind === input.targetArtifact.artifactKind &&
    input.sourceArtifact.artifactId === input.targetArtifact.artifactId &&
    input.sourceArtifact.artifactContentSha256 === input.targetArtifact.artifactContentSha256
  ) {
    throw new Error("research memory self-influence relation is forbidden");
  }
  return Object.freeze({
    ...input,
    sourceArtifact: Object.freeze({ ...input.sourceArtifact }),
    targetArtifact: Object.freeze({ ...input.targetArtifact }),
  });
}

const sameArtifact = (
  left: ResearchMemoryArtifactRef,
  right: ResearchMemoryArtifactRef,
): boolean =>
  left.artifactKind === right.artifactKind &&
  left.artifactId === right.artifactId &&
  left.artifactContentSha256 === right.artifactContentSha256 &&
  left.artifactDigestKind === right.artifactDigestKind;

const isCanonicalEmpiricalSemanticEvent = (
  event: ResearchMemoryOverlayEvent,
): event is ResearchMemorySemanticEvent =>
  event.eventKind === "SEMANTIC" &&
  event.semanticClass === "EVIDENCE" &&
  event.validity === "CURRENT" &&
  empiricalOrigins.has(event.evidenceOrigin);

function requireIndependentLessonSupport(
  records: readonly ResearchMemoryOverlayEvent[],
  lesson: ResearchMemorySemanticInput,
): void {
  if (lesson.semanticClass !== "LESSON") return;

  const supportingGroups = new Set<string>();
  for (const relation of records) {
    if (
      relation.eventKind !== "RELATION" ||
      relation.relationType !== "SUPPORTS" ||
      !sameArtifact(relation.targetArtifact, lesson.artifact)
    ) {
      continue;
    }
    const evidence = records.find(
      (candidate) =>
        isCanonicalEmpiricalSemanticEvent(candidate) &&
        sameArtifact(candidate.artifact, relation.sourceArtifact),
    );
    if (evidence != null) supportingGroups.add(evidence.independenceGroupId);
  }

  if (supportingGroups.size < 2) {
    throw new Error("LESSON requires repeated independent canonical evidence");
  }
}


/**
 * Event identity intentionally excludes actor/source/reason/occurredAt prose and time.
 * Those remain exact append-only event metadata and are covered by the chain hash.
 */
export const researchMemorySemanticEventIdentity = (
  input: ResearchMemorySemanticInput,
): string => {
  const canonical = canonicalSemanticInput(input);
  return sha256(canonicalResearchJson({
    kind: "RESEARCH_MEMORY_SEMANTIC_EVENT_V1",
    artifact: canonical.artifact,
    semanticClass: canonical.semanticClass,
    validity: canonical.validity,
    attribution: canonical.attribution,
    evidenceOrigin: canonical.evidenceOrigin,
    evaluatorSemanticsId: canonical.evaluatorSemanticsId,
    semanticIdentity: canonical.semanticIdentity,
    independenceGroupId: canonical.independenceGroupId,
  }));
};

export const researchMemoryRelationEventIdentity = (
  input: ResearchMemoryRelationInput,
): string => {
  const canonical = canonicalRelationInput(input);
  return sha256(canonicalResearchJson({
    kind: "RESEARCH_MEMORY_RELATION_EVENT_V1",
    relationType: canonical.relationType,
    sourceArtifact: canonical.sourceArtifact,
    targetArtifact: canonical.targetArtifact,
  }));
};

const eventHash = (
  event: Omit<ResearchMemoryOverlayEvent, "hash">,
): string =>
  sha256(
    String(event.sequence) +
      "\n" +
      event.previousHash +
      "\n" +
      canonicalResearchJson(event),
  );

function eventIdentity(event: ResearchMemoryOverlayEvent): string {
  return event.eventKind === "SEMANTIC"
    ? researchMemorySemanticEventIdentity(event)
    : researchMemoryRelationEventIdentity(event);
}

function sameExactInput(
  event: ResearchMemoryOverlayEvent,
  input: ResearchMemorySemanticInput | ResearchMemoryRelationInput,
): boolean {
  const eventInput =
    event.eventKind === "SEMANTIC"
      ? {
          artifact: event.artifact,
          semanticClass: event.semanticClass,
          validity: event.validity,
          attribution: event.attribution,
          evidenceOrigin: event.evidenceOrigin,
          evaluatorSemanticsId: event.evaluatorSemanticsId,
          semanticIdentity: event.semanticIdentity,
          independenceGroupId: event.independenceGroupId,
          actor: event.actor,
          source: event.source,
          reason: event.reason,
          occurredAt: event.occurredAt,
          authority: event.authority,
          liveAuthority: event.liveAuthority,
          productionMutationAllowed: event.productionMutationAllowed,
          aiAuthority: event.aiAuthority,
        }
      : {
          relationType: event.relationType,
          sourceArtifact: event.sourceArtifact,
          targetArtifact: event.targetArtifact,
          actor: event.actor,
          source: event.source,
          reason: event.reason,
          occurredAt: event.occurredAt,
          authority: event.authority,
          liveAuthority: event.liveAuthority,
          productionMutationAllowed: event.productionMutationAllowed,
          aiAuthority: event.aiAuthority,
        };
  return canonicalResearchJson(eventInput) === canonicalResearchJson(input);
}

function appendEvent(
  records: readonly ResearchMemoryOverlayEvent[],
  eventKind: "SEMANTIC" | "RELATION",
  input: ResearchMemorySemanticInput | ResearchMemoryRelationInput,
  identity: string,
): readonly ResearchMemoryOverlayEvent[] {
  replayResearchMemoryOverlayEvents(records);
  const existing = records.find((record) => record.identity === identity);
  if (existing != null) {
    if (existing.eventKind !== eventKind || !sameExactInput(existing, input)) {
      throw new Error("research memory deterministic identity conflict");
    }
    return records;
  }

  const sequence = records.length + 1;
  const previousHash = records.at(-1)?.hash ?? genesis;
  const withoutHash =
    eventKind === "SEMANTIC"
      ? Object.freeze({
          eventKind,
          ...(input as ResearchMemorySemanticInput),
          sequence,
          identity,
          previousHash,
        })
      : Object.freeze({
          eventKind,
          ...(input as ResearchMemoryRelationInput),
          sequence,
          identity,
          previousHash,
        });
  const event = Object.freeze({
    ...withoutHash,
    hash: eventHash(withoutHash as Omit<ResearchMemoryOverlayEvent, "hash">),
  }) as ResearchMemoryOverlayEvent;
  return Object.freeze([...records, event]);
}

export function appendResearchMemorySemanticEvent(
  records: readonly ResearchMemoryOverlayEvent[],
  input: ResearchMemorySemanticInput,
): readonly ResearchMemoryOverlayEvent[] {
  const canonical = canonicalSemanticInput(input);
  replayResearchMemoryOverlayEvents(records);
  requireIndependentLessonSupport(records, canonical);
  return appendEvent(
    records,
    "SEMANTIC",
    canonical,
    researchMemorySemanticEventIdentity(canonical),
  );
}

export function appendResearchMemoryRelationEvent(
  records: readonly ResearchMemoryOverlayEvent[],
  input: ResearchMemoryRelationInput,
): readonly ResearchMemoryOverlayEvent[] {
  const canonical = canonicalRelationInput(input);
  return appendEvent(
    records,
    "RELATION",
    canonical,
    researchMemoryRelationEventIdentity(canonical),
  );
}

export function replayResearchMemoryOverlayEvents(
  records: readonly ResearchMemoryOverlayEvent[],
): readonly ResearchMemoryOverlayEvent[] {
  let previousHash = genesis;
  const identities = new Set<string>();

  records.forEach((record, index) => {
    if (record.eventKind === "SEMANTIC") canonicalSemanticInput(record);
    else if (record.eventKind === "RELATION") canonicalRelationInput(record);
    else throw new Error("unknown research memory event kind");

    if (record.sequence !== index + 1 || record.previousHash !== previousHash) {
      throw new Error("research memory chain integrity violation");
    }
    if (record.identity !== eventIdentity(record)) {
      throw new Error("research memory identity integrity violation");
    }
    const { hash: _hash, ...withoutHash } = record;
    if (record.hash !== eventHash(withoutHash)) {
      throw new Error("research memory hash integrity violation");
    }
    if (identities.has(record.identity)) {
      throw new Error("duplicate research memory deterministic identity");
    }
    identities.add(record.identity);
    previousHash = record.hash;
  });

  return Object.freeze([...records]);
}

export const replayResearchMemorySemanticEvents = replayResearchMemoryOverlayEvents;

export const isCanonicalEmpiricalResearchMemoryEvidence =
  isCanonicalEmpiricalSemanticEvent;
