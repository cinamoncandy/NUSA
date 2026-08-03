const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  InMemoryOrderExecutionRepository,
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  reconcileUnknownSubmissions
} = execution;

function unknownRecord(overrides = {}) {
  return {
    executionId: "execution-1",
    intentId: "intent-1",
    idempotencyKey: "client-1",
    payloadHash: "hash-1",
    status: OrderSubmissionStatus.SUBMISSION_UNKNOWN,
    reason: "timeout",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides
  };
}

const policy = { overdueAfterMs: 100, criticalAfterMs: 500, maximumRecordsPerRun: 1 };

function seedFourUnresolvable(executions) {
  ["a", "b", "c", "d"].forEach((letter, index) => {
    executions.save(unknownRecord({
      executionId: `execution-${letter}`,
      intentId: `intent-${letter}`,
      idempotencyKey: `client-${letter}`,
      payloadHash: `hash-${letter}`,
      createdAtMs: 1000 + index,
      updatedAtMs: 1000 + index
    }));
  });
}

test("without a cursor, the oldest unresolved submission starves every newer one forever", () => {
  const executions = new InMemoryOrderExecutionRepository();
  seedFourUnresolvable(executions);
  const scannedAcrossRuns = new Set();
  for (let i = 0; i < 5; i += 1) {
    const provider = new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]);
    const run = reconcileUnknownSubmissions(1200, executions, provider, policy);
    run.items.forEach(item => scannedAcrossRuns.add(item.assessment.intentId));
  }
  assert.deepEqual([...scannedAcrossRuns], ["intent-a"], "intents b, c, d are never reachable without advancing a cursor");
});

test("passing nextCursor forward across runs eventually reconciles every unresolved submission", () => {
  const executions = new InMemoryOrderExecutionRepository();
  seedFourUnresolvable(executions);
  const scannedAcrossRuns = new Set();
  let cursor;
  for (let i = 0; i < 4; i += 1) {
    const provider = new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]);
    const run = reconcileUnknownSubmissions(1200, executions, provider, policy, undefined, undefined, cursor);
    run.items.forEach(item => scannedAcrossRuns.add(item.assessment.intentId));
    cursor = run.nextCursor;
  }
  assert.deepEqual([...scannedAcrossRuns].sort(), ["intent-a", "intent-b", "intent-c", "intent-d"]);
});

test("a cursor pointing at a since-resolved record falls back to a full rescan from the start", () => {
  const executions = new InMemoryOrderExecutionRepository();
  seedFourUnresolvable(executions);
  const run = reconcileUnknownSubmissions(
    1200,
    executions,
    new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]),
    policy,
    undefined,
    undefined,
    "execution-does-not-exist-anymore"
  );
  assert.equal(run.items[0].assessment.intentId, "intent-a");
});

test("nextCursor is undefined when nothing was scanned", () => {
  const executions = new InMemoryOrderExecutionRepository();
  const run = reconcileUnknownSubmissions(1200, executions, new ScriptedSyntheticOrderProvider([], []), policy);
  assert.equal(run.nextCursor, undefined);
  assert.equal(run.truncated, false);
});
