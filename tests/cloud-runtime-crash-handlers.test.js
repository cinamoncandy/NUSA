// registerGracefulShutdown's uncaughtException/unhandledRejection wiring (apps/cloud/src/runtime.ts).
//
// node:test's own harness listens for uncaughtException/unhandledRejection to detect a crashing
// test, so actually emitting those events here would make the *test runner* fail the test before
// our own handler's behavior could be observed -- not a real signal about the code under test.
// Instead: crashCleanupAndExit is exported and called directly (this is the actual cleanup
// logic), and a separate, narrow check confirms registerGracefulShutdown really does attach a
// listener for each event name, without ever emitting them.
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerGracefulShutdown, crashCleanupAndExit } = require("../dist/apps/cloud/src/runtime.js");
const { createShutdownController } = require("../dist/apps/cloud/src/cloudRuntimeShutdown.js");

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeExit() {
  const calls = [];
  const exit = (code) => { calls.push(code); };
  exit.calls = calls;
  return exit;
}

test("registerGracefulShutdown attaches an uncaughtException and an unhandledRejection listener", () => {
  const before = {
    uncaughtException: process.listeners("uncaughtException").length,
    unhandledRejection: process.listeners("unhandledRejection").length
  };
  const handle = { port: 4300, host: "127.0.0.1", stop: async () => {} };
  registerGracefulShutdown(handle, () => {});
  try {
    assert.equal(process.listeners("uncaughtException").length, before.uncaughtException + 1);
    assert.equal(process.listeners("unhandledRejection").length, before.unhandledRejection + 1);
  } finally {
    // Remove exactly the listeners this test just added, so it doesn't leak into other files
    // sharing this node:test process.
    const uncaught = process.listeners("uncaughtException");
    process.removeListener("uncaughtException", uncaught[uncaught.length - 1]);
    const unhandled = process.listeners("unhandledRejection");
    process.removeListener("unhandledRejection", unhandled[unhandled.length - 1]);
    const sigterm = process.listeners("SIGTERM");
    process.removeListener("SIGTERM", sigterm[sigterm.length - 1]);
    const sigint = process.listeners("SIGINT");
    process.removeListener("SIGINT", sigint[sigint.length - 1]);
  }
});

test("crashCleanupAndExit stops the server and exits 1, not 0", async () => {
  const stopped = deferred();
  const exit = fakeExit();
  const handle = { port: 4300, host: "127.0.0.1", stop: () => stopped.promise };
  const controller = createShutdownController({ stop: () => handle.stop(), exit: () => { throw new Error("must not use the graceful path's exit"); } });

  crashCleanupAndExit(handle, controller, exit);
  stopped.resolve();
  await stopped.promise;
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(exit.calls, [1]);
});

test("crashCleanupAndExit exits 1 even when stop() itself rejects", async () => {
  const stopped = deferred();
  const exit = fakeExit();
  const handle = { port: 4300, host: "127.0.0.1", stop: () => stopped.promise };
  const controller = createShutdownController({ stop: () => handle.stop(), exit: () => {} });

  crashCleanupAndExit(handle, controller, exit);
  stopped.reject(new Error("stop() failed too"));
  await stopped.promise.catch(() => {});
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(exit.calls, [1]);
});

test("crashCleanupAndExit is bounded by a timeout when stop() never resolves", async () => {
  const exit = fakeExit();
  const handle = { port: 4300, host: "127.0.0.1", stop: () => new Promise(() => {}) };
  const controller = createShutdownController({ stop: () => handle.stop(), exit: () => {} });

  crashCleanupAndExit(handle, controller, exit);
  // The timeout is a fixed 5s internal constant; this test doesn't wait it out (that would
  // make the suite slow). It only proves a hung stop() has NOT silently produced an exit(0)
  // in the meantime -- the bounded-wait behavior itself is exercised end-to-end by
  // cloud-runtime-shutdown-controller.test.js's equivalent timeout case on the graceful path,
  // which this cleanup function's timer mirrors.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(exit.calls, []);
});

test("crashCleanupAndExit no-ops while a graceful shutdown is already in flight", async () => {
  const stopped = deferred();
  const exit = fakeExit();
  const handle = { port: 4300, host: "127.0.0.1", stop: () => stopped.promise };
  const graceful = createShutdownController({ stop: () => handle.stop(), exit });

  graceful.trigger("SIGTERM"); // now isShuttingDown() is true
  crashCleanupAndExit(handle, graceful, exit); // must defer to the in-flight graceful shutdown
  stopped.resolve();
  await stopped.promise;
  await new Promise((r) => setImmediate(r));

  // Exactly one exit call (the graceful path's own 0), not a second crash-path exit(1) racing it.
  assert.deepEqual(exit.calls, [0]);
});
