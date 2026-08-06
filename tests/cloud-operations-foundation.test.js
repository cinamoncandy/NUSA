const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { createSharedSecretTokenVerifier } = require("../dist/apps/cloud/src/cloudRuntimeConfig.js");
const token = "x".repeat(32);
const request = (port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ port, path, headers }, (res) => { let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body })); });
  req.on("error", reject); req.end();
});

test("health is unauthenticated liveness while ready is authenticated and reports 503", async () => {
  const handle = startCloudDashboardServer({ port: 41991, tokenVerifier: createSharedSecretTokenVerifier(token), loadDashboard: () => undefined, readiness: () => ({ ok: false, checks: { database: false, migration: true, dashboardPersistence: false, runtimeRecovery: false } }) });
  try {
    assert.equal((await request(handle.port, "/health")).status, 200);
    assert.equal((await request(handle.port, "/ready")).status, 401);
    const ready = await request(handle.port, "/ready", { authorization: `Bearer ${token}` });
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.body).checks.database, false);
  } finally { await handle.stop(); }
});

test("systemd template remains non-root and localhost-bound", () => {
  const fs = require("node:fs");
  const unit = fs.readFileSync("deploy/oracle/nusa.service", "utf8");
  assert.match(unit, /User=nusa/); assert.match(unit, /Group=nusa/); assert.match(unit, /NoNewPrivileges=true/); assert.match(unit, /Restart=on-failure/); assert.doesNotMatch(unit, /User=root/);
});
