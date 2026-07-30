const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCausalGraph } = require("../dist/apps/cloud/src/causalReasoning.js");

const claim = (claimId) => ({ claimId, statement: claimId, evidenceIds: [`evidence-${claimId}`] });

test("causal graph is ordered and immutable", () => {
  const graph = buildCausalGraph([claim("cause"), claim("effect")], [{ causeId: "cause", effectId: "effect", strength: 0.8 }]);
  assert.deepEqual(graph.orderedClaimIds, ["cause", "effect"]);
  assert.equal(Object.isFrozen(graph), true);
});

test("causal cycles and unsupported links fail closed", () => {
  assert.throws(() => buildCausalGraph([claim("a"), claim("b")], [{ causeId: "a", effectId: "b", strength: 0.5 }, { causeId: "b", effectId: "a", strength: 0.5 }]), /cycle/);
  assert.throws(() => buildCausalGraph([claim("a")], [{ causeId: "a", effectId: "missing", strength: 0.5 }]), /unknown/);
});
