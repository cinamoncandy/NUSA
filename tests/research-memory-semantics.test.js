import assert from "node:assert/strict";
import test from "node:test";
import {
  appendResearchMemorySemanticEvent,
  isCanonicalEmpiricalResearchMemoryEvidence,
  replayResearchMemorySemanticEvents
} from "../packages/contracts/dist/researchMemorySemantics.js";

const artifact = "a".repeat(64);
const base = {
  artifactSha256: artifact,
  semanticClass: "EVIDENCE",
  validity: "CURRENT",
  attribution: "SIGNAL",
  evidenceOrigin: "CANONICAL_RESEARCH",
  evaluatorSemanticsId: "eval-v1",
  semanticIdentity: "krw-btc:1d:original-window",
  independenceGroupId: "krw-btc:1d:original-window",
  actor: "axiom",
  source: "canonical-research",
  reason: "frozen confirmatory evidence",
  occurredAt: "2026-09-19T00:00:00.000Z",
  links: []
};

test("semantic memory is deterministic, append-only, and idempotent", () => {
  const once = appendResearchMemorySemanticEvent([], base);
  const twice = appendResearchMemorySemanticEvent(once, base);
  assert.equal(twice, once);
  assert.equal(replayResearchMemorySemanticEvents(once)[0].artifactSha256, artifact);
  assert.equal(isCanonicalEmpiricalResearchMemoryEvidence(once[0]), true);
});

test("semantic identity is distinct from exact artifact provenance", () => {
  const first = appendResearchMemorySemanticEvent([], base);
  assert.throws(() => appendResearchMemorySemanticEvent(first, { ...base, evidenceOrigin: "PAPER_FORWARD" }), /identity conflict/);
});

test("AI advisory cannot become a canonical lesson by label", () => {
  assert.throws(() => appendResearchMemorySemanticEvent([], {
    ...base,
    semanticClass: "LESSON",
    evidenceOrigin: "AI_ADVISORY"
  }), /canonical empirical evidence origin/);
});

test("tampered replay fails closed", () => {
  const records = appendResearchMemorySemanticEvent([], base);
  assert.throws(() => replayResearchMemorySemanticEvents([{ ...records[0], reason: "rewritten" }]), /integrity violation/);
});
