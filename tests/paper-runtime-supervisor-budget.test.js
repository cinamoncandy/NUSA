const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  PaperRuntimeProcessSupervisor,
} = require("../scripts/paper-runtime-supervisor.js");

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
  }
  kill() {}
  exit(code = 1, signal = null) {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

function harness(overrides = {}) {
  let now = 1_000;
  let nextPid = 10;
  const launches = [];
  const timers = [];
  const logs = [];
  const supervisor = new PaperRuntimeProcessSupervisor({
    now: () => now,
    env: { NUSA_MODE: "PAPER" },
    spawn: (command, args, options) => {
      launches.push({ command, args, options });
      const child = new FakeChild(nextPid++);
      child.__harness = true;
      supervisor.__children.push(child);
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
    ...overrides,
  });
  supervisor.__children = [];
  return {
    supervisor,
    launches,
    timers,
    logs,
    children: () => supervisor.__children,
    advance(ms) { now += ms; },
    fire(index) { timers[index].fn(); },
  };
}

test("constructor rejects unbounded restart budgets", () => {
  assert.throws(() => new PaperRuntimeProcessSupervisor({ maxRestarts: 0 }), /SUPERVISOR_RESTART_BUDGET_UNBOUNDED/);
  assert.throws(() => new PaperRuntimeProcessSupervisor({ maxRestarts: 1.5 }), /SUPERVISOR_RESTART_BUDGET_UNBOUNDED/);
  assert.throws(
    () => new PaperRuntimeProcessSupervisor({ initialBackoffMs: 1_000, maxRestartWindowMs: 500 }),
    /SUPERVISOR_RESTART_WINDOW_INVALID/
  );
});

test("crash loop gives up as FAILED after the restart budget", () => {
  const { supervisor, children, timers, logs, fire } = harness({ maxRestarts: 3 });
  supervisor.start();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    children()[children().length - 1].exit(1);
    fire(timers.length - 1);
  }
  assert.equal(children().length, 4);
  children()[children().length - 1].exit(1);
  assert.equal(supervisor.snapshot().status, "FAILED");
  assert.equal(timers.filter((timer) => !timer.cleared).length, 3);
  assert.ok(logs.some((line) => line.includes("FAILED")));
});

test("restart window budget gives up on slow bleed", () => {
  const { supervisor, children, timers, advance, fire } = harness({ maxRestarts: 1_000, maxRestartWindowMs: 600 });
  supervisor.start();
  for (let cycle = 0; cycle < 7; cycle += 1) {
    advance(100);
    children()[children().length - 1].exit(1);
    if (supervisor.snapshot().status === "FAILED") break;
    fire(timers.length - 1);
  }
  assert.equal(supervisor.snapshot().status, "FAILED");
});

test("stable uptime restores the full budget and manual start recovers", () => {
  const { supervisor, children, timers, advance, fire } = harness({ maxRestarts: 2 });
  supervisor.start();
  children()[0].exit(1);
  fire(0);
  advance(5_000);
  children()[1].exit(1);
  assert.equal(supervisor.snapshot().status, "RECOVERING");
  fire(1);
  // Two consecutive unstable exits spend the budget of 2; the third gives up.
  children()[2].exit(1);
  fire(2);
  children()[3].exit(1);
  fire(3);
  children()[4].exit(1);
  assert.equal(supervisor.snapshot().status, "FAILED");
  const relaunched = supervisor.start();
  assert.equal(relaunched.status, "RUNNING");
  assert.equal(children().length, 6);
});
