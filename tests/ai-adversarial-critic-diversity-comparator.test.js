const test = require("node:test");
const assert = require("node:assert/strict");
const { compareAdversarialCriticOutputs } = require("../dist/apps/cloud/src/ai/adversarialCriticDiversityComparator.js");

const proposalHash = "a".repeat(64);
const otherProposalHash = "b".repeat(64);

const output = (overrides = {}) => ({
  groupId: "group-a",
  providerId: "anthropic",
  modelVersionId: "claude-test",
  reviewedProposalHash: proposalHash,
  severity: "low",
  counterClaimCount: 1,
  failedAssumptionCount: 0,
  missingTestCount: 0,
  alternativeExplanationCount: 1,
  ...overrides
});

test("two independent providers agreeing on everything is CONSENSUS with NO_UPLIFT", () => {
  const result = compareAdversarialCriticOutputs([
    output({ groupId: "a" }),
    output({ groupId: "b", providerId: "openai", modelVersionId: "gpt-test" })
  ]);
  assert.equal(result.comparisonState, "CONSENSUS");
  assert.equal(result.trustDisposition, "NO_UPLIFT");
  assert.deepEqual(result.metrics.disagreementCodes, []);
});

test("outputs reviewing different proposals are not comparable and throw", () => {
  assert.throws(
    () => compareAdversarialCriticOutputs([
      output({ groupId: "a", reviewedProposalHash: proposalHash }),
      output({ groupId: "b", reviewedProposalHash: otherProposalHash })
    ]),
    /same reviewedProposalHash/
  );
});

test("a severity disagreement is DISAGREEMENT with full ABSTAIN, not a partial reduction", () => {
  const result = compareAdversarialCriticOutputs([
    output({ groupId: "a", severity: "low" }),
    output({ groupId: "b", severity: "critical" })
  ]);
  assert.equal(result.comparisonState, "DISAGREEMENT");
  assert.equal(result.trustDisposition, "ABSTAIN");
  assert.ok(result.metrics.disagreementCodes.includes("SEVERITY_DISAGREEMENT"));
});

test("agreeing on severity but disagreeing on issue counts is DISAGREEMENT with REDUCE, not ABSTAIN", () => {
  const result = compareAdversarialCriticOutputs([
    output({ groupId: "a", severity: "medium", counterClaimCount: 2 }),
    output({ groupId: "b", severity: "medium", counterClaimCount: 5 })
  ]);
  assert.equal(result.comparisonState, "DISAGREEMENT");
  assert.equal(result.trustDisposition, "REDUCE");
  assert.ok(result.metrics.disagreementCodes.includes("COUNTER_CLAIM_COUNT_MISMATCH"));
  assert.ok(!result.metrics.disagreementCodes.includes("SEVERITY_DISAGREEMENT"));
});

test("each count dimension is flagged independently", () => {
  const result = compareAdversarialCriticOutputs([
    output({ groupId: "a", failedAssumptionCount: 1, missingTestCount: 0, alternativeExplanationCount: 1 }),
    output({ groupId: "b", failedAssumptionCount: 2, missingTestCount: 0, alternativeExplanationCount: 1 })
  ]);
  assert.ok(result.metrics.disagreementCodes.includes("FAILED_ASSUMPTION_COUNT_MISMATCH"));
  assert.ok(!result.metrics.disagreementCodes.includes("MISSING_TEST_COUNT_MISMATCH"));
  assert.ok(!result.metrics.disagreementCodes.includes("ALTERNATIVE_EXPLANATION_COUNT_MISMATCH"));
});

test("fewer than 2 independent groups is INCOMPLETE with ABSTAIN, never consensus", () => {
  const single = compareAdversarialCriticOutputs([output({ groupId: "a" })]);
  assert.equal(single.comparisonState, "INCOMPLETE");
  assert.equal(single.trustDisposition, "ABSTAIN");
  assert.deepEqual(single.metrics.disagreementCodes, ["INSUFFICIENT_INDEPENDENT_GROUPS"]);

  const empty = compareAdversarialCriticOutputs([]);
  assert.equal(empty.comparisonState, "INCOMPLETE");
});

test("a duplicate groupId is rejected", () => {
  assert.throws(
    () => compareAdversarialCriticOutputs([output({ groupId: "a" }), output({ groupId: "a" })]),
    /groupId must be unique/
  );
});

test("an invalid severity value is rejected rather than silently coerced", () => {
  assert.throws(
    () => compareAdversarialCriticOutputs([output({ groupId: "a", severity: "extreme" }), output({ groupId: "b" })]),
    /severity must be one of/
  );
});

test("a malformed reviewedProposalHash is rejected", () => {
  assert.throws(
    () => compareAdversarialCriticOutputs([output({ groupId: "a", reviewedProposalHash: "not-a-hash" }), output({ groupId: "b", reviewedProposalHash: "not-a-hash" })]),
    /reviewedProposalHash must be sha256/
  );
});

test("three-way comparison requires ALL groups to agree, not just a majority", () => {
  const result = compareAdversarialCriticOutputs([
    output({ groupId: "a", severity: "low" }),
    output({ groupId: "b", severity: "low" }),
    output({ groupId: "c", severity: "high" })
  ]);
  assert.ok(result.metrics.disagreementCodes.includes("SEVERITY_DISAGREEMENT"));
});

test("comparison is deterministic given the same inputs", () => {
  const inputs = [output({ groupId: "a" }), output({ groupId: "b", providerId: "openai" })];
  const first = compareAdversarialCriticOutputs(inputs);
  const second = compareAdversarialCriticOutputs(inputs);
  assert.deepEqual(first, second);
});

test("liveAuthority and productionMutationAllowed never leave their zero-authority defaults", () => {
  const result = compareAdversarialCriticOutputs([output({ groupId: "a" }), output({ groupId: "b" })]);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});
