const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyResearchFailure, RESEARCH_FAILURE_REASONS } = require("../dist/apps/cloud/src/researchFailureMemory.js");

const evaluation = (metrics) => ({ strategyId: "s", strategyVersion: "1", authority: "ZERO_AUTHORITY", evaluatorVersion: "e", canonicalInputHash: "h", signal: "HOLD", metrics });
const base = { netReturn: 0.01, costAdjustedReturn: 0.005, maximumDrawdown: 0.1, executionQuality: 0.9 };
const evidence = (result, challenger, champion = base) => ({ result, challenger: challenger === null ? null : evaluation(challenger), champion: champion === null ? null : evaluation(champion) });

test("a winning challenger has no failure reason", () => {
  assert.equal(classifyResearchFailure(evidence("CHALLENGER_BETTER", base)), null);
});

test("every other result maps to exactly one bounded reason in a fixed priority", () => {
  assert.equal(classifyResearchFailure(evidence("INCONCLUSIVE", base)), "LOW_SAMPLE");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", null)), "LOW_SAMPLE", "no challenger evaluation");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", base, null)), "LOW_SAMPLE", "no champion evaluation");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, netReturn: Number.NaN })), "LOW_SAMPLE", "non-finite net return");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, netReturn: 0.02, costAdjustedReturn: -0.001 })), "COST_SENSITIVE");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, maximumDrawdown: 0.3 })), "EXCESSIVE_DRAWDOWN");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, executionQuality: 0.5 })), "EXECUTION_MISMATCH");
  assert.equal(classifyResearchFailure(evidence("EQUIVALENT", { ...base, netReturn: -0.01, costAdjustedReturn: -0.02 })), "NO_EDGE");
  // Priority: cost sensitivity wins over drawdown and execution when several apply.
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { netReturn: 0.02, costAdjustedReturn: -0.001, maximumDrawdown: 0.9, executionQuality: 0.1 })), "COST_SENSITIVE");
});

test("classification is deterministic and always inside the bounded set", () => {
  const cases = [["INCONCLUSIVE", base], ["CHAMPION_BETTER", { ...base, maximumDrawdown: 0.5 }], ["EQUIVALENT", base]];
  for (const [result, challenger] of cases) {
    const first = classifyResearchFailure(evidence(result, challenger));
    assert.equal(classifyResearchFailure(evidence(result, challenger)), first);
    assert.ok(RESEARCH_FAILURE_REASONS.includes(first));
  }
});

test("the reason codes fit the /health count key pattern", () => {
  for (const reason of RESEARCH_FAILURE_REASONS) assert.match(`FAIL_${reason}`, /^[A-Z][A-Z0-9_]{1,47}$/);
});
