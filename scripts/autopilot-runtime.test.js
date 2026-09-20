const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AutopilotRuntime, SAFETY } = require("./autopilot-runtime.js");

async function tempState() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-autopilot-runtime-"));
  return { directory, file: path.join(directory, "runtime-state.json") };
}

test("persists work, restores state, and continues after process restart", async () => {
  const { directory, file } = await tempState();
  try {
    let calls = 0;
    const first = new AutopilotRuntime({ statePath: file, tick: async () => ({ status: "EXECUTION_DISPATCHED", reason: "task-1", headSha: "a".repeat(40), workflowRunId: 1 }), intervalMs: 5000 });
    await first.cycle();
    const restored = new AutopilotRuntime({ statePath: file, tick: async () => { calls += 1; return { status: "DUPLICATE_EXECUTION_SUPPRESSED", reason: "dedupe", headSha: "a".repeat(40), workflowRunId: 1 }; }, intervalMs: 5000 });
    await restored.load();
    assert.equal(restored.snapshot().stateRecovery, "RESTORED");
    await restored.cycle();
    assert.equal(calls, 1);
    assert.equal(restored.snapshot().iteration, 2);
    assert.deepEqual({ liveAuthority: restored.snapshot().liveAuthority, productionMutationAllowed: restored.snapshot().productionMutationAllowed, aiAuthority: restored.snapshot().aiAuthority }, SAFETY);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("bounds transient retries and remains available for the next cycle", async () => {
  const { directory, file } = await tempState();
  try {
    let calls = 0;
    const runtime = new AutopilotRuntime({ statePath: file, maxAttempts: 3, backoffMs: 0, sleep: async () => {}, tick: async () => { calls += 1; throw new Error("network-down"); } });
    const state = await runtime.cycle();
    assert.equal(calls, 3);
    assert.equal(state.status, "BLOCKED");
    assert.equal(state.failureCount, 1);
    assert.equal(state.blockedCount, 1);
    assert.equal(state.retryCount, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("corrupt state fails closed without dispatching a task", async () => {
  const { directory, file } = await tempState();
  try {
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 999, liveAuthority: "NONE" }));
    let called = false;
    const runtime = new AutopilotRuntime({ statePath: file, tick: async () => { called = true; return { status: "EXECUTION_DISPATCHED" }; } });
    const state = await runtime.start();
    assert.equal(state.status, "BLOCKED");
    assert.equal(state.stateRecovery, "CORRUPT");
    assert.equal(called, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("serializes concurrent cycles so a task is never double-dispatched", async () => {
  const { directory, file } = await tempState();
  try {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const runtime = new AutopilotRuntime({ statePath: file, tick: async () => { calls += 1; await gate; return { status: "ABSTAINED", reason: "empty" }; } });
    const first = runtime.cycle();
    const second = runtime.cycle();
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
