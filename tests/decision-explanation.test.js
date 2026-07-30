const test = require("node:test");
const assert = require("node:assert/strict");
const { explainDecision } = require("../dist/apps/cloud/src/decisionExplanation.js");

test("decision explanation preserves evidence and remains non-authoritative", () => {
  const result = explainDecision({ recommendation: "WAIT", supportingEvidence: ["trend unclear"], counterEvidence: ["volatility elevated"], uncertainty: "HIGH" });
  assert.match(result.shortSummary, /^WAIT:/);
  assert.deepEqual(result.whyNot, ["volatility elevated"]);
  assert.equal(result.productionMutationAllowed, false);
});

test("explanation without evidence fails closed", () => {
  assert.throws(() => explainDecision({ recommendation: "BUY", supportingEvidence: [], counterEvidence: [], uncertainty: "LOW" }), /requires evidence/);
});
