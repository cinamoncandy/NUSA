const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperScenarioEvidenceRecorder } = require("../dist/apps/desktop/src/paper/paperScenarioEvidenceRecorder.js");

test("recorder binds every runtime event to the explicit Paper session", () => {
  const events = [];
  const recorder = new PaperScenarioEvidenceRecorder({ append: (event) => { events.push(event); return { event }; } }, "paper-session-1");
  recorder.sessionObserved("s1", 1); recorder.orderCompleted("o1", 2); recorder.faultScenarioPassed("f1", 3, "KILL_SWITCH");
  assert.deepEqual(events.map((event) => event.sessionId), ["paper-session-1", "paper-session-1", "paper-session-1"]);
  assert.equal(events[1].type, "ORDER_COMPLETED");
});

test("recorder rejects missing session and event identity", () => {
  assert.throws(() => new PaperScenarioEvidenceRecorder({ append: () => ({}) }, " "), /sessionId/);
  const recorder = new PaperScenarioEvidenceRecorder({ append: () => ({}) }, "s");
  assert.throws(() => recorder.record({ eventId: " ", type: "SESSION_OBSERVED", occurredAt: 1 }), /eventId/);
});
