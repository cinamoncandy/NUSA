"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DEFAULT_WRITER_LEASE_RETRY_MS,
  PAPER_WRITER_LEASE_CONFLICT_EXIT_CODE,
  PaperRuntimeProcessSupervisor,
} = require("../scripts/paper-runtime-supervisor.js");
const { launcherExitCode } = require("../scripts/start-cloud-runtime.js");

function fakeChild(pid = 1) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stderr = new EventEmitter();
  child.kill = () => { child.exitCode = 0; };
  return child;
}

function harness({ now = 1_000 } = {}) {
  const children = [];
  const timers = [];
  let clock = now;
  const supervisor = new PaperRuntimeProcessSupervisor({
    spawn: () => {
      const child = fakeChild(children.length + 1);
      children.push(child);
      return child;
    },
    setTimer: (fn, delay) => {
      const timer = { fn, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
    now: () => clock,
    write: () => {},
    writeError: () => {},
  });
  return { children, timers, supervisor, setNow: (value) => { clock = value; } };
}

test("launcher maps an active durable writer lease to the supervisor retry code", () => {
  assert.equal(
    launcherExitCode(1, null, "Error: PAPER_WRITER_ALREADY_ACTIVE"),
    PAPER_WRITER_LEASE_CONFLICT_EXIT_CODE,
  );
  assert.equal(launcherExitCode(1, null, "ordinary runtime failure"), 1);
  assert.equal(launcherExitCode(0, null, ""), 0);
  assert.equal(launcherExitCode(null, "SIGTERM", "PAPER_WRITER_ALREADY_ACTIVE"), 1);
});

test("writer-lease exit code waits beyond the durable lease instead of spinning 1/2/4/8 seconds", () => {
  const { children, timers, supervisor, setNow } = harness();
  supervisor.start();
  setNow(1_100);
  children[0].emit("exit", PAPER_WRITER_LEASE_CONFLICT_EXIT_CODE, null);

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, DEFAULT_WRITER_LEASE_RETRY_MS);
  assert.ok(timers[0].delay > 30_000);
  assert.equal(supervisor.snapshot().restartAttempt, 0, "lease wait must not inflate ordinary crash backoff");
  assert.equal(supervisor.snapshot().restartCount, 1);
});

test("direct runtime stderr lease conflict receives the same bounded lease wait", () => {
  const { children, timers, supervisor, setNow } = harness();
  supervisor.start();
  children[0].stderr.emit("data", Buffer.from("Error: PAPER_WRITER_ALREADY_ACTIVE\n"));
  setNow(1_100);
  children[0].emit("exit", 1, null);

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, DEFAULT_WRITER_LEASE_RETRY_MS);
  assert.equal(supervisor.snapshot().restartAttempt, 0);
  assert.equal(supervisor.snapshot().restartCount, 1);
});

test("ordinary crash retains the bounded exponential restart path", () => {
  const { children, timers, supervisor, setNow } = harness({ now: 2_000 });
  supervisor.start();
  setNow(2_100);
  children[0].emit("exit", 1, null);
  assert.equal(timers[0].delay, 1_000);
  assert.equal(supervisor.snapshot().restartAttempt, 1);

  timers[0].fn();
  setNow(2_300);
  children[1].emit("exit", 1, null);
  assert.equal(timers[1].delay, 2_000);
  assert.equal(supervisor.snapshot().restartAttempt, 2);
});
