const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  detectUnsupportedClaims,
  aggregateVerdict,
  evaluateAiOutput,
  compareAgainstBaseline,
  verifyAiEvaluationRecord,
  recordIsSelfConsistent,
  buildPromotionApprovalInput,
  MINIMUM_OPERATIONAL_DATA_POINTS,
  AiEvaluationError
} = require("../dist/apps/execution/src/ai-evaluation-framework.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const DATASET_A = sha256("dataset-a");
const DATASET_B = sha256("dataset-b");

function evidence(overrides = {}) {
  return { evidenceId: "evidence-1", sourceType: "BACKTEST_REPORT", contentSha256: sha256("backtest-report-1"), provenance: "REAL", ...overrides };
}

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    subjectType: "AI_COACH",
    subjectId: "coach-output-1",
    producedAt: "2026-08-03T00:00:00.000Z",
    producerIdentifier: "test-producer",
    claims: [{ claimId: "claim-1", statement: "Sharpe ratio improved 12% over baseline.", citedEvidenceIds: ["evidence-1"] }],
    evidenceBundle: [evidence()],
    datasetContentSha256: DATASET_A,
    operationalDataPoints: MINIMUM_OPERATIONAL_DATA_POINTS,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Unsupported claim / hallucination detection
// ---------------------------------------------------------------------------

test("a claim with no cited evidence is unsupported", () => {
  const unsupported = detectUnsupportedClaims(envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] }));
  assert.deepEqual(unsupported, ["c1"]);
});

test("a claim citing an evidence id that does not exist in the bundle is unsupported", () => {
  const unsupported = detectUnsupportedClaims(envelope({ claims: [{ claimId: "c1", statement: "cites a ghost", citedEvidenceIds: ["does-not-exist"] }] }));
  assert.deepEqual(unsupported, ["c1"]);
});

test("a claim citing evidence declared UNVERIFIED is unsupported, same as citing nothing", () => {
  const unsupported = detectUnsupportedClaims(envelope({
    evidenceBundle: [evidence({ provenance: "UNVERIFIED" })],
    claims: [{ claimId: "c1", statement: "cites unverified evidence", citedEvidenceIds: ["evidence-1"] }]
  }));
  assert.deepEqual(unsupported, ["c1"]);
});

test("a claim with a valid, resolvable citation is supported", () => {
  const unsupported = detectUnsupportedClaims(envelope());
  assert.deepEqual(unsupported, []);
});

// ---------------------------------------------------------------------------
// aggregateVerdict: worst-of, never averaged
// ---------------------------------------------------------------------------

test("aggregateVerdict takes the single worst dimension, not an average", () => {
  const dim = (verdict) => ({ dimension: "EVIDENCE_TRACEABILITY", verdict, reasonCodes: [] });
  assert.equal(aggregateVerdict([dim("PASS"), dim("PASS"), dim("PASS"), dim("FAIL")]), "FAIL", "one FAIL among three PASSes must still fail overall");
  assert.equal(aggregateVerdict([dim("PASS"), dim("WARN")]), "WARN");
  assert.equal(aggregateVerdict([dim("PASS"), dim("HOLD_INSUFFICIENT_DATA"), dim("WARN")]), "HOLD_INSUFFICIENT_DATA", "HOLD outranks WARN");
  assert.equal(aggregateVerdict([dim("PASS")]), "PASS");
});

test("aggregateVerdict rejects an empty dimension list rather than defaulting to PASS", () => {
  assert.throws(() => aggregateVerdict([]), AiEvaluationError);
});

// ---------------------------------------------------------------------------
// evaluateAiOutput: end-to-end verdicts
// ---------------------------------------------------------------------------

test("a well-evidenced envelope with sufficient operational data PASSes", () => {
  const record = evaluateAiOutput(envelope());
  assert.equal(record.verdict, "PASS");
  assert.deepEqual(record.unsupportedClaimIds, []);
});

test("an unsupported claim fails the evaluation outright, regardless of other passing dimensions", () => {
  const record = evaluateAiOutput(envelope({ claims: [{ claimId: "c1", statement: "no receipts", citedEvidenceIds: [] }] }));
  assert.equal(record.verdict, "FAIL");
  assert.deepEqual(record.unsupportedClaimIds, ["c1"]);
});

test("all-synthetic evidence cannot PASS -- it WARNs, mirroring 'synthetic evidence can never promote'", () => {
  const record = evaluateAiOutput(envelope({ evidenceBundle: [evidence({ provenance: "SYNTHETIC_FIXTURE" })] }));
  assert.equal(record.verdict, "WARN");
});

test("unverified evidence fails the evaluation", () => {
  const record = evaluateAiOutput(envelope({
    evidenceBundle: [evidence({ provenance: "UNVERIFIED" })],
    claims: [{ claimId: "c1", statement: "x", citedEvidenceIds: ["evidence-1"] }]
  }));
  assert.equal(record.verdict, "FAIL");
});

test("insufficient operational data points HOLDs the evaluation rather than passing or failing it", () => {
  const record = evaluateAiOutput(envelope({ operationalDataPoints: MINIMUM_OPERATIONAL_DATA_POINTS - 1 }));
  assert.equal(record.verdict, "HOLD_INSUFFICIENT_DATA");
});

test("a malformed envelope (bad hash, empty ids, non-finite timestamp) is rejected before evaluation runs", () => {
  assert.throws(() => evaluateAiOutput(envelope({ datasetContentSha256: "not-a-hash" })), AiEvaluationError);
  assert.throws(() => evaluateAiOutput(envelope({ subjectId: "" })), AiEvaluationError);
  assert.throws(() => evaluateAiOutput(envelope({ producedAt: "not-a-date" })), AiEvaluationError);
  assert.throws(() => evaluateAiOutput(envelope({ operationalDataPoints: -1 })), AiEvaluationError);
});

// ---------------------------------------------------------------------------
// Regression comparison: same-dataset only
// ---------------------------------------------------------------------------

test("comparing across two different datasets refuses to compute a ratio", () => {
  const baseline = evaluateAiOutput(envelope({ datasetContentSha256: DATASET_B }));
  const current = evaluateAiOutput(envelope({ datasetContentSha256: DATASET_A }));
  const comparison = compareAgainstBaseline(current, baseline);
  assert.equal(comparison.sameDataset, false);
  assert.equal(comparison.improvementRatio, null, "no ratio across mismatched datasets, not a fabricated one");
  assert.ok(comparison.reasonCodes.includes("DATASET_MISMATCH_NOT_COMPARABLE"));
});

test("a same-dataset comparison against a worse baseline reports improvement", () => {
  const baseline = evaluateAiOutput(envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] })); // FAIL
  const current = evaluateAiOutput(envelope()); // PASS, same dataset
  const comparison = compareAgainstBaseline(current, baseline);
  assert.equal(comparison.sameDataset, true);
  assert.ok(comparison.improvementRatio > 0);
  assert.equal(comparison.verdict, "PASS");
});

test("a same-dataset comparison against a better baseline reports regression and the overall record reflects it", () => {
  const baseline = evaluateAiOutput(envelope()); // PASS
  const record = evaluateAiOutput(envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] }), { baseline }); // FAIL dimensions
  assert.equal(record.regression.sameDataset, true);
  assert.equal(record.verdict, "FAIL", "the dimension FAIL must not be diluted by the regression comparison");
});

// ---------------------------------------------------------------------------
// Independent verifier: re-derives, does not just re-check the hash
// ---------------------------------------------------------------------------

test("verifyAiEvaluationRecord confirms a genuine, untampered record", () => {
  const record = evaluateAiOutput(envelope());
  const result = verifyAiEvaluationRecord(record, envelope());
  assert.equal(result.valid, true);
  assert.deepEqual(result.mismatches, []);
});

test("verifyAiEvaluationRecord catches a verdict silently flipped after the fact", () => {
  const record = evaluateAiOutput(envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] }));
  const tampered = { ...record, verdict: "PASS", recordSha256: crypto.createHash("sha256").update(JSON.stringify({ ...record, verdict: "PASS" })).digest("hex") };
  const result = verifyAiEvaluationRecord(tampered, envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] }));
  assert.equal(result.valid, false);
  assert.ok(result.mismatches.includes("VERDICT_MISMATCH"), "re-derivation from the envelope must catch a tampered verdict even with a self-consistent-looking hash");
});

test("recordIsSelfConsistent detects a hash that does not match its own record content", () => {
  const record = evaluateAiOutput(envelope());
  assert.equal(recordIsSelfConsistent(record), true);
  assert.equal(recordIsSelfConsistent({ ...record, verdict: "FAIL" }), false, "changing a field without recomputing the hash must be detectable");
});

// ---------------------------------------------------------------------------
// Promotion approval input: never self-approves
// ---------------------------------------------------------------------------

test("promotion approval input always requires owner approval and never grants it", () => {
  const record = evaluateAiOutput(envelope());
  const input = buildPromotionApprovalInput(record);
  assert.equal(input.requiresOwnerApproval, true);
  assert.equal(input.ownerApproved, false);
});

test("promotion approval input surfaces unsupported claims so an owner sees exactly what to distrust", () => {
  const record = evaluateAiOutput(envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] }));
  const input = buildPromotionApprovalInput(record);
  assert.deepEqual(input.unsupportedClaimIds, ["c1"]);
  assert.equal(input.ownerApproved, false, "a FAIL verdict must not be laundered into an approval by this step");
});
