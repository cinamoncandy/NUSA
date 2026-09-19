import test from "node:test";
import assert from "node:assert/strict";
import {
  createResearchMemoryRecord,
  projectLegacyResearchMemoryRecordSemantics,
} from "./researchMemoryV2";

test("legacy AI-authored EVIDENCE remains advisory and revalidation-required", () => {
  const record = createResearchMemoryRecord({
    recordId: "review-1",
    researchId: "research-1",
    stage: "EVIDENCE",
    createdAt: "2026-09-19T00:00:00.000Z",
    author: "ai-zero-authority",
    summary: "critic output",
    payload: Object.freeze({ criticSeverity: "high" }),
    evidenceDirection: "REJECTS",
  });
  assert.deepEqual(projectLegacyResearchMemoryRecordSemantics(record), {
    semanticClass: "EVIDENCE",
    validity: "REVALIDATION_REQUIRED",
    evidenceOrigin: "AI_ADVISORY",
    causalAttribution: "MIXED_UNRESOLVED",
  });
});

test("legacy non-AI EVIDENCE is not silently bulk-upgraded to CURRENT empirical truth", () => {
  const record = createResearchMemoryRecord({
    recordId: "legacy-1",
    researchId: "research-1",
    stage: "EVIDENCE",
    createdAt: "2026-09-19T00:00:00.000Z",
    author: "legacy-import",
    summary: "historical evidence",
    payload: Object.freeze({}),
    evidenceDirection: "SUPPORTS",
  });
  const projection = projectLegacyResearchMemoryRecordSemantics(record);
  assert.equal(projection.validity, "REVALIDATION_REQUIRED");
  assert.equal(projection.evidenceOrigin, "UNKNOWN_UNTRUSTED");
});
