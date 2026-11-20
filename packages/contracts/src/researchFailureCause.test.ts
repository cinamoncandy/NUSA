import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RESEARCH_FAILURE_CAUSES, classifyFailureCause, type ResearchFailureCause } from "./researchFailureCause";

const metrics = (patch: Record<string, number> = {}) => ({ netReturn: 0.01, costAdjustedReturn: 0.01, maximumDrawdown: 0.1, sharpeRatio: 1, executionQuality: 0.9, tradeCount: 20, ...patch });
const evidence = (patch: Record<string, unknown> = {}) => ({ result: "CHAMPION_BETTER", reason: "MULTI_METRIC_COMPARISON", champion: { metrics: metrics() }, challenger: { metrics: metrics() }, ...patch });

// [input, expected, source of the code]
const GOLDEN: readonly (readonly [string, unknown, ResearchFailureCause])[] = [
  ["researchFailureMemory.ts FAIL_NO_EDGE", "FAIL_NO_EDGE", "NO_EDGE"],
  ["researchFailureMemory.ts FAIL_LOW_SAMPLE", "FAIL_LOW_SAMPLE", "DATA_INSUFFICIENT"],
  ["researchFailureMemory.ts FAIL_COST_SENSITIVE", "FAIL_COST_SENSITIVE", "COST_DOMINATED"],
  ["researchFailureMemory.ts FAIL_EXCESSIVE_DRAWDOWN", "FAIL_EXCESSIVE_DRAWDOWN", "EXCESSIVE_DRAWDOWN"],
  ["researchFailureMemory.ts FAIL_EXECUTION_MISMATCH", "FAIL_EXECUTION_MISMATCH", "EXECUTION_MISMATCH"],
  ["researchFailureMemory.ts REPEAT_NO_EDGE (derived streak count, not an experiment)", "REPEAT_NO_EDGE", "UNCLASSIFIED"],
  ["researchExperimentOrchestrator.ts NOT_DUE", "NOT_DUE", "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["researchExperimentOrchestrator.ts outcome NOT_DUE", { status: "NOT_DUE" }, "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["researchExperimentOrchestrator.ts NO_CANDLES", { status: "NO_CANDLES" }, "DATA_INSUFFICIENT"],
  ["researchExperimentRunner.ts SKIPPED DATASET_MANIFEST_ID_MISSING", { status: "SKIPPED", reason: "DATASET_MANIFEST_ID_MISSING" }, "DATA_INSUFFICIENT"],
  ["researchExperimentRunner.ts SKIPPED DATASET_MANIFEST_VOLUME_MISSING", { status: "SKIPPED", reason: "DATASET_MANIFEST_VOLUME_MISSING" }, "DATA_INSUFFICIENT"],
  ["researchExperimentRunner.ts SKIPPED DATASET_MANIFEST_BINDING_MISMATCH", { status: "SKIPPED", reason: "DATASET_MANIFEST_BINDING_MISMATCH" }, "STALE_EVIDENCE"],
  ["researchExperimentRunner.ts SKIPPED DATASET_MANIFEST_RANGE_MISMATCH", { status: "SKIPPED", reason: "DATASET_MANIFEST_RANGE_MISMATCH" }, "STALE_EVIDENCE"],
  ["researchExperimentRunner.ts SKIPPED DATASET_MANIFEST_CONTENT_MISMATCH (count key form)", "SKIPPED_DATASET_MANIFEST_CONTENT_MISMATCH", "STALE_EVIDENCE"],
  ["researchWalkForwardWindows.ts WINDOWS_INSUFFICIENT_HISTORY_TRAIN", { status: "SKIPPED", reason: "WINDOWS_INSUFFICIENT_HISTORY_TRAIN" }, "DATA_INSUFFICIENT"],
  ["researchWalkForwardWindows.ts WINDOWS_TOO_MANY_GAPS", "SKIPPED_WINDOWS_TOO_MANY_GAPS", "DATA_INSUFFICIENT"],
  ["researchWalkForwardWindows.ts WINDOWS_NO_CANDLES", { status: "SKIPPED", reason: "WINDOWS_NO_CANDLES" }, "DATA_INSUFFICIENT"],
  ["researchWalkForwardWindows.ts WINDOWS_INVALID_CANDLES", { status: "SKIPPED", reason: "WINDOWS_INVALID_CANDLES" }, "DATA_INSUFFICIENT"],
  ["researchWalkForwardWindows.ts WINDOWS_INVALID_CONFIG", { status: "SKIPPED", reason: "WINDOWS_INVALID_CONFIG" }, "DESIGN_REJECTED"],
  ["researchWalkForwardWindows.ts WINDOWS_INVALID_FOLD_COUNT", { status: "SKIPPED", reason: "WINDOWS_INVALID_FOLD_COUNT" }, "DESIGN_REJECTED"],
  ["researchExperimentRunner.ts ERROR EXPERIMENT_FAILED (not guessed)", { status: "ERROR", reason: "EXPERIMENT_FAILED" }, "UNCLASSIFIED"],
  ["researchExperimentRunner.ts ERROR PROVENANCE_<code> (not guessed)", { status: "ERROR", reason: "PROVENANCE_X" }, "UNCLASSIFIED"],
  ["researchExperimentRunner.ts HOLDOUT_ALREADY_USED", { status: "COMPLETED", validation: evidence({ result: "CHALLENGER_BETTER" }), holdout: null, holdoutNote: "HOLDOUT_ALREADY_USED" }, "DEPENDENCE_UNVERIFIED"],
  ["researchExperimentRunner.ts HOLDOUT_OVERLAPS_USED", "HOLDOUT_OVERLAPS_USED", "DEPENDENCE_UNVERIFIED"],
  ["researchExperimentRunner.ts VALIDATION_NOT_FAVOURABLE, validation cost-sensitive", { status: "COMPLETED", validation: evidence({ costEvidence: { grossReturn: 0.02, netReturn: -0.01 } }), holdout: null, holdoutNote: "VALIDATION_NOT_FAVOURABLE" }, "COST_DOMINATED"],
  ["researchExperimentRunner.ts holdout evaluated and lost on drawdown", { status: "COMPLETED", validation: evidence({ result: "CHALLENGER_BETTER" }), holdout: evidence({ challenger: { metrics: metrics({ maximumDrawdown: 0.3 }) } }) }, "EXCESSIVE_DRAWDOWN"],
  ["researchExperimentRunner.ts holdout evaluated and won", { status: "COMPLETED", validation: evidence({ result: "CHALLENGER_BETTER" }), holdout: evidence({ result: "CHALLENGER_BETTER" }) }, "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["researchExperimentRunner.ts COMPLETED with no note and no holdout (not guessed)", { status: "COMPLETED", validation: evidence(), holdout: null }, "UNCLASSIFIED"],
  ["researchExperimentOrchestrator.ts VALIDATION_CHALLENGER_BETTER", "VALIDATION_CHALLENGER_BETTER", "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["researchExperimentOrchestrator.ts HOLDOUT_CHALLENGER_BETTER", "HOLDOUT_CHALLENGER_BETTER", "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["researchExperimentOrchestrator.ts VALIDATION_CHAMPION_BETTER (bare key, no metrics: not guessed)", "VALIDATION_CHAMPION_BETTER", "UNCLASSIFIED"],
  ["researchRuntime.ts result CHALLENGER_BETTER", evidence({ result: "CHALLENGER_BETTER" }), "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["researchRuntime.ts champion better, no other signal", evidence(), "NO_EDGE"],
  ["researchRuntime.ts EQUIVALENT", evidence({ result: "EQUIVALENT" }), "NO_EDGE"],
  ["researchRuntime.ts INCONCLUSIVE with missing challenger", evidence({ result: "INCONCLUSIVE", challenger: null }), "DATA_INSUFFICIENT"],
  ["researchRuntime.ts incomplete comparison reason", evidence({ reason: "INCOMPLETE" }), "DATA_INSUFFICIENT"],
  // Deliberate difference from classifyResearchFailure (documented in the pre-registration section 2): a missing or non-string reason is a completed comparison.
  ["no reason at all is a completed comparison", evidence({ reason: undefined }), "NO_EDGE"],
  ["a non-string reason is a completed comparison", evidence({ reason: 5 as unknown as string }), "NO_EDGE"],
  ["the two comparison reasons are completed comparisons", evidence({ reason: "NET_RETURN_COMPARISON" }), "NO_EDGE"],
  ["researchRuntime.ts worse execution quality", evidence({ challenger: { metrics: metrics({ executionQuality: 0.5 }) } }), "EXECUTION_MISMATCH"],
  ["researchAutomationRuntime.ts stored result_json (metrics directly, no reason)", { result: "CHAMPION_BETTER", champion: metrics(), challenger: metrics({ maximumDrawdown: 0.4 }) }, "EXCESSIVE_DRAWDOWN"],
  ["researchFailureMemory.ts non-finite challenger netReturn is LOW_SAMPLE", { result: "CHAMPION_BETTER", champion: { netReturn: 1 }, challenger: { netReturn: Number.NaN } }, "DATA_INSUFFICIENT"],
  ["researchQualificationIdentity.ts DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD", "DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD", "NO_EDGE"],
  ["researchQualificationIdentity.ts REGIME_FRAGILE_EDGE", "REGIME_FRAGILE_EDGE", "REGIME_FRAGILE"],
  ["researchQualificationIdentity.ts DEFLATED_SHARPE_EVIDENCE_MISSING", "DEFLATED_SHARPE_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
  ["researchQualificationIdentity.ts COST_SENSITIVITY_EVIDENCE_MISSING", "COST_SENSITIVITY_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
  ["researchQualificationIdentity.ts PBO_EVIDENCE_MISSING", "PBO_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
  ["researchQualificationIdentity.ts REGIME_ROBUSTNESS_EVIDENCE_MISSING", "REGIME_ROBUSTNESS_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
  ["researchQualificationIdentity.ts REGIME_ROBUSTNESS_EVIDENCE_INSUFFICIENT", "REGIME_ROBUSTNESS_EVIDENCE_INSUFFICIENT", "DATA_INSUFFICIENT"],
  ["researchQualificationIdentity.ts TRIAL_LEDGER_EVIDENCE_MISSING", "TRIAL_LEDGER_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
];

const MALFORMED: readonly (readonly [string, unknown])[] = [
  ["undefined", undefined], ["null", null], ["number", 7], ["NaN", Number.NaN], ["boolean", true], ["array", []], ["empty object", {}], ["empty string", ""],
  ["unknown string", "SOMETHING_NEW"], ["FAIL_ unknown reason", "FAIL_MYSTERY"], ["prototype key", "__proto__"], ["constructor key", "constructor"],
  ["unknown status", { status: "WEIRD" }], ["SKIPPED without reason", { status: "SKIPPED" }], ["non-string reason", { status: "ERROR", reason: 5 }],
  ["COMPLETED without validation", { status: "COMPLETED" }], ["result of wrong type", { result: 3 }], ["unknown result value", { result: "MAYBE" }],
  ["bigint", 1n], ["symbol", Symbol("x")], ["function", () => 1],
];

describe("classifyFailureCause", () => {
  for (const [label, input, expected] of GOLDEN) it(`${label} -> ${expected}`, () => assert.equal(classifyFailureCause(input).cause, expected));

  for (const [label, input] of MALFORMED) it(`malformed (${label}) is UNCLASSIFIED and does not throw`, () => assert.equal(classifyFailureCause(input).cause, "UNCLASSIFIED"));

  it("a throwing getter does not escape", () => {
    const hostile = { get status(): string { throw new Error("boom"); } };
    assert.equal(classifyFailureCause(hostile).cause, "UNCLASSIFIED");
  });

  it("every class in the fixed list is reachable from the golden table", () => {
    const reached = new Set(GOLDEN.map(([, input]) => classifyFailureCause(input).cause));
    for (const cause of RESEARCH_FAILURE_CAUSES) assert.ok(reached.has(cause), `${cause} is not reachable`);
    assert.equal(reached.size, RESEARCH_FAILURE_CAUSES.length);
  });

  it("the class list is fixed and frozen", () => {
    assert.equal(RESEARCH_FAILURE_CAUSES.length, 11);
    assert.ok(Object.isFrozen(RESEARCH_FAILURE_CAUSES));
  });

  it("is deterministic and does not mutate or echo its input", () => {
    const input = evidence();
    const before = JSON.stringify(input);
    const first = classifyFailureCause(input), second = classifyFailureCause(input);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(Object.keys(first).sort(), ["basis", "cause"]);
  });
});
