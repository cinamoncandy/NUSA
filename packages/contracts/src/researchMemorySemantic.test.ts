import test from "node:test";
import assert from "node:assert/strict";
import {
  createResearchMemoryRelationEvent,
  createResearchMemorySemanticEvent,
  researchMemoryArtifactDigestV1,
  validateResearchMemorySemanticEvent,
  type ResearchMemoryArtifactRef,
} from "./researchMemorySemantic";

const artifact = (id: string): ResearchMemoryArtifactRef => Object.freeze({
  artifactKind: "FACTORY_DECISION",
  artifactId: id,
  artifactContentSha256: "a".repeat(64),
  artifactDigestKind: "CANONICAL_EXISTING_SHA256",
});

const authority = Object.freeze({
  authority: "PAPER_ONLY" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

test("semantic identity is deterministic and timestamp is metadata, not identity", () => {
  const base = {
    schemaVersion: 1 as const,
    artifact: artifact("decision-1"),
    semanticClass: "EVIDENCE" as const,
    validity: "CURRENT" as const,
    evidenceOrigin: "CANONICAL_EVALUATOR" as const,
    evaluatorSemanticsId: "evaluator:v3",
    independenceGroupId: "search:alpha-1",
    actor: "canonical-research",
    reason: "sealed qualification evidence",
    occurredAt: "2026-09-19T00:00:00.000Z",
    ...authority,
  };
  const first = createResearchMemorySemanticEvent(base);
  const second = createResearchMemorySemanticEvent({
    ...base,
    occurredAt: "2026-09-19T01:00:00.000Z",
  });
  assert.equal(first.eventId, second.eventId);
});

test("CURRENT empirical evidence requires canonical origin and evaluator/independence identity", () => {
  assert.throws(
    () => createResearchMemorySemanticEvent({
      schemaVersion: 1,
      artifact: artifact("decision-ai"),
      semanticClass: "EVIDENCE",
      validity: "CURRENT",
      evidenceOrigin: "AI_ADVISORY",
      actor: "ai-zero-authority",
      reason: "review",
      occurredAt: "2026-09-19T00:00:00.000Z",
      ...authority,
    }),
    /RESEARCH_MEMORY_CURRENT_EMPIRICAL_PROVENANCE_REQUIRED/,
  );
});

test("legacy or advisory evidence can be preserved only as non-current typed history", () => {
  const event = createResearchMemorySemanticEvent({
    schemaVersion: 1,
    artifact: artifact("decision-legacy"),
    semanticClass: "EVIDENCE",
    validity: "REVALIDATION_REQUIRED",
    evidenceOrigin: "AI_ADVISORY",
    causalAttribution: "MIXED_UNRESOLVED",
    actor: "migration-projection",
    reason: "legacy stage label is not empirical authority",
    occurredAt: "2026-09-19T00:00:00.000Z",
    ...authority,
  });
  assert.doesNotThrow(() => validateResearchMemorySemanticEvent(event));
});

test("relations have deterministic identities and reject self-relations", () => {
  const relation = createResearchMemoryRelationEvent({
    schemaVersion: 1,
    relationType: "SUPPORTS",
    source: artifact("decision-a"),
    target: artifact("decision-b"),
    actor: "canonical-research",
    reason: "evidence supports a distinct artifact",
    occurredAt: "2026-09-19T00:00:00.000Z",
    ...authority,
  });
  assert.match(relation.relationId, /^[a-f0-9]{64}$/);
  assert.throws(
    () => createResearchMemoryRelationEvent({
      schemaVersion: 1,
      relationType: "SUPPORTS",
      source: artifact("decision-a"),
      target: artifact("decision-a"),
      actor: "canonical-research",
      reason: "invalid self relation",
      occurredAt: "2026-09-19T00:00:00.000Z",
      ...authority,
    }),
    /RESEARCH_MEMORY_SELF_RELATION_FORBIDDEN/,
  );
});

test("legacy artifact digest v1 binds exact decoded persisted content", () => {
  const first = researchMemoryArtifactDigestV1({
    id: "x",
    payloadJson: "{\"a\":1}",
    createdAt: "t1",
  });
  const second = researchMemoryArtifactDigestV1({
    id: "x",
    payloadJson: "{\"a\":1}",
    createdAt: "t2",
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});
