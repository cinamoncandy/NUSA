const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  PaperRuntimeProcessSupervisor,
  boundedBackoffMs,
} = require("../scripts/paper-runtime-supervisor.js");

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.killedWith = null;
  }
  kill(signal) {
    this.killedWith = signal;
  }
  exit(code = 1, signal = null) {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

function harness() {
  let now = 1_000;
  let nextPid = 10;
  const children = [];
  const timers = [];
  const logs = [];
  const supervisor = new PaperRuntimeProcessSupervisor({
    now: () => now,
    spawn: () => {
      const child = new FakeChild(nextPid++);
      children.push(child);
      return child;
    },
    setTimer: (fn, delay) => {
      const timer = { fn, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    write: (line) => logs.push(line),
    initialBackoffMs: 100,
    maxBackoffMs: 800,
    stableWindowMs: 1_000,
  });
  return {
    supervisor,
    children,
    timers,
    logs,
    advance(ms) { now += ms; },
    fire(index) { timers[index].fn(); },
  };
}

test("bounded restart backoff is deterministic and capped", () => {
  assert.equal(boundedBackoffMs(0, 100, 800), 100);
  assert.equal(boundedBackoffMs(1, 100, 800), 200);
  assert.equal(boundedBackoffMs(2, 100, 800), 400);
  assert.equal(boundedBackoffMs(3, 100, 800), 800);
  assert.equal(boundedBackoffMs(10, 100, 800), 800);
});

test("supervisor restarts a failed PAPER runtime with bounded backoff", () => {
  const h = harness();
  const initial = h.supervisor.start();
  assert.equal(initial.status, "RUNNING");
  assert.equal(h.children.length, 1);

  h.advance(100);
  h.children[0].exit(1);
  const recovering = h.supervisor.snapshot();
  assert.equal(recovering.status, "RECOVERING");
  assert.equal(recovering.restartCount, 1);
  assert.equal(h.timers[0].delay, 100);

  h.fire(0);
  assert.equal(h.children.length, 2);
  assert.equal(h.supervisor.snapshot().status, "RUNNING");

  h.advance(100);
  h.children[1].exit(1);
  assert.equal(h.timers[1].delay, 200);
  assert.equal(h.supervisor.snapshot().restartCount, 2);
});

test("stable runtime uptime resets exponential recovery penalty", () => {
  const h = harness();
  h.supervisor.start();

  h.advance(100);
  h.children[0].exit(1);
  h.fire(0);
  h.advance(1_500);
  h.children[1].exit(1);

  assert.equal(h.timers[1].delay, 100);
  assert.equal(h.supervisor.snapshot().restartAttempt, 1);
});

test("intentional stop cancels recovery and never restarts", () => {
  const h = harness();
  h.supervisor.start();
  const stopped = h.supervisor.stop("SIGTERM");
  assert.equal(stopped.status, "STOPPING");
  assert.equal(h.children[0].killedWith, "SIGTERM");

  h.children[0].exit(0, "SIGTERM");
  assert.equal(h.timers.length, 0);
  assert.equal(h.supervisor.snapshot().status, "STOPPING");
});

test("supervisor surface cannot grant LIVE or production mutation authority", () => {
  const h = harness();
  h.supervisor.start();
  const snapshot = h.supervisor.snapshot();
  assert.equal(snapshot.liveAuthority, "NONE");
  assert.equal(snapshot.productionMutationAllowed, false);
});
