"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertPaperOnly,
  readState,
  runtimeSpawnArgs,
  start,
  supervisorEnv,
  writeState,
} = require("../scripts/start-cloud-paper-supervisor.js");

function safeEnv(overrides = {}) {
  return {
    NUSA_MODE: "PAPER",
    NUSA_LIVE_MUTATION: "PROHIBITED",
    NUSA_CLOUD_DASHBOARD_TOKEN: "x".repeat(64),
    NUSA_CLOUD_STATE_DB_PATH: "/var/lib/nusa/state.sqlite",
    ...overrides,
  };
}

test("supervisor refuses non-PAPER or LIVE mutation authority", () => {
  assert.doesNotThrow(() => assertPaperOnly(safeEnv()));
  assert.throws(() => assertPaperOnly(safeEnv({ NUSA_MODE: "LIVE" })), /REQUIRES_PAPER_MODE/);
  assert.throws(() => assertPaperOnly(safeEnv({ NUSA_LIVE_MUTATION: "ALLOWED" })), /REQUIRES_LIVE_MUTATION_PROHIBITED/);
});

test("supervisor requires durable state and production token", () => {
  assert.throws(() => assertPaperOnly(safeEnv({ NUSA_CLOUD_STATE_DB_PATH: ":memory:" })), /durable storage/);
  assert.throws(() => assertPaperOnly(safeEnv({ NUSA_CLOUD_DASHBOARD_TOKEN: "short" })), /must be configured/);
});

test("supervisor strips private exchange credentials and emits canonical projection env", () => {
  const composed = supervisorEnv(
    safeEnv({ UPBIT_ACCESS_KEY: "must-not-pass", UPBIT_SECRET_KEY: "must-not-pass" }),
    { restartCount: 3, lastExit: { code: 1, signal: null, exitedAt: 2000, uptimeMs: 1500 } },
    1000,
    4,
  );
  assert.equal(composed.env.UPBIT_ACCESS_KEY, undefined);
  assert.equal(composed.env.UPBIT_SECRET_KEY, undefined);
  assert.deepEqual(composed.stripped, ["UPBIT_ACCESS_KEY", "UPBIT_SECRET_KEY"]);
  assert.equal(composed.env.NUSA_PAPER_SUPERVISOR_MANAGED, "true");
  assert.equal(composed.env.NUSA_PAPER_SUPERVISOR_RESTART_COUNT, "3");
  assert.equal(composed.env.NUSA_PAPER_SUPERVISOR_RESTART_ATTEMPT, "4");
  assert.equal(composed.env.NUSA_PAPER_SUPERVISOR_LAST_EXIT_CODE, "1");
});

test("supervisor strips NODE_OPTIONS and passes the trusted SQLite preload to its runtime child", () => {
  const composed = supervisorEnv(safeEnv({ NODE_OPTIONS: "--require=/tmp/untrusted.js" }), { restartCount: 0, lastExit: null }, 1000, 0);
  assert.equal(composed.env.NODE_OPTIONS, undefined);
  assert.deepEqual(runtimeSpawnArgs("/opt/nusa/dist/apps/cloud/src/closedLearningProductionRuntime.js", "/opt/nusa/dist/packages/storage/src/sqliteIntegrityBootstrap.js"), [
    "--require",
    "/opt/nusa/dist/packages/storage/src/sqliteIntegrityBootstrap.js",
    "/opt/nusa/dist/apps/cloud/src/closedLearningProductionRuntime.js",
  ]);
});

test("legacy Cloud PAPER systemd entrypoint scrubs environment preloads and loads the trusted boundary first", () => {
  const unit = fs.readFileSync(path.join(__dirname, "../deploy/cloud-paper/nusa-cloud-paper.service"), "utf8");
  assert.match(unit, /^ExecStart=\/usr\/bin\/env -u NODE_OPTIONS \/usr\/bin\/node --require \/opt\/nusa\/dist\/packages\/storage\/src\/sqliteIntegrityBootstrap\.js \/opt\/nusa\/scripts\/start-cloud-paper-supervisor\.js$/m);
});

test("supervisor launches the database owner with trusted preload and without inherited NODE_OPTIONS", () => {
  const beforeTerm = new Set(process.listeners("SIGTERM"));
  const beforeInt = new Set(process.listeners("SIGINT"));
  const child = new EventEmitter();
  child.exitCode = null;
  child.kill = (signal) => { child.killedWith = signal; };
  let captured;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-supervisor-preload-"));
  try {
    const running = start({
      env: safeEnv({ NODE_OPTIONS: "--require=/tmp/untrusted.js", NUSA_PAPER_SUPERVISOR_STATE_PATH: path.join(dir, "supervisor.json") }),
      cwd: "/opt/nusa",
      runtimePath: "/opt/nusa/dist/apps/cloud/src/closedLearningProductionRuntime.js",
      bootstrapPath: "/opt/nusa/dist/packages/storage/src/sqliteIntegrityBootstrap.js",
      spawn: (command, args, options) => { captured = { command, args, options }; return child; },
      now: () => 1000,
      setTimeout: () => undefined,
    });
    assert.deepEqual(captured.args, ["--require", "/opt/nusa/dist/packages/storage/src/sqliteIntegrityBootstrap.js", "/opt/nusa/dist/apps/cloud/src/closedLearningProductionRuntime.js"]);
    assert.equal(captured.options.env.NODE_OPTIONS, undefined);
    running.stop("SIGTERM");
    assert.equal(child.killedWith, "SIGTERM");
  } finally {
    for (const listener of process.listeners("SIGTERM")) if (!beforeTerm.has(listener)) process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT")) if (!beforeInt.has(listener)) process.removeListener("SIGINT", listener);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("supervisor restart state is persisted atomically and recovered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-supervisor-"));
  const statePath = path.join(dir, "supervisor.json");
  try {
    writeState(statePath, { restartCount: 7, lastExit: { code: 2, signal: null, exitedAt: 5000, uptimeMs: 4000 } });
    assert.deepEqual(readState(statePath), {
      restartCount: 7,
      lastExit: { code: 2, signal: null, exitedAt: 5000, uptimeMs: 4000 },
    });
    // Windows does not preserve POSIX permission bits; production is Linux and
    // the mode assertion remains pinned there without making Windows CI lie.
    if (process.platform !== "win32") assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
