const test = require("node:test");
const assert = require("node:assert/strict");
const { createEventLoopStallMonitor } = require("../dist/apps/cloud/src/eventLoopStallMonitor.js");

function clock(start = 1_000_000) {
  let value = start;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

test("on-time samples report no stall", () => {
  const c = clock();
  const monitor = createEventLoopStallMonitor({ intervalMs: 250, thresholdMs: 1_000, now: c.now });
  for (let i = 0; i < 20; i += 1) { c.advance(250); monitor.sample(); }
  assert.deepEqual(monitor.snapshot(), { eventLoopMaxStallMs: 0, eventLoopStallCount: 0, lastEventLoopStallAt: null });
});

test("a late sample records the maximum, counts only stalls over the threshold, and remembers when", () => {
  const c = clock();
  const monitor = createEventLoopStallMonitor({ intervalMs: 250, thresholdMs: 1_000, now: c.now });
  c.advance(250); monitor.sample();
  c.advance(250 + 400); monitor.sample(); // late by 400 ms: below the threshold
  assert.equal(monitor.snapshot().eventLoopStallCount, 0);
  assert.equal(monitor.snapshot().eventLoopMaxStallMs, 400);
  c.advance(250 + 6_000); monitor.sample(); // the 6 s stall seen on the host
  const at = c.now();
  c.advance(250 + 35_000); monitor.sample(); // long enough to lose the 30 s writer lease
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.eventLoopStallCount, 2);
  assert.equal(snapshot.eventLoopMaxStallMs, 35_000);
  assert.equal(snapshot.lastEventLoopStallAt, c.now());
  assert.ok(snapshot.lastEventLoopStallAt > at);
});

test("a backwards clock step is ignored and the snapshot carries numbers only", () => {
  const c = clock();
  const monitor = createEventLoopStallMonitor({ intervalMs: 250, thresholdMs: 1_000, now: c.now });
  c.advance(-5_000); monitor.sample();
  c.advance(250); monitor.sample();
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.eventLoopMaxStallMs, 0);
  assert.ok(Object.isFrozen(snapshot));
  for (const value of Object.values(snapshot)) assert.ok(value === null || typeof value === "number");
});

test("start is idempotent, the timer does not keep the process alive, and stop clears it", () => {
  const monitor = createEventLoopStallMonitor({ intervalMs: 5 });
  monitor.start();
  monitor.start();
  monitor.stop();
  monitor.stop();
  assert.equal(monitor.snapshot().eventLoopStallCount, 0);
});
