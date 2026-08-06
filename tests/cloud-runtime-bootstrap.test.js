// End-to-end test of the actual bootstrap entry point (apps/cloud/src/runtime.ts): spawns the
// real compiled process, not an in-process stub, so this exercises exactly what
// `pnpm run cloud:runtime` (and eventually a process supervisor) would run.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

const RUNTIME_ENTRY = path.join(__dirname, "..", "dist", "apps", "cloud", "src", "runtime.js");
const STARTUP_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

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
  return spawn(process.execPath, [RUNTIME_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function waitForExit(child, deadlineMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("process did not exit in time")), deadlineMs);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

test("the real bootstrap process fails closed and exits non-zero when required env vars are missing", async () => {
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: "", NUSA_CLOUD_DASHBOARD_TOKEN: "" });
  const { code } = await waitForExit(child, STARTUP_TIMEOUT_MS);
  assert.notEqual(code, 0);
});

test("the real bootstrap process starts, serves /health without auth, enforces the configured token, and shuts down cleanly on SIGTERM", async () => {
  const port = 41831;
  const token = "runtime-bootstrap-test-token";
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: token });
  try {
    await waitForListening(child, port, STARTUP_TIMEOUT_MS);

    const health = await get(port, "/health");
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const unauthenticated = await get(port, "/");
    assert.equal(unauthenticated.status, 401);

    const wrongToken = await get(port, "/", { authorization: "Bearer not-the-token" });
    assert.equal(wrongToken.status, 401);

    // The token is accepted, but no dashboard data source is wired in yet -- 503, not fake data.
    const rightToken = await get(port, "/", { authorization: `Bearer ${token}` });
    assert.equal(rightToken.status, 503);
    assert.equal(JSON.parse(rightToken.body).error, "DASHBOARD_UNAVAILABLE");
  } finally {
    child.kill("SIGTERM");
  }
  const { code, signal } = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
  assert.equal(signal, null, "the process must exit on its own via process.exit(), not be killed by a signal");
  assert.equal(code, 0);
});

test("SIGINT also triggers a clean shutdown", async () => {
  const port = 41832;
  const token = "runtime-bootstrap-sigint-token";
  const child = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: token });
  await waitForListening(child, port, STARTUP_TIMEOUT_MS);
  child.kill("SIGINT");
  const { code, signal } = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
  assert.equal(signal, null);
  assert.equal(code, 0);
});

test("after SIGTERM shutdown, the port is actually released (not left bound by a lingering handle)", async () => {
  const port = 41833;
  const token = "runtime-bootstrap-release-token";
  const first = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: token });
  await waitForListening(first, port, STARTUP_TIMEOUT_MS);
  first.kill("SIGTERM");
  await waitForExit(first, SHUTDOWN_TIMEOUT_MS);

  const second = spawnRuntime({ NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: token });
  try {
    await waitForListening(second, port, STARTUP_TIMEOUT_MS);
    const health = await get(port, "/health");
    assert.equal(health.status, 200);
  } finally {
    second.kill("SIGTERM");
    await waitForExit(second, SHUTDOWN_TIMEOUT_MS);
  }
});
