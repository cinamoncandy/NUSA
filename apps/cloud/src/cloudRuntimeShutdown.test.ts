import test from "node:test";
import assert from "node:assert/strict";
import { createShutdownController, handleRuntimeFault } from "./cloudRuntimeShutdown";

test("runtime fault during graceful shutdown does not preempt cleanup", async () => {
  let resolveStop!: () => void;
  const exits: number[] = [];
  const errors: string[] = [];
  const stopPromise = new Promise<void>((resolve) => { resolveStop = resolve; });
  const controller = createShutdownController({
    stop: () => stopPromise,
    exit: (code) => { exits.push(code); },
    timeoutMs: 5_000,
    log: () => undefined,
    errorLog: (line) => { errors.push(line); },
  });

  controller.trigger("SIGTERM");
  assert.equal(controller.isShuttingDown(), true);

  handleRuntimeFault(
    controller,
    "uncaught exception",
    new Error("WebSocket was closed before the connection was established"),
    (code) => { exits.push(code); },
    (line) => { errors.push(line); },
  );

  assert.deepEqual(exits, []);
  assert.match(errors.join(""), /cleanup remains authoritative/);

  resolveStop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [0]);
});

test("runtime fault outside shutdown still exits fail-closed", () => {
  const exits: number[] = [];
  handleRuntimeFault(
    { isShuttingDown: () => false },
    "unhandled rejection",
    new Error("boom"),
    (code) => { exits.push(code); },
    () => undefined,
  );
  assert.deepEqual(exits, [1]);
});
