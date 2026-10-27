const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const m = require("../dist/apps/cloud/src/healthExport.js");

const TOKEN = "write-only-token-0123456789";
const health = { ok: true, observedAt: "2026-10-27T13:00:00.000Z", capabilities: { passwordSignIn: true }, runtime: { decisionCount: 3, paperFillCount: 0 }, learningPipeline: { learning: "UNKNOWN" }, runtimeHealth: { x: 1 } };

test("export is off unless an https URL without credentials and a plain token are both set", () => {
  assert.equal(m.healthExportConfig({}), null);
  assert.equal(m.healthExportConfig({ NUSA_HEALTH_EXPORT_URL: "https://store.example/append" }), null);
  assert.equal(m.healthExportConfig({ NUSA_HEALTH_EXPORT_URL: "http://store.example/append", NUSA_HEALTH_EXPORT_TOKEN: TOKEN }), null, "plain http is refused");
  assert.equal(m.healthExportConfig({ NUSA_HEALTH_EXPORT_URL: "https://u:p@store.example/append", NUSA_HEALTH_EXPORT_TOKEN: TOKEN }), null, "URL credentials are refused");
  assert.equal(m.healthExportConfig({ NUSA_HEALTH_EXPORT_URL: "https://store.example/append", NUSA_HEALTH_EXPORT_TOKEN: "short" }), null);
  assert.equal(m.healthExportConfig({ NUSA_HEALTH_EXPORT_URL: "not a url", NUSA_HEALTH_EXPORT_TOKEN: TOKEN }), null);
  const config = m.healthExportConfig({ NUSA_HEALTH_EXPORT_URL: "https://store.example/append", NUSA_HEALTH_EXPORT_TOKEN: TOKEN, NUSA_HEALTH_EXPORT_INTERVAL_MS: "1000" });
  assert.equal(config.intervalMs, m.HEALTH_EXPORT_DEFAULT_INTERVAL_MS, "an interval below the minimum falls back to the default");
});

test("the record carries only observedAt, runtime and learningPipeline from the public /health body", () => {
  const record = JSON.parse(m.healthExportRecord(health));
  assert.deepEqual(Object.keys(record).sort(), ["learningPipeline", "observedAt", "runtime", "schemaVersion"]);
  assert.deepEqual(record.runtime, health.runtime);
  assert.equal(m.healthExportRecord({ ...health, ok: false }), null);
  assert.equal(m.healthExportRecord({ ok: true, observedAt: "x" }), null, "no runtime object, nothing to export");
  assert.equal(m.healthExportRecord(null), null);
  assert.equal(m.healthExportRecord({ ...health, runtime: { big: "x".repeat(m.HEALTH_EXPORT_MAX_BYTES) } }), null, "oversized record is not sent");
});

test("one attempt posts the record with a bearer token, refuses redirects, and never rejects", async () => {
  const calls = [];
  const outcome = await m.exportHealthOnce({ url: "https://store.example/append", token: TOKEN, intervalMs: 60000 }, {
    readLocalHealth: async () => health,
    post: async (url, init) => { calls.push({ url, init }); return { ok: true }; },
  });
  assert.equal(outcome, "SENT");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.redirect, "error");
  assert.doesNotMatch(calls[0].init.body, /capabilities|runtimeHealth|passwordSignIn/);
  const config = { url: "https://store.example/append", token: TOKEN, intervalMs: 60000 };
  assert.equal(await m.exportHealthOnce(config, { readLocalHealth: async () => { throw new Error("down"); }, post: async () => ({ ok: true }) }), "FAILED");
  assert.equal(await m.exportHealthOnce(config, { readLocalHealth: async () => health, post: async () => { throw new Error("net"); } }), "FAILED");
  assert.equal(await m.exportHealthOnce(config, { readLocalHealth: async () => health, post: async () => ({ ok: false }) }), "FAILED");
  assert.equal(await m.exportHealthOnce(config, { readLocalHealth: async () => ({ ok: false }), post: async () => { throw new Error("must not post"); } }), "SKIPPED_INVALID_HEALTH");
  assert.equal(await m.exportHealthOnce(config, { readLocalHealth: async () => health, post: async () => ({ ok: true }), onResult: () => { throw new Error("x"); } }), "SENT", "a throwing observer cannot break the runtime");
});

test("the runtime starts the export only from its own config and reads its own /health", () => {
  const runtime = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8");
  assert.match(runtime, /const healthExport = healthExportConfig\(env\);/);
  assert.match(runtime, /healthExport == null \? undefined : startHealthExport\(/);
  assert.match(runtime, /:\$\{handle\.port\}\/health`/);
  assert.match(runtime, /stopHealthExport\?\.\(\); clearInterval\(heartbeatTimer\)/);
});
