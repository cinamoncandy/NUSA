const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ShadowLongRunningDiagnosticsSampler } = require("../dist/apps/desktop/src/shadowLongRunningDiagnostics.js");

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
  assert.equal(sampler.diagnostics().memoryHealth, "STABLE");
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

test("A4K: sustained monotonic heap growth is diagnostic UNSTABLE, not silently healthy", () => {
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
  assert.equal(sampler.diagnostics().memoryHealth, "UNSTABLE");
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
