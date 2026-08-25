const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ShadowLongRunningDiagnosticsSampler } = require("../dist/apps/desktop/src/shadow/shadowLongRunningDiagnostics.js");

function source(state = "RUNNING") {
  return {
    timestamp: 0,
    sessionId: "shadow-long-1",
    sessionState: state,
    observationStartedAt: 1_000,
    elapsedTime: 0,
    signalCount: 0,
    evidenceCount: 0,
    marketListenerCount: 1,
    marketSubscriptionCount: 1,
    hostIntervalCount: 0,
    hostTimeoutCount: 0,
    lastEventAt: null,
    lastEvidenceAt: null,
    actualOrderCount: 0,
    actualFillCount: 0,
    cashMutationCount: 0,
    positionMutationCount: 0,
    brokerCallCount: 0,
    privateApiCallCount: 0
  };
}

test("A4K: fake long observation keeps one timer/listener/subscription and records snapshots", () => {
  let clock = 1_000;
  let scheduled;
  let cleared = 0;
  let memoryIndex = 0;
  const memory = [100, 130, 115, 125].map((heapUsed) => ({ rss: 500, heapUsed, heapTotal: 1_000, external: 10, arrayBuffers: 2 }));
  const current = source();
  const sampler = new ShadowLongRunningDiagnosticsSampler({
    intervalMs: 1_000,
    now: () => clock,
    readSource: () => ({ ...current, timestamp: clock, elapsedTime: clock - 1_000 }),
    readMemory: () => memory[memoryIndex++] || memory.at(-1),
    setInterval: (callback) => { scheduled = callback; return Symbol("interval"); },
    clearInterval: () => { cleared += 1; }
  });

  sampler.start("shadow-long-1");
  assert.equal(sampler.diagnostics().activeIntervalCount, 1);
  assert.equal(sampler.diagnostics().marketListenerCount, 1);
  assert.equal(sampler.diagnostics().marketSubscriptionCount, 1);
  current.signalCount = 2;
  current.evidenceCount = 2;
  clock += 1_000;
  scheduled();
  clock += 1_000;
  scheduled();
  assert.equal(sampler.diagnostics().snapshots.length, 3);
  assert.equal(sampler.diagnostics().signalCount, 2);
  assert.equal(sampler.diagnostics().evidenceCount, 2);
  assert.equal(sampler.diagnostics().memoryHealth, "MEMORY_STABLE");
  sampler.stop();
  const final = sampler.diagnostics();
  assert.equal(cleared, 1);
  assert.equal(final.activeIntervalCount, 0);
  assert.equal(final.activeTimeoutCount, 0);
  assert.equal(final.snapshots.length, 4);
  assert.equal(final.actualOrderCount, 0);
  assert.equal(final.actualFillCount, 0);
  assert.equal(final.cashMutationCount, 0);
  assert.equal(final.positionMutationCount, 0);
  assert.equal(final.brokerCallCount, 0);
  assert.equal(final.privateApiCallCount, 0);
});

test("A4K: sustained monotonic heap growth is MEMORY_GROWTH_SUSPECTED, not silently healthy", () => {
  let scheduled;
  let index = 0;
  const values = [100, 200, 300, 400];
  const sampler = new ShadowLongRunningDiagnosticsSampler({
    intervalMs: 1_000,
    readSource: () => source(),
    readMemory: () => ({ rss: 1, heapUsed: values[index++] ?? 300, heapTotal: 1, external: 0, arrayBuffers: 0 }),
    setInterval: (callback) => { scheduled = callback; return 1; },
    clearInterval: () => {}
  });
  sampler.start("shadow-long-1");
  scheduled();
  scheduled();
  assert.equal(sampler.diagnostics().memoryHealth, "MEMORY_GROWTH_SUSPECTED");
});

test("A4K: read-only diagnostics are surfaced in the control room and procedure is documented", () => {
  const root = path.resolve(__dirname, "..");
  const ui = fs.readFileSync(path.join(root, "apps/desktop/renderer/control-room.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "apps/desktop/renderer/control-room.css"), "utf8");
  const guide = fs.readFileSync(path.join(root, "docs/operations/shadow-long-running-observation.md"), "utf8");
  assert.match(ui, /longRunning/);
  assert.match(ui, /activeIntervalCount/);
  assert.match(css, /cr-shadow__long-running/);
  assert.match(guide, /30 minutes/);
  assert.match(guide, /read-only/);
  assert.match(guide, /private API/i);
});

/** A sampler driven by a fake clock and fake timers -- no real waiting, no real memory. */
function fakeSampler(overrides = {}) {
  let clock = 1_000;
  let handle;
  let cleared = 0;
  let tick = () => {};
  const current = { ...source(), ...(overrides.source ?? {}) };
  const heaps = overrides.heaps ?? [100, 110, 105, 108, 102];
  let heapIndex = 0;
  const sampler = new ShadowLongRunningDiagnosticsSampler({
    intervalMs: overrides.intervalMs ?? 1_000,
    now: () => clock,
    readSource: () => ({ ...current, timestamp: clock, elapsedTime: clock - 1_000 }),
    readMemory: () => ({ rss: 500, heapUsed: heaps[Math.min(heapIndex++, heaps.length - 1)], heapTotal: 1_000, external: 10, arrayBuffers: 2 }),
    setInterval: (callback) => { tick = callback; handle = { id: 1 }; return handle; },
    clearInterval: () => { cleared += 1; handle = undefined; }
  });
  return {
    sampler,
    current,
    advance: (ms) => { clock += ms; tick(); },
    clearedCount: () => cleared,
    handleLive: () => handle !== undefined
  };
}

test("A4K: an hour of fake elapsed time accumulates one snapshot per interval", () => {
  // Fake timers only: a test that actually waited an hour could never run in CI, which is
  // the same reason the observation itself needed a rehearsal path.
  const h = fakeSampler({ intervalMs: 60_000, heaps: Array.from({ length: 64 }, (_, index) => 100 + (index % 5)) });
  h.sampler.start("shadow-hour-1");
  for (let minute = 0; minute < 60; minute += 1) h.advance(60_000);

  const diagnostics = h.sampler.diagnostics();
  // One at start plus one per elapsed minute.
  assert.equal(diagnostics.snapshots.length, 61, `snapshots: ${diagnostics.snapshots.length}`);
  assert.equal(diagnostics.elapsedTime, 3_600_000);
  assert.equal(diagnostics.currentSessionId, "shadow-long-1");
  // Timestamps advance strictly: a stalled clock would make the series meaningless.
  const timestamps = diagnostics.snapshots.map((snapshot) => snapshot.timestamp);
  assert.deepEqual(timestamps, [...timestamps].sort((left, right) => left - right));
  assert.equal(new Set(timestamps).size, timestamps.length, "no duplicate sample timestamps");
});

test("A4K: timer, listener and subscription counts stay flat across a long observation", () => {
  const h = fakeSampler({ intervalMs: 60_000, source: { hostIntervalCount: 2, hostTimeoutCount: 0 } });
  h.sampler.start("shadow-hour-2");
  for (let minute = 0; minute < 30; minute += 1) h.advance(60_000);

  const snapshots = h.sampler.diagnostics().snapshots;
  // Host's two intervals plus the sampler's own. A count that drifts upward over an
  // observation is the leak this diagnostic exists to surface.
  for (const snapshot of snapshots) {
    assert.equal(snapshot.activeIntervalCount, 3, "interval count must not drift");
    assert.equal(snapshot.activeTimeoutCount, 0);
    assert.equal(snapshot.listenerCount, 1, "listener count must not drift");
    assert.equal(snapshot.marketSubscriptionCount, 1, "subscription count must not drift");
  }
  assert.equal(new Set(snapshots.map((snapshot) => snapshot.activeIntervalCount)).size, 1);
});

test("A4K: the host's timers are counted, not assumed to be zero", () => {
  // The earlier version reported activeTimeoutCount as a hardcoded 0 -- a number that looked
  // measured and was not. It now comes from the host.
  const h = fakeSampler({ source: { hostIntervalCount: 2, hostTimeoutCount: 3 } });
  h.sampler.start("shadow-count");
  const snapshot = h.sampler.diagnostics().snapshots[0];
  assert.equal(snapshot.activeTimeoutCount, 3);
  assert.equal(snapshot.activeIntervalCount, 3, "two host intervals plus the sampler's own");
  assert.equal(snapshot.timerCount, 6);
});

test("A4K: stopping clears the sampler's timer and leaves nothing scheduled", () => {
  const h = fakeSampler({ intervalMs: 60_000 });
  h.sampler.start("shadow-cleanup");
  h.advance(60_000);
  assert.ok(h.handleLive(), "the timer runs while the observation does");

  h.sampler.stop();
  assert.equal(h.clearedCount(), 1, "the interval must be cleared exactly once");
  assert.equal(h.handleLive(), false);
  assert.equal(h.sampler.diagnostics().activeIntervalCount, 0, "no interval is attributed to a stopped sampler");
});

test("A4K: a second session starts from a clean diagnostic slate", () => {
  const h = fakeSampler({ intervalMs: 60_000 });
  h.sampler.start("shadow-session-one");
  for (let minute = 0; minute < 5; minute += 1) h.advance(60_000);
  assert.ok(h.sampler.diagnostics().snapshots.length >= 6);
  h.sampler.stop();
  h.sampler.reset();

  // Carrying the previous session's samples forward would let one session's memory trend be
  // read as the next one's.
  assert.equal(h.sampler.diagnostics().snapshots.length, 0);
  assert.equal(h.sampler.diagnostics().memoryHealth, "INSUFFICIENT_SAMPLES");

  h.sampler.start("shadow-session-two");
  h.advance(60_000);
  const snapshots = h.sampler.diagnostics().snapshots;
  assert.equal(snapshots.length, 2, "only this session's samples");
});

test("A4K: fewer than three samples is INSUFFICIENT_SAMPLES, never an optimistic pass", () => {
  const h = fakeSampler({ intervalMs: 60_000, heaps: [100, 100] });
  h.sampler.start("shadow-few");
  assert.equal(h.sampler.diagnostics().memoryHealth, "INSUFFICIENT_SAMPLES");
  h.advance(60_000);
  assert.equal(h.sampler.diagnostics().memoryHealth, "INSUFFICIENT_SAMPLES", "two samples is still not a trend");
});

test("A4K: every real-mutation counter stays zero for the whole observation", () => {
  const h = fakeSampler({ intervalMs: 60_000 });
  h.sampler.start("shadow-mutation");
  for (let minute = 0; minute < 30; minute += 1) h.advance(60_000);

  const diagnostics = h.sampler.diagnostics();
  for (const [name, value] of [
    ["actualOrderCount", diagnostics.actualOrderCount],
    ["actualFillCount", diagnostics.actualFillCount],
    ["cashMutationCount", diagnostics.cashMutationCount],
    ["positionMutationCount", diagnostics.positionMutationCount],
    ["brokerCallCount", diagnostics.brokerCallCount],
    ["privateApiCallCount", diagnostics.privateApiCallCount]
  ]) {
    assert.equal(value, 0, `${name} must be zero`);
  }
  // And in every retained sample, not only in the final reading.
  for (const snapshot of diagnostics.snapshots) {
    assert.equal(snapshot.actualOrderCount + snapshot.actualFillCount + snapshot.cashMutationCount + snapshot.positionMutationCount + snapshot.brokerCallCount + snapshot.privateApiCallCount, 0);
  }
});

test("A4K: the sampler places no order and reaches no authenticated endpoint", () => {
  const code = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "shadow", "shadowLongRunningDiagnostics.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["PaperBroker", "execute(", "api.upbit.com", "access_key", "secret_key", "node:http", "fetch(", "node:fs"]) {
    assert.equal(code.includes(forbidden), false, `the sampler must not reference ${forbidden}`);
  }
});
