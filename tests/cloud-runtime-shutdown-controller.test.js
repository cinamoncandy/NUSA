// Pure unit tests of the shutdown state machine (apps/cloud/src/cloudRuntimeShutdown.ts), with a
// fake stop()/exit() -- no real process, no real OS signal, no real HTTP listener. This is the
// platform-independent coverage of graceful-shutdown behavior: it runs identically on Linux,
// macOS, and Windows, unlike the real SIGTERM/SIGINT integration test in
// cloud-runtime-bootstrap.test.js, which depends on POSIX signal delivery and is skipped on
// win32 for that reason.
const test = require("node:test");
const assert = require("node:assert/strict");
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

test("a successful stop() calls exit(0) exactly once", async () => {
  const stopped = deferred();
  const exit = fakeExit();
  const controller = createShutdownController({ stop: () => stopped.promise, exit, timeoutMs: 1_000 });

  assert.equal(controller.isShuttingDown(), false);
  controller.trigger("SIGTERM");
  assert.equal(controller.isShuttingDown(), true);

  stopped.resolve();
  await stopped.promise;
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(exit.calls, [0]);
});

test("a rejecting stop() calls exit(1), not exit(0)", async () => {
  const stopped = deferred();
  const exit = fakeExit();
  const controller = createShutdownController({ stop: () => stopped.promise, exit, timeoutMs: 1_000 });

  controller.trigger("SIGTERM");
  stopped.reject(new Error("boom"));
  await stopped.promise.catch(() => {});
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(exit.calls, [1]);
});

test("a stop() that never resolves forces exit(1) after the timeout", async () => {
  const exit = fakeExit();
  const controller = createShutdownController({
    stop: () => new Promise(() => {}), // never settles
    exit,
    timeoutMs: 20
  });

  controller.trigger("SIGTERM");
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(exit.calls, [1]);
});

test("a second trigger while already shutting down is a no-op -- stop() is called once", async () => {
  const stopped = deferred();
  let stopCallCount = 0;
  const exit = fakeExit();
  const controller = createShutdownController({
    stop: () => { stopCallCount += 1; return stopped.promise; },
    exit,
    timeoutMs: 1_000
  });

  controller.trigger("SIGTERM");
  controller.trigger("SIGINT");
  controller.trigger("SIGTERM");
  assert.equal(stopCallCount, 1);

  stopped.resolve();
  await stopped.promise;
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(exit.calls, [0], "exit must be called exactly once even with repeated triggers");
});

test("a successful stop() before the timeout does not also force-exit later", async () => {
  const stopped = deferred();
  const exit = fakeExit();
  const controller = createShutdownController({ stop: () => stopped.promise, exit, timeoutMs: 30 });

  controller.trigger("SIGTERM");
  stopped.resolve();
  await stopped.promise;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(exit.calls, [0]);

  // Wait past the original timeout window -- the cleared timer must not fire a stray exit(1).
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(exit.calls, [0]);
});

test("log lines are emitted for a normal shutdown, error lines for a failed one", async () => {
  const stopped = deferred();
  const logLines = [];
  const errorLines = [];
  const controller = createShutdownController({
    stop: () => stopped.promise,
    exit: fakeExit(),
    timeoutMs: 1_000,
    log: (line) => logLines.push(line),
    errorLog: (line) => errorLines.push(line)
  });

  controller.trigger("SIGTERM");
  assert.ok(logLines.some((l) => l.includes("received SIGTERM")));

  stopped.reject(new Error("disk full"));
  await stopped.promise.catch(() => {});
  await new Promise((r) => setImmediate(r));

  assert.ok(errorLines.some((l) => l.includes("disk full")));
  assert.equal(logLines.some((l) => l.includes("stopped")), false, "a failed stop must not log the success message");
});


test("uncaught runtime faults request fail-closed exit(1)", async () => {
  const { registerGracefulShutdown } = require("../dist/apps/cloud/src/runtime.js");
  const exit = fakeExit();
  const before = new Set([
    ...process.listeners("SIGTERM"),
    ...process.listeners("SIGINT"),
    ...process.listeners("uncaughtException"),
    ...process.listeners("unhandledRejection")
  ]);
  registerGracefulShutdown({ stop: async () => {} }, exit);
  const crashHandler = process.listeners("uncaughtException").find((listener) => !before.has(listener));
  assert.ok(crashHandler);
  crashHandler(new Error("boom"));
  assert.deepEqual(exit.calls, [1]);

  for (const event of ["SIGTERM", "SIGINT", "uncaughtException", "unhandledRejection"]) {
    for (const listener of process.listeners(event)) {
      if (!before.has(listener)) process.removeListener(event, listener);
    }
  }
});
