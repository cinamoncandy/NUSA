const test = require("node:test");
const assert = require("node:assert/strict");
const { EquityHistoryRecorder } = require("../dist/apps/server/src/equityHistory.js");

test("record() appends samples in order", () => {
  const recorder = new EquityHistoryRecorder();
  recorder.record(1, 100);
  recorder.record(2, 110);
  recorder.record(3, 105);
  assert.deepEqual(recorder.history(), [
    { timestamp: 1, equity: 100 },
    { timestamp: 2, equity: 110 },
    { timestamp: 3, equity: 105 }
  ]);
});

test("history() starts empty", () => {
  assert.deepEqual(new EquityHistoryRecorder().history(), []);
});

test("oldest samples are dropped once maxSamples is exceeded (ring buffer)", () => {
  const recorder = new EquityHistoryRecorder(3);
  recorder.record(1, 100);
  recorder.record(2, 200);
  recorder.record(3, 300);
  recorder.record(4, 400);
  assert.deepEqual(recorder.history(), [
    { timestamp: 2, equity: 200 },
    { timestamp: 3, equity: 300 },
    { timestamp: 4, equity: 400 }
  ]);
});

test("history() returns a frozen snapshot; later record() calls don't mutate a previously returned array", () => {
  const recorder = new EquityHistoryRecorder();
  recorder.record(1, 100);
  const snapshot = recorder.history();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot[0]));
  recorder.record(2, 200);
  assert.equal(snapshot.length, 1);
});

test("maxSamples must be a positive integer", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new EquityHistoryRecorder(bad));
  }
});
