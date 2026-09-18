const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");

const script = path.resolve(__dirname, "..", "scripts", "oracle-readiness-check.js");

test("Oracle readiness dry-run reads the secret from file without printing it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-"));
  const envFile = path.join(root, "cloud-runtime.env");
  const token = "z".repeat(32);
  fs.writeFileSync(envFile, `NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_DASHBOARD_TOKEN=${token}\n`, { mode: 0o640 });
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, NUSA_DRY_RUN: "1", NUSA_ENV_FILE: envFile },
    encoding: "utf8"
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(token));
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "DRY_RUN",
      host: "127.0.0.1",
      port: 41799,
      path: "/ready",
      authenticated: true
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness refuses public binding and weak secrets before network access", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-"));
  const envFile = path.join(root, "cloud-runtime.env");
  try {
    fs.writeFileSync(envFile, "NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=0.0.0.0\nNUSA_CLOUD_DASHBOARD_TOKEN=short\n");
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, NUSA_DRY_RUN: "1", NUSA_ENV_FILE: envFile },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /readiness host must be localhost|dashboard token must be at least 32 bytes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeReadinessEnv(root, port) {
  const envFile = path.join(root, "cloud-runtime.env");
  fs.writeFileSync(envFile, `NUSA_CLOUD_DASHBOARD_PORT=${port}\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_DASHBOARD_TOKEN=${"z".repeat(32)}\n`, { mode: 0o640 });
  return envFile;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runReadiness(envFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, NUSA_ENV_FILE: envFile } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("Oracle readiness proves the mobile owner-auth routes exist in the deployed release", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-routes-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    if (request.url === "/v1/mobile/session/password" || request.url === "/v1/mobile/session/password/change") {
      response.writeHead(405);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.mobileOwnerAuthRoutes, [
      { path: "/v1/mobile/session/password", status: 405 },
      { path: "/v1/mobile/session/password/change", status: 405 },
    ]);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness rejects a stale release that serves health but omits a mobile owner-auth route", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-stale-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    response.writeHead(request.url === "/v1/mobile/session/password" ? 405 : 404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mobile\/session\/password\/change/);
    assert.match(result.stderr, /expectedStatus.*405.*actualStatus.*404/);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
