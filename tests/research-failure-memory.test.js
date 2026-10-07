const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyResearchFailure, countResearchFailures, RESEARCH_FAILURE_REASONS } = require("../dist/apps/cloud/src/researchFailureMemory.js");

const evaluation = (metrics) => ({ strategyId: "s", strategyVersion: "1", authority: "ZERO_AUTHORITY", evaluatorVersion: "e", canonicalInputHash: "h", signal: "HOLD", metrics });
const base = { netReturn: 0.01, costAdjustedReturn: 0.005, maximumDrawdown: 0.1, executionQuality: 0.9 };
const evidence = (result, challenger, champion = base, extra = {}) => ({ result, reason: "MULTI_METRIC_COMPARISON", challenger: challenger === null ? null : evaluation(challenger), champion: champion === null ? null : evaluation(champion), ...extra });

test("a winning challenger has no failure reason", () => {
  assert.equal(classifyResearchFailure(evidence("CHALLENGER_BETTER", base)), null);
});

test("every other result maps to exactly one bounded reason in a fixed priority", () => {
  assert.equal(classifyResearchFailure(evidence("INCONCLUSIVE", base, base, { reason: "INCOMPLETE_COMPARISON_METRICS" })), "LOW_SAMPLE", "unusable evidence");
  assert.equal(classifyResearchFailure(evidence("INCONCLUSIVE", base, base, { reason: "EVALUATION_INVALID" })), "LOW_SAMPLE", "an invalid evaluation is not a completed comparison");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", null)), "LOW_SAMPLE", "no challenger evaluation");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", base, null)), "LOW_SAMPLE", "no champion evaluation");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, netReturn: Number.NaN })), "LOW_SAMPLE", "non-finite net return");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", base, base, { costEvidence: { grossReturn: 0.02, netReturn: -0.001 } })), "COST_SENSITIVE", "gross positive, net not");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, maximumDrawdown: 0.3 })), "EXCESSIVE_DRAWDOWN");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { ...base, executionQuality: 0.5 })), "EXECUTION_MISMATCH");
  assert.equal(classifyResearchFailure(evidence("EQUIVALENT", { ...base, netReturn: -0.01, costAdjustedReturn: -0.02 })), "NO_EDGE");
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", base, base, { costEvidence: { grossReturn: -0.01, netReturn: -0.02 } })), "NO_EDGE", "a negative gross return is not cost sensitivity");
  // Priority: cost sensitivity wins over drawdown and execution when several apply.
  assert.equal(classifyResearchFailure(evidence("CHAMPION_BETTER", { netReturn: 0.02, costAdjustedReturn: 0.02, maximumDrawdown: 0.9, executionQuality: 0.1 }, base, { costEvidence: { grossReturn: 0.02, netReturn: -0.001 } })), "COST_SENSITIVE");
});

test("a completed but mixed comparison is judged on its metrics, not called low sample", () => {
  // Higher net return but worse drawdown: the coordinator records INCONCLUSIVE with a completed-comparison reason.
  const mixed = evidence("INCONCLUSIVE", { ...base, netReturn: 0.05, maximumDrawdown: 0.4 });
  assert.equal(classifyResearchFailure(mixed), "EXCESSIVE_DRAWDOWN");
  assert.equal(classifyResearchFailure(evidence("INCONCLUSIVE", { ...base, netReturn: 0.05, executionQuality: 0.4 })), "EXECUTION_MISMATCH");
});

test("countResearchFailures aggregates only failures, keyed by the bounded reason", () => {
  const counts = countResearchFailures([
    evidence("CHALLENGER_BETTER", base),
    evidence("CHAMPION_BETTER", { ...base, maximumDrawdown: 0.5 }),
    evidence("CHAMPION_BETTER", { ...base, maximumDrawdown: 0.6 }),
    evidence("EQUIVALENT", { ...base, netReturn: -0.01 }),
  ]);
  assert.deepEqual({ ...counts }, { FAIL_EXCESSIVE_DRAWDOWN: 2, FAIL_NO_EDGE: 1 });
  assert.deepEqual({ ...countResearchFailures([]) }, {});
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
