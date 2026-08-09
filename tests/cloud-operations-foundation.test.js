const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { createSharedSecretTokenVerifier } = require("../dist/apps/cloud/src/cloudRuntimeConfig.js");
const { operationalLog } = require("../dist/apps/cloud/src/structuredOperationalLog.js");

const token = "x".repeat(32);
const request = (port, pathname, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, body }));
  });
  req.on("error", reject);
  req.end();
});

const run = (script, env = {}) => spawnSync(process.execPath, [script], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, ...env },
  encoding: "utf8"
});

const unavailableChecks = {
  database: false,
  migrations: false,
  dashboardPersistence: false,
  runtimeRecovery: false
};
const healthyChecks = {
  database: true,
  migrations: true,
  dashboardPersistence: true,
  runtimeRecovery: true
};

test("health is unauthenticated while ready is authenticated and fail-closed", async () => {
  const handle = startCloudDashboardServer({
    port: 41991,
    tokenVerifier: createSharedSecretTokenVerifier(token),
    loadDashboard: () => { throw new Error("not ready"); }
  });
  try {
    assert.equal((await request(handle.port, "/health")).status, 200);
    assert.equal((await request(handle.port, "/ready")).status, 401);
    const ready = await request(handle.port, "/ready", { authorization: `Bearer ${token}` });
    assert.equal(ready.status, 503);
    assert.deepEqual(JSON.parse(ready.body).checks, unavailableChecks);
  } finally {
    await handle.stop();
  }
});

test("dashboard availability alone cannot claim database migration persistence or recovery readiness", async () => {
  const handle = startCloudDashboardServer({
    port: 41992,
    tokenVerifier: createSharedSecretTokenVerifier(token),
    loadDashboard: () => ({ ok: true })
  });
  try {
    const ready = await request(handle.port, "/ready", { authorization: `Bearer ${token}` });
    assert.equal(ready.status, 503);
    assert.deepEqual(JSON.parse(ready.body), { ok: false, checks: unavailableChecks });
  } finally {
    await handle.stop();
  }
});

test("authenticated ready succeeds only with explicit verified runtime readiness evidence", async () => {
  const handle = startCloudDashboardServer({
    port: 41993,
    tokenVerifier: createSharedSecretTokenVerifier(token),
    loadDashboard: () => ({ ok: true }),
    readiness: () => ({ ok: true, checks: healthyChecks })
  });
  try {
    const ready = await request(handle.port, "/ready", { authorization: `Bearer ${token}` });
    assert.equal(ready.status, 200);
    assert.deepEqual(JSON.parse(ready.body), { ok: true, checks: healthyChecks });
  } finally {
    await handle.stop();
  }
});

test("an explicit unhealthy readiness projection cannot be overridden by dashboard availability", async () => {
  const handle = startCloudDashboardServer({
    port: 41994,
    tokenVerifier: createSharedSecretTokenVerifier(token),
    loadDashboard: () => ({ ok: true }),
    readiness: () => ({ ok: false, checks: { database: true, migrations: true, dashboardPersistence: false, runtimeRecovery: true } })
  });
  try {
    const ready = await request(handle.port, "/ready", { authorization: `Bearer ${token}` });
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.body).checks.dashboardPersistence, false);
  } finally {
    await handle.stop();
  }
});

test("cloud server rejects non-localhost bind attempts", () => {
  assert.throws(() => startCloudDashboardServer({
    port: 41995,
    host: "0.0.0.0",
    tokenVerifier: createSharedSecretTokenVerifier(token),
    loadDashboard: () => ({ ok: true })
  }), /must bind to localhost/);
});

test("cloud server exposes dashboard only on the explicit route and rejects authenticated unknown paths", async () => {
  const handle = startCloudDashboardServer({
    port: 41996,
    tokenVerifier: createSharedSecretTokenVerifier(token),
    loadDashboard: () => ({ ok: true })
  });
  try {
    const headers = { authorization: `Bearer ${token}` };
    const dashboard = await request(handle.port, "/api/dashboard", headers);
    assert.equal(dashboard.status, 200);
    assert.deepEqual(JSON.parse(dashboard.body), { ok: true });
    const unknown = await request(handle.port, "/unexpected", headers);
    assert.equal(unknown.status, 404);
    assert.deepEqual(JSON.parse(unknown.body), { error: "NOT_FOUND" });
  } finally {
    await handle.stop();
  }
});

test("systemd template remains non-root and least-privilege", () => {
  const unit = fs.readFileSync("deploy/oracle/nusa.service", "utf8");
  for (const required of ["User=nusa", "Group=nusa", "NoNewPrivileges=true", "PrivateTmp=true", "ProtectSystem=strict", "ProtectHome=true", "Restart=on-failure"]) {
    assert.match(unit, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(unit, /User=root|Group=root/);
  assert.match(unit, /ReadWritePaths=\/var\/lib\/nusa \/var\/backups\/nusa/);
});

test("operator scripts expose safe dry-run paths without emitting generated secrets", () => {
  const tokenResult = run("scripts/generate-dashboard-token.js", { NUSA_DRY_RUN: "1", NUSA_ENV_FILE: path.join(os.tmpdir(), "nusa-do-not-write.env") });
  assert.equal(tokenResult.status, 0, tokenResult.stderr);
  const tokenOutput = JSON.parse(tokenResult.stdout);
  assert.equal(tokenOutput.status, "DRY_RUN");
  assert.equal(tokenOutput.tokenBytes, 32);
  assert.equal("token" in tokenOutput, false);

  const backupResult = run("scripts/sqlite-backup.js", { NUSA_DRY_RUN: "1", NUSA_DB: path.join(os.tmpdir(), "missing.db") });
  assert.equal(backupResult.status, 0, backupResult.stderr);
  assert.equal(JSON.parse(backupResult.stdout).status, "DRY_RUN");

  const securityResult = run("scripts/host-security-validate.js");
  assert.equal(securityResult.status, 0, securityResult.stderr);
  assert.equal(JSON.parse(securityResult.stdout).rootExecution, false);
});

test("atomic deployment dry-run is versioned, reversible, and validates canonical release paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-deploy-"));
  const commit = "a".repeat(40);
  fs.mkdirSync(path.join(root, "releases", commit), { recursive: true });
  const result = run("scripts/atomic-deploy.js", { NUSA_DRY_RUN: "1", NUSA_DEPLOY_ROOT: root, NUSA_COMMIT_SHA: commit });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "DRY_RUN");
  assert.equal(output.restartRequired, true);
  assert.equal(output.readinessRequired, true);
  assert.equal(fs.existsSync(path.join(root, "current")), false);
  const deploySource = fs.readFileSync("scripts/atomic-deploy.js", "utf8");
  assert.match(deploySource, /realpathSync\(releases\)/);
  assert.match(deploySource, /lstatSync\(target\)/);
  assert.match(deploySource, /not a symlink/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("structured operational logging redacts secret-shaped fields and values", () => {
  let captured = "";
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { captured += String(chunk); return true; };
  try {
    operationalLog("INFO", "oracle.test", "corr-1", {
      dashboardToken: "super-secret-value",
      nested: { authorization: "Bearer abc", note: "token=should-not-leak" },
      safe: "visible"
    });
  } finally {
    process.stdout.write = original;
  }
  const record = JSON.parse(captured);
  assert.equal(record.details.dashboardToken, "[REDACTED]");
  assert.equal(record.details.nested.authorization, "[REDACTED]");
  assert.match(record.details.nested.note, /\[REDACTED\]/);
  assert.doesNotMatch(captured, /super-secret-value|Bearer abc|should-not-leak/);
  assert.equal(record.details.safe, "visible");
});
