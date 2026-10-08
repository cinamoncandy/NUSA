const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyResearchFailure, countResearchFailures, summarizeStrategyFailureHistory, countRepeatedFailures, RESEARCH_FAILURE_REASONS } = require("../dist/apps/cloud/src/researchFailureMemory.js");

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

const challengerEvidence = (id, version, at, result, metrics, evaluationId = `e${at}`) => ({
  evaluationId, evaluationTimestamp: at, result, reason: "MULTI_METRIC_COMPARISON", strategyId: id, strategyVersion: version,
  challenger: { ...evaluation(metrics), strategyId: id, strategyVersion: version }, champion: evaluation(base),
});
const drawdown = { ...base, maximumDrawdown: 0.5 };
const edge = { ...base, netReturn: -0.01 };

test("failure history is per challenger, ordered by evaluation time, and counts the trailing same-reason streak", () => {
  const records = [
    challengerEvidence("rsi", "1", 30, "CHAMPION_BETTER", drawdown),
    challengerEvidence("sma", "1", 10, "CHAMPION_BETTER", edge),
    challengerEvidence("rsi", "1", 10, "CHAMPION_BETTER", edge),
    challengerEvidence("rsi", "1", 20, "CHAMPION_BETTER", drawdown),
    challengerEvidence("sma", "1", 20, "CHALLENGER_BETTER", base),
  ];
  const history = summarizeStrategyFailureHistory(records);
  assert.deepEqual(history.map((item) => item.strategyId), ["rsi", "sma"]);
  const rsi = history[0], sma = history[1];
  assert.deepEqual({ evaluations: rsi.evaluations, failures: rsi.failures, lastReason: rsi.lastReason, repeatStreak: rsi.repeatStreak, byReason: { ...rsi.byReason } }, { evaluations: 3, failures: 3, lastReason: "EXCESSIVE_DRAWDOWN", repeatStreak: 2, byReason: { NO_EDGE: 1, EXCESSIVE_DRAWDOWN: 2 } });
  assert.deepEqual({ lastReason: sma.lastReason, repeatStreak: sma.repeatStreak, failures: sma.failures }, { lastReason: null, repeatStreak: 0, failures: 1 }, "a later win clears the streak but the earlier failure is kept");
});

test("the same records give the same history in any input order, and repeated failures are counted per bounded reason", () => {
  const records = [
    challengerEvidence("a", "1", 1, "CHAMPION_BETTER", drawdown, "x1"), challengerEvidence("a", "1", 1, "CHAMPION_BETTER", drawdown, "x2"),
    challengerEvidence("b", "1", 1, "CHAMPION_BETTER", edge, "y1"), challengerEvidence("b", "1", 2, "CHAMPION_BETTER", edge, "y2"),
    challengerEvidence("c", "1", 1, "CHAMPION_BETTER", edge, "z1"),
  ];
  assert.deepEqual(summarizeStrategyFailureHistory([...records].reverse()), summarizeStrategyFailureHistory(records));
  assert.deepEqual({ ...countRepeatedFailures(summarizeStrategyFailureHistory(records)) }, { REPEAT_EXCESSIVE_DRAWDOWN: 1, REPEAT_NO_EDGE: 1 }, "c failed once, so it is not a repeat");
  assert.deepEqual({ ...countRepeatedFailures(summarizeStrategyFailureHistory(records), 3) }, {});
});

test("a failed evaluation is charged to the requested strategy even when the evaluator threw or returned another identity", () => {
  assert.deepEqual([...summarizeStrategyFailureHistory([])], []);
  const threw = { evaluationId: "n1", evaluationTimestamp: 1, result: "INCONCLUSIVE", reason: "EVALUATION_INVALID", strategyId: "rsi", strategyVersion: "1", challenger: null, champion: null };
  const wrongIdentity = { ...challengerEvidence("other", "9", 2, "CHAMPION_BETTER", edge, "n2"), strategyId: "rsi", strategyVersion: "1", reason: "EVALUATION_INVALID" };
  const history = summarizeStrategyFailureHistory([threw, wrongIdentity]);
  assert.deepEqual(history.map((item) => `${item.strategyId}@${item.strategyVersion}`), ["rsi@1"], "never charged to the untrusted returned identity");
  assert.deepEqual({ lastReason: history[0].lastReason, repeatStreak: history[0].repeatStreak }, { lastReason: "LOW_SAMPLE", repeatStreak: 2 });
  assert.deepEqual({ ...countRepeatedFailures(history) }, { REPEAT_LOW_SAMPLE: 1 });
  assert.deepEqual([...summarizeStrategyFailureHistory([{ ...threw, strategyId: "" }])], [], "a record without a requested identity is skipped");
});
