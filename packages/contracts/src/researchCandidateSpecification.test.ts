import test from "node:test";
import assert from "node:assert/strict";
import { createResearchCandidateSpecification, validateResearchCandidateSpecification } from "./researchCandidateSpecification";

const base = {
  candidateId: "cand-1",
  hypothesisId: "hyp-1",
  familyId: "fam-1",
  lineageId: "lin-1",
  strategyId: "strat-1",
  strategyVersion: "1.0.0",
  parametersCanonicalJson: '{"lookback":20}',
  codeSha: "a".repeat(40),
  datasetId: "dataset-1",
  datasetContentSha256: "b".repeat(64),
  costModel: { feeBps: 5, slippageBps: 3, spreadBps: 2, turnoverAssumption: 1.5 },
  createdAt: "2026-09-03T12:00:00.000Z",
  evaluationWindowStart: "2026-01-01T00:00:00.000Z",
  evaluationWindowEnd: "2026-06-01T00:00:00.000Z",
} as const;

test("creates immutable PAPER-only candidate specification", () => {
  const value = createResearchCandidateSpecification(base);
  assert.equal(value.authority, "PAPER_ONLY");
  assert.equal(value.schemaVersion, 1);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.costModel), true);
  assert.deepEqual(validateResearchCandidateSpecification(value), []);
});

test("fails closed on missing provenance identity or cost evidence", () => {
  const bad = { ...base, codeSha: "bad", datasetContentSha256: "bad", costModel: { ...base.costModel, feeBps: -1 } };
  const errors = validateResearchCandidateSpecification({ schemaVersion: 1, ...bad, authority: "PAPER_ONLY" });
  assert.ok(errors.includes("CODE_SHA_INVALID"));
  assert.ok(errors.includes("DATASET_CONTENT_SHA256_INVALID"));
  assert.ok(errors.includes("COST_MODEL_FEEBPS_INVALID"));
});

test("rejects malformed canonical parameters and non-forward evaluation windows", () => {
  const errors = validateResearchCandidateSpecification({
    schemaVersion: 1,
    ...base,
    parametersCanonicalJson: "{bad",
    evaluationWindowStart: "2026-06-01T00:00:00.000Z",
    evaluationWindowEnd: "2026-01-01T00:00:00.000Z",
    authority: "PAPER_ONLY",
  });
  assert.ok(errors.includes("PARAMETERS_CANONICAL_JSON_INVALID"));
  assert.ok(errors.includes("EVALUATION_WINDOW_INVALID"));
});
