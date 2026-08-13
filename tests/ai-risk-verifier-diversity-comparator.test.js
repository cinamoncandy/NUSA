const test = require("node:test");
const assert = require("node:assert/strict");
const { compareRiskVerifierOutputs } = require("../dist/apps/cloud/src/ai/riskVerifierDiversityComparator.js");

const output = (overrides = {}) => ({
  groupId: "group-a",
  providerId: "anthropic",
  modelVersionId: "claude-test",
  result: "verified",
  hardDenies: [],
  requiredEscalations: [],
  ...overrides
});

test("two independent providers agreeing on everything is CONSENSUS with NO_UPLIFT", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a" }),
    output({ groupId: "b", providerId: "openai", modelVersionId: "gpt-test" })
  ]);
  assert.equal(result.comparisonState, "CONSENSUS");
  assert.equal(result.trustDisposition, "NO_UPLIFT");
  assert.equal(result.metrics.decisionAgreement, true);
  assert.equal(result.metrics.hardDenyOverlapRatio, 1);
  assert.equal(result.metrics.requiredEscalationOverlapRatio, 1);
  assert.deepEqual(result.metrics.disagreementCodes, []);
});

test("a RESULT disagreement (verified vs denied) is DISAGREEMENT with full ABSTAIN, not a partial reduction", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a", result: "verified" }),
    output({ groupId: "b", result: "denied" })
  ]);
  assert.equal(result.comparisonState, "DISAGREEMENT");
  assert.equal(result.trustDisposition, "ABSTAIN");
  assert.ok(result.metrics.disagreementCodes.includes("RESULT_DISAGREEMENT"));
});

test("agreeing on the result but disagreeing on which hard denies apply is DISAGREEMENT with REDUCE, not ABSTAIN", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a", result: "denied", hardDenies: ["MAX_ORDER_NOTIONAL"] }),
    output({ groupId: "b", result: "denied", hardDenies: ["DAILY_LOSS_LIMIT"] })
  ]);
  assert.equal(result.comparisonState, "DISAGREEMENT");
  assert.equal(result.trustDisposition, "REDUCE");
  assert.ok(result.metrics.disagreementCodes.includes("HARD_DENY_MISMATCH"));
  assert.ok(!result.metrics.disagreementCodes.includes("RESULT_DISAGREEMENT"));
  assert.equal(result.metrics.hardDenyOverlapRatio, 0);
});

test("partial hard-deny overlap produces a fractional Jaccard ratio, not just a boolean", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a", result: "denied", hardDenies: ["A", "B"] }),
    output({ groupId: "b", result: "denied", hardDenies: ["B", "C"] })
  ]);
  // intersection {B} = 1, union {A,B,C} = 3
  assert.equal(result.metrics.hardDenyOverlapRatio, 1 / 3);
});

test("hard-deny comparison is case/whitespace-normalized", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a", result: "denied", hardDenies: [" max_order_notional "] }),
    output({ groupId: "b", result: "denied", hardDenies: ["MAX_ORDER_NOTIONAL"] })
  ]);
  assert.equal(result.metrics.hardDenyOverlapRatio, 1);
});

test("a required-escalation-only mismatch is flagged distinctly from a hard-deny mismatch", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a", result: "verified", requiredEscalations: ["MANUAL_REVIEW"] }),
    output({ groupId: "b", result: "verified", requiredEscalations: [] })
  ]);
  assert.ok(result.metrics.disagreementCodes.includes("ESCALATION_MISMATCH"));
  assert.ok(!result.metrics.disagreementCodes.includes("HARD_DENY_MISMATCH"));
});

test("fewer than 2 independent groups is INCOMPLETE, never scored as consensus", () => {
  const result = compareRiskVerifierOutputs([output({ groupId: "a" })]);
  assert.equal(result.comparisonState, "INCOMPLETE");
  assert.equal(result.trustDisposition, "ABSTAIN");
  assert.deepEqual(result.metrics.disagreementCodes, ["INSUFFICIENT_INDEPENDENT_GROUPS"]);

  const empty = compareRiskVerifierOutputs([]);
  assert.equal(empty.comparisonState, "INCOMPLETE");
});

test("a duplicate groupId is rejected -- the same group reporting twice is not independence", () => {
  assert.throws(
    () => compareRiskVerifierOutputs([output({ groupId: "a" }), output({ groupId: "a" })]),
    /groupId must be unique/
  );
});

test("an invalid result value is rejected rather than silently coerced", () => {
  assert.throws(
    () => compareRiskVerifierOutputs([output({ groupId: "a", result: "maybe" }), output({ groupId: "b" })]),
    /result must be verified, denied, or incomplete/
  );
});

test("three-way comparison requires ALL groups to agree for full overlap, not just a majority", () => {
  const result = compareRiskVerifierOutputs([
    output({ groupId: "a", hardDenies: ["X"] }),
    output({ groupId: "b", hardDenies: ["X"] }),
    output({ groupId: "c", hardDenies: [] })
  ]);
  // intersection is empty (c has none), union is {X} -> 0/1
  assert.equal(result.metrics.hardDenyOverlapRatio, 0);
  assert.ok(result.metrics.disagreementCodes.includes("HARD_DENY_MISMATCH"));
});

test("comparison is deterministic given the same inputs", () => {
  const inputs = [output({ groupId: "a" }), output({ groupId: "b", providerId: "openai" })];
  const first = compareRiskVerifierOutputs(inputs);
  const second = compareRiskVerifierOutputs(inputs);
  assert.deepEqual(first, second);
});

test("liveAuthority and productionMutationAllowed never leave their zero-authority defaults", () => {
  const result = compareRiskVerifierOutputs([output({ groupId: "a" }), output({ groupId: "b" })]);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});
