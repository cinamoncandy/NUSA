"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateResearchCandidateSpecification } = require("../dist/apps/desktop/src/cloud/researchCandidateSpecification.js");

const NOW = Date.parse("2026-08-29T15:00:00.000Z");

function specification(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateId: "sma-5-20",
    familyId: "sma-crossover",
    lineageId: "sma-crossover-v1",
    parameters: { slow: 20, fast: 5 },
    codeSha: "a".repeat(40),
    datasetId: "upbit-KRW-BTC-1d",
    datasetContentSha256: "b".repeat(64),
    costModelVersion: "wf-cost-v1",
    generatedAt: "2026-08-29T14:00:00.000Z",
    evaluationStartedAt: "2026-08-29T14:05:00.000Z",
    evaluationEndedAt: "2026-08-29T14:30:00.000Z",
    ...overrides,
  };
}

test("verifies an immutable provenance-bound candidate specification deterministically", () => {
  const first = validateResearchCandidateSpecification(specification(), NOW);
  const reorderedParameters = validateResearchCandidateSpecification(specification({ parameters: { fast: 5, slow: 20 } }), NOW);
  assert.equal(first.status, "VERIFIED");
  assert.equal(first.specificationHash, reorderedParameters.specificationHash);
  assert.equal(first.specificationHash.length, 64);
});

test("rejects missing lineage, code, dataset, hash, or cost-model identity", () => {
  const cases = [
    ["familyId", "", "MISSING_FAMILY_ID"],
    ["lineageId", "", "MISSING_LINEAGE_ID"],
    ["codeSha", "abc", "INVALID_CODE_SHA"],
    ["datasetId", "", "MISSING_DATASET_ID"],
    ["datasetContentSha256", "abc", "INVALID_DATASET_CONTENT_SHA256"],
    ["costModelVersion", "", "MISSING_COST_MODEL_VERSION"],
  ];
  for (const [field, value, reason] of cases) {
    const result = validateResearchCandidateSpecification(specification({ [field]: value }), NOW);
    assert.equal(result.status, "REJECTED", field);
    assert.ok(result.reasons.includes(reason), `${field} must fail with ${reason}`);
  }
});

test("rejects malformed and non-finite parameters without throwing", () => {
  const malformed = validateResearchCandidateSpecification(specification({ parameters: null }), NOW);
  assert.equal(malformed.status, "REJECTED");
  assert.ok(malformed.reasons.includes("INVALID_PARAMETERS"));
  assert.equal(malformed.specificationHash.length, 64);

  const nonFinite = validateResearchCandidateSpecification(specification({ parameters: { fast: Number.NaN } }), NOW);
  assert.equal(nonFinite.status, "REJECTED");
  assert.ok(nonFinite.reasons.includes("NON_FINITE_PARAMETER_VALUE"));
  assert.equal(nonFinite.specificationHash.length, 64);
});

test("requires specification precommit strictly before evaluation begins", () => {
  for (const generatedAt of ["2026-08-29T14:05:00.000Z", "2026-08-29T14:10:00.000Z"]) {
    const result = validateResearchCandidateSpecification(specification({ generatedAt }), NOW);
    assert.equal(result.status, "REJECTED");
    assert.ok(result.reasons.includes("SPECIFICATION_NOT_PRECOMMITTED"));
  }
});

test("rejects future-derived and reversed evaluation chronology", () => {
  const future = validateResearchCandidateSpecification(specification({ evaluationEndedAt: "2026-08-29T15:01:00.000Z" }), NOW);
  assert.equal(future.status, "REJECTED");
  assert.ok(future.reasons.includes("FUTURE_EVALUATION_END"));

  const reversed = validateResearchCandidateSpecification(specification({
    evaluationStartedAt: "2026-08-29T14:40:00.000Z",
    evaluationEndedAt: "2026-08-29T14:30:00.000Z",
  }), NOW);
  assert.equal(reversed.status, "REJECTED");
  assert.ok(reversed.reasons.includes("INVALID_EVALUATION_CHRONOLOGY"));
});

test("does not expose execution authority vocabulary", () => {
  const serialized = JSON.stringify(validateResearchCandidateSpecification(specification(), NOW)).toLowerCase();
  for (const forbidden of ["liveauthority", "productionmutationallowed", "withdraw", "broker", "order"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
