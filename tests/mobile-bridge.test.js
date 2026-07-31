const test = require("node:test");
const assert = require("node:assert/strict");
const { startMobileBridge } = require("../dist/apps/desktop/src/mobileBridge.js");
const fs = require("node:fs");
const path = require("node:path");

test("mobile bridge source is localhost-only and has no mutation or wildcard CORS surface", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "mobileBridge.ts"), "utf8");
  assert.doesNotMatch(source, /0\.0\.0\.0|Access-Control-Allow-Origin|placeOrder|cancelOrder|withdraw/);
  assert.match(source, /127\.0\.0\.1/);
  assert.doesNotMatch(source, /POST|PUT|PATCH|DELETE/);
  const main = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
  assert.match(main, /NUSA_MOBILE_MONITOR_ENABLED !== "true"/);
  assert.match(main, /NUSA_MOBILE_MONITOR_PORT/);
});

test("mobile bridge is localhost read-only and exposes safe DTOs only", async () => {
  const bridge = startMobileBridge({ port: 41731, getStatus: () => ({ app: "NUSA", mode: "PAPER", marketConnectionState: "HEALTHY", warmupState: "READY", stale: false, observedAt: new Date().toISOString() }), getAccount: () => ({ available: true, cash: 100 }), getOpenOrderCount: () => 0, getEvents: () => [{ code: "SAFE" }] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const health = await fetch("http://127.0.0.1:41731/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const account = await fetch("http://127.0.0.1:41731/api/account");
    assert.equal((await account.json()).account.cash, 100);
    const mutation = await fetch("http://127.0.0.1:41731/api/status", { method: "POST" });
    assert.equal(mutation.status, 405);
    const missing = await fetch("http://127.0.0.1:41731/control/start", { method: "POST" });
    assert.equal(missing.status, 405);
  } finally { await bridge.stop(); }
});
