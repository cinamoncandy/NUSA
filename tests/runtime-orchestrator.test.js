const test = require("node:test");
const assert = require("node:assert/strict");
const { RuntimeOrchestrator, InMemoryRuntimeRecorder } = require("../dist/apps/cloud/src/runtimeOrchestrator.js");

const context = (overrides = {}) => ({
  runId: "run-1",
  paperSessionId: "paper-1",
  startedAt: 100,
  killSwitchActive: false,
  data: {},
  ...overrides
});

const stage = (name, status = "SUCCESS", reason) => ({
  name,
  async execute() {
    return {
      stage: name,
      status,
      startedAt: 101,
      completedAt: 103,
      durationMs: 2,
      ...(reason ? { reason } : {})
    };
  }
});

test("runs stages in order and records immutable success", async () => {
  const recorder = new InMemoryRuntimeRecorder();
  const seen = [];
  const stages = ["research", "opportunity", "committee"].map((name) => ({
    name,
    async execute() {
      seen.push(name);
      return { stage: name, status: "SUCCESS", startedAt: 101, completedAt: 102, durationMs: 1 };
    }
  }));
  const result = await new RuntimeOrchestrator(stages, recorder).run(context(), () => 110);
  assert.deepEqual(seen, ["research", "opportunity", "committee"]);
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(result.skippedStages, []);
  assert.equal(result.killSwitchRecommended, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.stages));
  assert.equal(recorder.all().length, 1);
});

test("blocked stage stops all following stages without kill-switch recommendation", async () => {
  const recorder = new InMemoryRuntimeRecorder();
  const result = await new RuntimeOrchestrator([
    stage("research"),
    stage("risk", "BLOCKED", "research gate denied"),
    stage("publish")
  ], recorder).run(context(), () => 110);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.stages.map((item) => item.stage), ["research", "risk"]);
  assert.deepEqual(result.skippedStages, ["publish"]);
  assert.equal(result.killSwitchRecommended, false);
});

test("exception becomes failed result and stops following stages", async () => {
  const recorder = new InMemoryRuntimeRecorder();
  const result = await new RuntimeOrchestrator([
    stage("research"),
    { name: "committee", async execute() { throw new Error("committee crashed"); } },
    stage("publish")
  ], recorder).run(context(), () => 105);
  assert.equal(result.status, "FAILED");
  assert.equal(result.stages[1].status, "FAILED");
  assert.match(result.stages[1].reason, /committee crashed/);
  assert.deepEqual(result.skippedStages, ["publish"]);
  assert.equal(result.killSwitchRecommended, true);
});

test("active kill switch blocks before any stage runs", async () => {
  const recorder = new InMemoryRuntimeRecorder();
  let called = false;
  const result = await new RuntimeOrchestrator([{ name: "research", async execute() { called = true; } }], recorder)
    .run(context({ killSwitchActive: true }), () => 100);
  assert.equal(called, false);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.skippedStages, ["research"]);
});

test("invalid stage output fails closed", async () => {
  const recorder = new InMemoryRuntimeRecorder();
  const result = await new RuntimeOrchestrator([{
    name: "risk",
    async execute() { return { stage: "wrong", status: "SUCCESS", startedAt: 1, completedAt: 1, durationMs: 0 }; }
  }], recorder).run(context(), () => 105);
  assert.equal(result.status, "FAILED");
  assert.match(result.stages[0].reason, /stage mismatch/);
});

test("duplicate stage names and duplicate run ids are rejected", async () => {
  const recorder = new InMemoryRuntimeRecorder();
  assert.throws(() => new RuntimeOrchestrator([stage("risk"), stage("risk")], recorder), /unique/);
  const orchestrator = new RuntimeOrchestrator([stage("risk")], recorder);
  await orchestrator.run(context(), () => 110);
  await assert.rejects(() => orchestrator.run(context(), () => 110), /duplicate runtime runId/);
});
