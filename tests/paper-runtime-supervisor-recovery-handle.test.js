const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PaperRuntimeProcessSupervisor } = require("../scripts/paper-runtime-supervisor.js");

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 42;
    this.exitCode = null;
  }

  kill() {}

  exit(code = 1, signal = null) {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

test("recovery timer stays referenced so the supervisor survives a child crash", () => {
  const children = [];
  const timers = [];
  const supervisor = new PaperRuntimeProcessSupervisor({
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    setTimer: (fn, delay) => {
      const timer = {
        fn,
        delay,
        unrefCalled: false,
        unref() { this.unrefCalled = true; },
      };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
    write: () => {},
    initialBackoffMs: 100,
    maxBackoffMs: 800,
  });

  supervisor.start();
  children[0].exit(1);

  assert.equal(supervisor.snapshot().status, "RECOVERING");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 100);
  assert.equal(timers[0].unrefCalled, false, "recovery timer must keep the supervisor process alive");

  timers[0].fn();
  assert.equal(children.length, 2);
  assert.equal(supervisor.snapshot().status, "RUNNING");
});
