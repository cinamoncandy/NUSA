const test = require("node:test");
const assert = require("node:assert/strict");
const { observeJevCodingFailureShadow } = require("../dist/apps/autopilot/src/jevCodingFailureShadow.js");

const req = { headSha: "a".repeat(40), workflowRunId: 42, executionId: "e:1", dedupeKey: "d:1", reason: "ci-failure:42" };

test("deterministic pre-filter skips already-classified failures", async () => {
  for (const failureClass of ["transient", "validation_failure", "permission_auth", "infrastructure", "executor_unavailable", "unsafe_ambiguous", null]) {
    assert.equal(await observeJevCodingFailureShadow({ runnerRequest: req, failureReason: "x", failureClass, env: { NUSA_JEV_SHADOW_ENABLED: "true" } }), null);
  }
});

test("provider-capacity stops never spend another native Jev call", async () => {
  for (const failureReason of ["WORKERS_AI_DAILY_QUOTA_EXHAUSTED", "WORKERS_AI_RATE_LIMITED", "WAITING_PROVIDER_CAPACITY", "BLOCKED_RATE_LIMIT"]) {
    let calls = 0;
    const receipt = await observeJevCodingFailureShadow({
      runnerRequest: req,
      failureReason,
      failureClass: "deterministic",
      env: { NUSA_JEV_SHADOW_ENABLED: "true", AI: { async run() { calls += 1; return {}; } } },
    });
    assert.equal(receipt, null);
    assert.equal(calls, 0);
  }
});

test("eligible unknown deterministic failure emits typed shadow fallback without provider", async () => {
  const receipt = await observeJevCodingFailureShadow({ runnerRequest: req, failureReason: "UNCLASSIFIED_FAILURE", failureClass: "deterministic", env: { NUSA_JEV_SHADOW_ENABLED: "true" } });
  assert.equal(receipt.decisionType, "WORKFLOW_FAILURE_CLASSIFICATION");
  assert.equal(receipt.selectedOutcome, "INSUFFICIENT_EVIDENCE");
  assert.equal(receipt.usableForRouting, false);
  assert.equal(receipt.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(receipt.productionMutationAllowed, false);
  assert.equal(receipt.liveAuthority, "NONE");
  assert.equal(receipt.domainObservation.taskType, "WORKFLOW_FAILURE_CLASSIFICATION");
  assert.equal(receipt.domainObservation.domain, "AUTOPILOT_DEVELOPMENT");
  assert.equal(receipt.domainObservation.inputFingerprint, receipt.stateFingerprint);
  assert.equal(receipt.domainObservation.usableForRouting, false);
  assert.equal(receipt.domainObservation.aiAuthority, "ZERO_AUTHORITY");
});

test("disabled Jev preserves existing path and emits non-routing evidence", async () => {
  const receipt = await observeJevCodingFailureShadow({ runnerRequest: req, failureReason: "UNCLASSIFIED_FAILURE", failureClass: "deterministic", env: {} });
  assert.equal(receipt.selectedOutcome, "INSUFFICIENT_EVIDENCE");
  assert.equal(receipt.reasonCode, "SHADOW_FALLBACK");
  assert.equal(receipt.usableForRouting, false);
});

test("native Workers AI binding uses the lower-neuron Jev shadow model with bounded evidence and canonical usage telemetry", async () => {
  let calls = 0;
  let seenModel = "";
  let seenPrompt = "";
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    const receipt = await observeJevCodingFailureShadow({
      runnerRequest: req,
      failureReason: "TEST_ASSERTION_MISMATCH token=secret-value",
      failureClass: "deterministic",
      env: {
        NUSA_JEV_SHADOW_ENABLED: "true",
        AI: {
          async run(model, input) {
            calls += 1;
            seenModel = model;
            seenPrompt = String(input.prompt);
            return {
              response: JSON.stringify({ rootCause: "TEST", safeToAutofix: "NO", severity: 3, requiredModel: "TERRA", confidence: 0.93 }),
              usage: { prompt_tokens: 11, completion_tokens: 7 },
            };
          },
        },
      },
    });
    assert.equal(calls, 1);
    assert.equal(seenModel, "@cf/meta/llama-3.1-8b-instruct-fast");
    assert.match(seenPrompt, /TEST_ASSERTION_MISMATCH/);
    assert.doesNotMatch(seenPrompt, /secret-value/);
    assert.equal(receipt.selectedOutcome, "TEST");
    assert.match(receipt.model, /^workers-ai:/);
    assert.equal(receipt.usableForRouting, false);
    assert.equal(receipt.domainObservation.decision.rootCause, "TEST");
    assert.equal(receipt.domainObservation.decision.requiredModel, "TERRA");
    assert.equal(receipt.domainObservation.usableForRouting, false);
    const usage = JSON.parse(lines.find((line) => line.includes('"NUSA_AI_CALL"')));
    assert.equal(usage.caller, "C3_JEV");
    assert.equal(usage.model, seenModel);
    assert.equal(usage.promptTokens, 11);
    assert.equal(usage.completionTokens, 7);
    assert.equal(usage.estimatedNeurons, 0.29);
    const event = JSON.parse(lines.find((line) => line.includes("NUSA_JEV_WORKERS_AI_SHADOW_CALL")));
    assert.equal(event.provider, "workers-ai");
    assert.equal(event.promptTokens, 11);
    assert.equal(event.completionTokens, 7);
    assert.equal(event.usableForRouting, false);
    assert.equal(event.aiAuthority, "ZERO_AUTHORITY");
    assert.ok(event.timestamp);
  } finally {
    console.log = original;
  }
});
