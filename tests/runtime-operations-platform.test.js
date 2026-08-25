const test = require("node:test");
const assert = require("node:assert/strict");

const { RuntimeEventBus } = require("../dist/apps/cloud/src/runtimeEventBus.js");
const { buildRuntimeReplay } = require("../dist/apps/cloud/src/runtimeReplay.js");
const { createRuntimeIncidentReport } = require("../dist/apps/cloud/src/runtimeIncidentReport.js");
const { buildOperatorTimeline } = require("../dist/apps/cloud/src/operatorTimeline.js");
const { buildRuntimeOperatorView } = require("../dist/apps/desktop/src/cloud/runtimeOperatorView.js");
const { buildMobileRuntimeOperatorCard } = require("../dist/apps/mobile/src/runtimeOperatorView.js");

const events = [
  { id: "e1", runId: "r1", type: "RUN_STARTED", occurredAt: 100, payload: {} },
  { id: "e2", runId: "r1", type: "STAGE_COMPLETED", occurredAt: 110, payload: { stage: "Research", status: "FAILED" } }
];

const failedRun = {
  runId: "r1",
  status: "FAILED",
  startedAt: 100,
  completedAt: 110,
  stages: [{ stage: "Research", status: "FAILED", startedAt: 100, completedAt: 110, durationMs: 10, reason: "timeout" }],
  skippedStages: ["Risk", "Publish"],
  killSwitchRecommended: true
};

const health = {
  generatedAt: 120,
  status: "CRITICAL",
  score: 64,
  consecutiveFailures: 1,
  lastSuccessfulRunAt: null,
  snapshotAgeMs: 5,
  queueDepth: 0,
  ipcHealthy: true,
  killSwitchActive: false,
  reasons: ["Research stage is CRITICAL"],
  stages: []
};

test("event bus delivers immutable events and rejects duplicate ids", async () => {
  const bus = new RuntimeEventBus();
  const received = [];
  bus.subscribe("RUN_STARTED", (event) => received.push(event));
  await bus.publish(events[0]);
  assert.equal(received.length, 1);
  assert.ok(Object.isFrozen(received[0]));
  await assert.rejects(() => bus.publish(events[0]), /duplicate runtime event id/);
});

test("replay, incident, timeline, desktop and mobile views compose read-only", () => {
  const replay = buildRuntimeReplay(events);
  const incident = createRuntimeIncidentReport(failedRun, 120);
  const timeline = buildOperatorTimeline(replay, [incident]);
  const desktop = buildRuntimeOperatorView(health, timeline, "PAPER");
  const mobile = buildMobileRuntimeOperatorCard(desktop, 2);

  assert.equal(replay.frames.length, 2);
  assert.equal(incident.severity, "CRITICAL");
  assert.equal(timeline.at(-1).title, "FAILED INCIDENT");
  assert.equal(desktop.actions.length, 0);
  assert.equal(mobile.readOnly, true);
  assert.equal(mobile.latestItems.length, 2);
  assert.ok(Object.isFrozen(desktop));
  assert.ok(Object.isFrozen(mobile));
});

test("replay rejects mixed runs and mobile bounds fail closed", () => {
  assert.throws(() => buildRuntimeReplay([...events, { ...events[0], id: "e3", runId: "r2" }]), /cannot mix runIds/);
  const replay = buildRuntimeReplay(events);
  const timeline = buildOperatorTimeline(replay, []);
  const desktop = buildRuntimeOperatorView(health, timeline, "DRY_RUN");
  assert.throws(() => buildMobileRuntimeOperatorCard(desktop, 0), /positive safe integer/);
});
