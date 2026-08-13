const test = require("node:test");
const assert = require("node:assert/strict");
const { compareEvidenceProducerOutputs } = require("../dist/apps/cloud/src/ai/evidenceProducerDiversityComparator.js");

const bundleHash = "a".repeat(64);
const otherBundleHash = "b".repeat(64);

const output = (overrides = {}) => ({
  groupId: "group-a",
  providerId: "anthropic",
  modelVersionId: "claude-test",
  evidenceBundleHash: bundleHash,
  factClaimCount: 3,
  missingEvidence: [],
  citedEvidenceReferences: ["e-1", "e-2"],
  ...overrides
});

test("two independent providers agreeing on everything is CONSENSUS with NO_UPLIFT", () => {
  const result = compareEvidenceProducerOutputs([
    output({ groupId: "a" }),
    output({ groupId: "b", providerId: "openai", modelVersionId: "gpt-test" })
  ]);
  assert.equal(result.comparisonState, "CONSENSUS");
  assert.equal(result.trustDisposition, "NO_UPLIFT");
  assert.equal(result.metrics.factClaimCountAgreement, true);
  assert.equal(result.metrics.missingEvidenceOverlapRatio, 1);
  assert.equal(result.metrics.citedEvidenceOverlapRatio, 1);
  assert.deepEqual(result.metrics.disagreementCodes, []);
});

test("outputs evaluated against different evidence bundles are not comparable and throw", () => {
  assert.throws(
    () => compareEvidenceProducerOutputs([
      output({ groupId: "a", evidenceBundleHash: bundleHash }),
      output({ groupId: "b", evidenceBundleHash: otherBundleHash })
    ]),
    /same evidenceBundleHash/
  );
});

test("a different fact-claim count over the same evidence is DISAGREEMENT with REDUCE (never ABSTAIN)", () => {
  const result = compareEvidenceProducerOutputs([
    output({ groupId: "a", factClaimCount: 3 }),
    output({ groupId: "b", factClaimCount: 5 })
  ]);
  assert.equal(result.comparisonState, "DISAGREEMENT");
  assert.equal(result.trustDisposition, "REDUCE");
  assert.ok(result.metrics.disagreementCodes.includes("FACT_CLAIM_COUNT_MISMATCH"));
});

test("disjoint missingEvidence sets are flagged distinctly from citedEvidenceReferences mismatches", () => {
  const result = compareEvidenceProducerOutputs([
    output({ groupId: "a", missingEvidence: ["orderbook-depth"] }),
    output({ groupId: "b", missingEvidence: [] })
  ]);
  assert.ok(result.metrics.disagreementCodes.includes("MISSING_EVIDENCE_MISMATCH"));
  assert.ok(!result.metrics.disagreementCodes.includes("CITED_EVIDENCE_MISMATCH"));
});

test("partial citedEvidenceReferences overlap produces a fractional Jaccard ratio", () => {
  const result = compareEvidenceProducerOutputs([
    output({ groupId: "a", citedEvidenceReferences: ["e-1", "e-2"] }),
    output({ groupId: "b", citedEvidenceReferences: ["e-2", "e-3"] })
  ]);
  // intersection {e-2} = 1, union {e-1,e-2,e-3} = 3
  assert.equal(result.metrics.citedEvidenceOverlapRatio, 1 / 3);
  assert.ok(result.metrics.disagreementCodes.includes("CITED_EVIDENCE_MISMATCH"));
});

test("fewer than 2 independent groups is INCOMPLETE with ABSTAIN, never consensus", () => {
  const single = compareEvidenceProducerOutputs([output({ groupId: "a" })]);
  assert.equal(single.comparisonState, "INCOMPLETE");
  assert.equal(single.trustDisposition, "ABSTAIN");
  assert.deepEqual(single.metrics.disagreementCodes, ["INSUFFICIENT_INDEPENDENT_GROUPS"]);

  const empty = compareEvidenceProducerOutputs([]);
  assert.equal(empty.comparisonState, "INCOMPLETE");
});

test("a duplicate groupId is rejected", () => {
  assert.throws(
    () => compareEvidenceProducerOutputs([output({ groupId: "a" }), output({ groupId: "a" })]),
    /groupId must be unique/
  );
});

test("a malformed evidenceBundleHash is rejected rather than silently accepted", () => {
  assert.throws(
    () => compareEvidenceProducerOutputs([output({ groupId: "a", evidenceBundleHash: "not-a-hash" }), output({ groupId: "b", evidenceBundleHash: "not-a-hash" })]),
    /evidenceBundleHash must be sha256/
  );
});

test("free-text claim content is never inspected -- only structured fields drive the comparison", () => {
  // No `claim` text field exists on EvidenceProducerProviderOutput at all: the contract itself
  // enforces that paraphrased wording across providers cannot manufacture a disagreement code.
  const result = compareEvidenceProducerOutputs([output({ groupId: "a" }), output({ groupId: "b" })]);
  assert.equal(result.comparisonState, "CONSENSUS");
});

test("comparison is deterministic given the same inputs", () => {
  const inputs = [output({ groupId: "a" }), output({ groupId: "b", providerId: "openai" })];
  const first = compareEvidenceProducerOutputs(inputs);
  const second = compareEvidenceProducerOutputs(inputs);
  assert.deepEqual(first, second);
});

test("liveAuthority and productionMutationAllowed never leave their zero-authority defaults", () => {
  const result = compareEvidenceProducerOutputs([output({ groupId: "a" }), output({ groupId: "b" })]);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});
