// End-to-end test of the actual bootstrap entry point (apps/cloud/src/runtime.ts): spawns the
// real compiled process, not an in-process stub, so this exercises exactly what
// `pnpm run cloud:runtime` (and eventually a process supervisor) would run.
//
// Platform note: on Windows, `child.kill("SIGTERM")` does not deliver a POSIX signal to the
// child's `process.on("SIGTERM", ...)` handler -- Node's own docs say Windows has no real signal
// delivery, and kill() there terminates the process directly. That means the *graceful* half of
// shutdown (the handler runs, stop() completes, the process calls process.exit(0) on its own) is
// not something an OS-level kill() can exercise on win32 -- asserting it there would mean either
// forcing behavior Windows doesn't have, or faking a pass. So the strict graceful-shutdown
// assertions (signal === null, code === 0) are POSIX-only below. The shutdown state machine
// itself is still fully covered on every platform, without any OS signal, in
// tests/cloud-runtime-shutdown-controller.test.js. What *does* run on Windows here is the rest of
// the real process lifecycle: startup, /health, auth, and confirmation that an explicit kill
// actually terminates the process and releases its port.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const RUNTIME_ENTRY = path.join(__dirname, "..", "dist", "apps", "cloud", "src", "runtime.js");
const STARTUP_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const isWindows = process.platform === "win32";
const posixOnly = isWindows
  ? "Windows does not deliver SIGTERM/SIGINT to a child process's signal handler (child.kill() terminates it directly instead), so a graceful signal-triggered shutdown cannot be exercised via a real OS signal here. See cloud-runtime-shutdown-controller.test.js for platform-independent coverage of the same shutdown logic."
  : false;

let runtimeStateSequence = 0;

function get(port, path_, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: path_, method: "GET", headers: { ...headers, connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function waitForListening(child, port, deadlineMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      get(port, "/health").then(() => resolve()).catch(() => {
        if (Date.now() - start > deadlineMs) { reject(new Error("runtime did not start listening in time")); return; }
        setTimeout(tryOnce, 50);
      });
    };
    child.once("exit", (code) => reject(new Error(`runtime exited early with code ${code} before it started listening`)));
    tryOnce();
  });
}

function spawnRuntime(env) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-cloud-bootstrap-"));
  return spawn(process.execPath, [RUNTIME_ENTRY], {
    env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: path.join(stateDir, `state-${runtimeStateSequence++}.sqlite`), ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function waitForExit(child, deadlineMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("process did not exit in time")), deadlineMs);
    const finish = (code, signal) => { clearTimeout(timer); resolve({ code, signal }); };
    child.once("exit", finish);
    // On Windows, child.kill() may terminate the process before the caller
    // subscribes to the exit event. Observe the terminal state as well so the
    // helper cannot wait forever for an event that already fired.
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off("exit", finish);
      finish(child.exitCode, child.signalCode);
    }
  });
}

test("the real bootstrap process fails closed and exits non-zero when required env vars are missing", async () => {
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: "", NUSA_CLOUD_DASHBOARD_TOKEN: "" });
  const { code } = await waitForExit(child, STARTUP_TIMEOUT_MS);
  assert.notEqual(code, 0);
});

// Runs on every platform, including Windows: startup, /health (unauthenticated), auth
// enforcement, and confirmation that an explicit termination request actually stops the process
// within a bounded time. It does not assert *how* the process stops (signal vs. exit code) --
// that split is POSIX-only below, because it is a real platform difference, not a gap in this
// test.
test("the real bootstrap process starts, serves /health without auth, and enforces the configured token", async () => {
  const port = 41831;
  const authToken = "runtime-bootstrap-test-token-32bytes-min";
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  try {
    await waitForListening(child, port, STARTUP_TIMEOUT_MS);

    const health = await get(port, "/health");
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const unauthenticated = await get(port, "/api/dashboard");
    assert.equal(unauthenticated.status, 401);

    const wrongToken = await get(port, "/api/dashboard", { authorization: "Bearer not-the-token" });
    assert.equal(wrongToken.status, 401);

    // The token is accepted and startup hydrates an explicit safe PAPER dashboard state.
    const rightToken = await get(port, "/api/dashboard", { authorization: `Bearer ${authToken}` });
    assert.equal(rightToken.status, 200);
    const dashboard = JSON.parse(rightToken.body);
    assert.equal(dashboard.mode, "PAPER");
    assert.equal(dashboard.killSwitchActive, true);
    assert.equal(dashboard.tradingAllowed, false);
  } finally {
    child.kill("SIGTERM");
  }
  // Explicit termination path: whatever kill() means on this platform, the process must actually
  // exit within the deadline -- it must not hang.
  await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
});

test("SIGTERM triggers a clean, graceful shutdown (process.exit(0), not signal-killed)", { skip: posixOnly }, async () => {
  const port = 41834;
  const authToken = "runtime-bootstrap-sigterm-graceful-token";
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  await waitForListening(child, port, STARTUP_TIMEOUT_MS);
  child.kill("SIGTERM");
  const { code, signal } = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
  assert.equal(signal, null, "the process must exit on its own via process.exit(), not be killed by a signal");
  assert.equal(code, 0);
});

test("SIGINT also triggers a clean shutdown", { skip: posixOnly }, async () => {
  const port = 41832;
  const authToken = "runtime-bootstrap-sigint-token-32bytes-min";
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  await waitForListening(child, port, STARTUP_TIMEOUT_MS);
  child.kill("SIGINT");
  const { code, signal } = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
  assert.equal(signal, null);
  assert.equal(code, 0);
});

test("after an explicit shutdown, the port is actually released (not left bound by a lingering handle)", async () => {
  const port = 41833;
  const authToken = "runtime-bootstrap-release-token-32bytes-min";
  const first = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  await waitForListening(first, port, STARTUP_TIMEOUT_MS);
  first.kill("SIGTERM");
  await waitForExit(first, SHUTDOWN_TIMEOUT_MS);

  const second = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  try {
    await waitForListening(second, port, STARTUP_TIMEOUT_MS);
    const health = await get(port, "/health");
    assert.equal(health.status, 200);
  } finally {
    second.kill("SIGTERM");
    await waitForExit(second, SHUTDOWN_TIMEOUT_MS);
  }
});

test("a second runtime on an occupied dashboard port fails closed instead of running without its control surface", async () => {
  const port = 41835;
  const authToken = "runtime-bootstrap-port-conflict-token";
  const first = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  await waitForListening(first, port, STARTUP_TIMEOUT_MS);
  const second = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: authToken });
  try {
    const { code } = await waitForExit(second, STARTUP_TIMEOUT_MS);
    assert.notEqual(code, 0, "bind failure must terminate the duplicate runtime");
    const health = await get(port, "/health");
    assert.equal(health.status, 200, "the original runtime must remain the process serving the occupied port");
  } finally {
    if (second.exitCode === null && second.signalCode === null) second.kill("SIGTERM");
    first.kill("SIGTERM");
    await waitForExit(first, SHUTDOWN_TIMEOUT_MS);
  }
});
