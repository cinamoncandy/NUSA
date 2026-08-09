const test = require("node:test");
const assert = require("node:assert/strict");
const { InferenceResourceLedger } = require("../dist/apps/cloud/src/ai/inferenceResourceLedger.js");
const { AgentExecutor } = require("../dist/apps/cloud/src/ai/agentExecutor.js");
const { projectAiReadOnly } = require("../dist/apps/cloud/src/ai/projection.js");

const policy = (overrides = {}) => Object.freeze({
  schemaVersion: 1,
  policyId: "TEST_AI_RESOURCE_BUDGET",
  policyVersion: "1",
  maxModelCalls: 4,
  maxTotalAttempts: 8,
  maxCumulativeOutputTokens: 16384,
  maxInputBytes: 1024 * 1024,
  maxWallClockMs: 90000,
  requireUsageAccounting: false,
  ...overrides
});

const request = (overrides = {}) => Object.freeze({
  requestId: "req-1",
  role: "STRATEGY_PROPOSER",
  providerId: "test-provider",
  modelVersionId: "model-v1",
  promptArtifactId: "prompt-1",
  promptArtifactVersion: "1",
  promptArtifactDigest: "a".repeat(64),
  instructions: "Return structured evidence-only analysis.",
  contextHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  input: Object.freeze({ evidence: [{ id: "e1", value: 1 }] }),
  maxOutputBytes: 32768,
  maxTokens: 2048,
  timeoutMs: 10000,
  attempt: 0,
  ...overrides
});

const response = (req, usage) => Object.freeze({
  requestId: req.requestId,
  providerId: req.providerId,
  modelVersionId: req.modelVersionId,
  promptArtifactDigest: req.promptArtifactDigest,
  contextHash: req.contextHash,
  inputHash: req.inputHash,
  structuredOutput: Object.freeze({ schemaVersion: 1, role: req.role, evidenceReferences: [], payload: {} }),
  outputHash: "d".repeat(64),
  usage,
  startedAt: 1000,
  completedAt: 1010
});

test("logical call budget fails closed before an extra model call can be admitted", () => {
  const ledger = new InferenceResourceLedger(policy({ maxModelCalls: 2 }), 1000);
  assert.equal(ledger.reserveCall("call-a", 1000), true);
  assert.equal(ledger.reserveCall("call-a", 1000), true, "exact duplicate logical call reservation is idempotent");
  assert.equal(ledger.reserveCall("call-b", 1001), true);
  assert.equal(ledger.reserveCall("call-c", 1002), false);
  const snapshot = ledger.snapshot(1002);
  assert.equal(snapshot.health, "EXHAUSTED");
  assert.equal(snapshot.failureCode, "CALL_BUDGET_EXHAUSTED");
  assert.equal(snapshot.modelCalls, 2);
  assert.equal(snapshot.liveAuthority, "NONE");
  assert.equal(snapshot.productionMutationAllowed, false);
});

test("output-token reservation and input-byte budget are enforced before provider inference", () => {
  const tokenLedger = new InferenceResourceLedger(policy({ maxCumulativeOutputTokens: 2048 }), 1000);
  const first = request();
  assert.equal(tokenLedger.reserveAttempt(first, 1000), true);
  assert.equal(tokenLedger.reserveAttempt(request({ requestId: "req-2", attempt: 0 }), 1001), false);
  assert.equal(tokenLedger.snapshot(1001).failureCode, "OUTPUT_TOKEN_BUDGET_EXHAUSTED");

  const byteLedger = new InferenceResourceLedger(policy({ maxInputBytes: 8 }), 1000);
  assert.equal(byteLedger.reserveAttempt(first, 1000), false);
  assert.equal(byteLedger.snapshot(1000).failureCode, "INPUT_BYTE_BUDGET_EXHAUSTED");
});

test("required provider usage missing or internally impossible becomes UNVERIFIED", () => {
  const missing = new InferenceResourceLedger(policy({ requireUsageAccounting: true }), 1000);
  const req = request();
  assert.equal(missing.reserveAttempt(req, 1000), true);
  assert.equal(missing.completeAttempt(req, response(req, undefined), 1010), false);
  assert.equal(missing.snapshot(1010).health, "UNVERIFIED");
  assert.equal(missing.snapshot(1010).failureCode, "USAGE_UNVERIFIED");

  const inconsistent = new InferenceResourceLedger(policy({ requireUsageAccounting: true }), 1000);
  assert.equal(inconsistent.reserveAttempt(req, 1000), true);
  assert.equal(inconsistent.completeAttempt(req, response(req, { inputTokens: 10, outputTokens: 10, totalTokens: 5 }), 1010), false);
  assert.equal(inconsistent.snapshot(1010).failureCode, "INVALID_USAGE");
});

test("provider output token usage cannot exceed the exact reserved maxTokens", () => {
  const ledger = new InferenceResourceLedger(policy({ requireUsageAccounting: true }), 1000);
  const req = request({ maxTokens: 16 });
  assert.equal(ledger.reserveAttempt(req, 1000), true);
  assert.equal(ledger.completeAttempt(req, response(req, { inputTokens: 10, outputTokens: 17, totalTokens: 27 }), 1010), false);
  const snapshot = ledger.snapshot(1010);
  assert.equal(snapshot.health, "UNVERIFIED");
  assert.equal(snapshot.failureCode, "INVALID_USAGE");
  assert.equal(snapshot.usageAccountingStatus, "UNAVAILABLE");
  assert.equal(snapshot.actualOutputTokens, null, "impossible usage must not be represented as trusted zero accounting");
});

test("attempt admission is single-use while conflicting replay still fails closed", () => {
  const replay = new InferenceResourceLedger(policy(), 1000);
  const req = request();
  assert.equal(replay.reserveAttempt(req, 1000), true);
  assert.equal(replay.reserveAttempt(req, 1000), false, "exact duplicate reservation must not re-authorize provider invocation");
  let snapshot = replay.snapshot(1000);
  assert.equal(snapshot.health, "HEALTHY");
  assert.equal(snapshot.attempts, 1);
  assert.equal(snapshot.attemptsEvidence.length, 1);

  assert.equal(replay.reserveAttempt(request({ maxTokens: 1024 }), 1001), false);
  snapshot = replay.snapshot(1001);
  assert.equal(snapshot.health, "UNVERIFIED");
  assert.equal(snapshot.failureCode, "RESOURCE_REPLAY_CONFLICT");
});

test("terminal attempt replay cannot regain admission authority", () => {
  const ledger = new InferenceResourceLedger(policy(), 1000);
  const req = request();
  assert.equal(ledger.reserveAttempt(req, 1000), true);
  assert.equal(ledger.completeAttempt(req, response(req, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }), 1010), true);
  assert.equal(ledger.completeAttempt(req, response(req, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }), 1010), true, "terminal evidence replay remains idempotent");
  assert.equal(ledger.reserveAttempt(req, 1010), false, "completed attempt must never grant another provider side effect");
  const snapshot = ledger.snapshot(1010);
  assert.equal(snapshot.health, "HEALTHY");
  assert.equal(snapshot.attempts, 1);
});

test("clock regression fails closed", () => {
  const clock = new InferenceResourceLedger(policy(), 1000);
  assert.equal(clock.reserveCall("call", 1001), true);
  assert.equal(clock.reserveCall("later", 999), false);
  assert.equal(clock.snapshot(1001).failureCode, "CLOCK_REGRESSION");
});

test("optional missing usage remains explicitly unavailable instead of zero", () => {
  const ledger = new InferenceResourceLedger(policy(), 1000);
  const req = request();
  assert.equal(ledger.reserveAttempt(req, 1000), true);
  assert.equal(ledger.completeAttempt(req, response(req, undefined), 1010), true);
  const snapshot = ledger.snapshot(1010);
  assert.equal(snapshot.health, "HEALTHY");
  assert.equal(snapshot.usageAccountingStatus, "UNAVAILABLE");
  assert.equal(snapshot.actualInputTokens, null);
  assert.equal(snapshot.actualOutputTokens, null);
  assert.equal(snapshot.actualTotalTokens, null);
  assert.equal(snapshot.attemptsEvidence[0].actualTotalTokens, null);
});

test("complete and partial usage are distinguished without inventing aggregate token totals", () => {
  const verified = new InferenceResourceLedger(policy(), 1000);
  const first = request();
  assert.equal(verified.reserveAttempt(first, 1000), true);
  assert.equal(verified.completeAttempt(first, response(first, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }), 1010), true);
  const verifiedSnapshot = verified.snapshot(1010);
  assert.equal(verifiedSnapshot.usageAccountingStatus, "VERIFIED");
  assert.equal(verifiedSnapshot.actualInputTokens, 10);
  assert.equal(verifiedSnapshot.actualOutputTokens, 5);
  assert.equal(verifiedSnapshot.actualTotalTokens, 15);

  const mixed = new InferenceResourceLedger(policy(), 1000);
  const one = request({ requestId: "mixed-1" });
  const two = request({ requestId: "mixed-2" });
  assert.equal(mixed.reserveAttempt(one, 1000), true);
  assert.equal(mixed.completeAttempt(one, response(one, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }), 1010), true);
  assert.equal(mixed.reserveAttempt(two, 1011), true);
  assert.equal(mixed.completeAttempt(two, response(two, undefined), 1020), true);
  const mixedSnapshot = mixed.snapshot(1020);
  assert.equal(mixedSnapshot.usageAccountingStatus, "PARTIAL");
  assert.equal(mixedSnapshot.actualInputTokens, null);
  assert.equal(mixedSnapshot.actualOutputTokens, null);
  assert.equal(mixedSnapshot.actualTotalTokens, null);
});

test("read-only projection preserves unknown usage rather than fabricating zero consumption", () => {
  const ledger = new InferenceResourceLedger(policy(), 1000);
  const req = request();
  assert.equal(ledger.reserveAttempt(req, 1000), true);
  assert.equal(ledger.completeAttempt(req, response(req, undefined), 1010), true);
  const result = Object.freeze({
    status: "INCOMPLETE",
    orchestrationRunId: "run-resource-projection",
    governanceDecision: null,
    independence: null,
    agents: Object.freeze([]),
    contexts: Object.freeze([]),
    runs: Object.freeze([]),
    failureCodes: Object.freeze([]),
    outputHashes: Object.freeze([]),
    structuredOutputs: Object.freeze([]),
    inferenceResources: ledger.snapshot(1010),
    liveAuthority: "NONE",
    realOrderAuthority: false,
    realTransferAuthority: false,
    productionMutationAllowed: false
  });
  const projected = projectAiReadOnly(result);
  assert.equal(projected.inferenceUsageAccountingStatus, "UNAVAILABLE");
  assert.equal(projected.inferenceActualInputTokens, null);
  assert.equal(projected.inferenceActualOutputTokens, null);
  assert.equal(projected.inferenceActualTotalTokens, null);
  assert.equal(projected.liveAuthority, "NONE");
  assert.equal(projected.productionMutationAllowed, false);
});

test("retry attempts share one budget and cannot escape maxTotalAttempts", async () => {
  let calls = 0;
  let now = 1000;
  const ledger = new InferenceResourceLedger(policy({ maxTotalAttempts: 1 }), 1000);
  const provider = {
    providerId: "test-provider",
    modelVersionId: "model-v1",
    infer: async () => { calls += 1; throw new Error("temporary provider failure"); }
  };
  const executor = new AgentExecutor(provider, 2, ledger, () => ++now);
  const result = await executor.execute(request(), () => { throw new Error("not reached"); });
  assert.equal(result.ok, false);
  assert.equal(calls, 1, "second retry must be blocked before provider invocation");
  const snapshot = ledger.snapshot(++now);
  assert.equal(snapshot.attempts, 1);
  assert.equal(snapshot.health, "EXHAUSTED");
  assert.equal(snapshot.failureCode, "ATTEMPT_BUDGET_EXHAUSTED");
});

test("wall-clock exhaustion prevents subsequent reservations", () => {
  const ledger = new InferenceResourceLedger(policy({ maxWallClockMs: 5 }), 1000);
  assert.equal(ledger.reserveCall("call-a", 1005), true);
  assert.equal(ledger.reserveCall("call-b", 1006), false);
  const snapshot = ledger.snapshot(1006);
  assert.equal(snapshot.health, "EXHAUSTED");
  assert.equal(snapshot.failureCode, "WALL_CLOCK_BUDGET_EXHAUSTED");
});
