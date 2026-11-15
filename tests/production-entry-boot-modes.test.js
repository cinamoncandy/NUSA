"use strict";
// SCOPE: this boots the daemon module that scripts/start-cloud-runtime.js runs, directly; it does not go through that launcher's
// supervisor and environment hand-over, and market data is off, so zero orders here is weak evidence on its own. The lease,
// ledger rows and runMode are the proof; timers are covered by closed-learning-daemon-order-path-off.test.js and a real
// order by cloud-runtime-order-path-switch-e2e.test.js.
// Boots the REAL production daemon entry (dist/apps/cloud/src/closedLearningProductionRuntime.js, the module that
// scripts/start-cloud-runtime.js runs) in a child process per mode. Nothing is stubbed: real runtime composition,
// real SQLite file, real loopback HTTP. It asserts what exists and what does not, so a mode can no longer pass a test
// that only covered an inner layer (the 2026-11-15 failure) and the default can no longer be "orders on" unnoticed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const root = resolve(__dirname, "..");
const freePort = () => new Promise((ok, fail) => { const s = createServer(); s.once("error", fail); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

const CHILD = `
const { join } = require("node:path");
const root = process.argv[1], port = process.argv[2];
const { startClosedLearningProductionRuntime } = require(join(root, "dist/apps/cloud/src/closedLearningProductionRuntime.js"));
const { SqliteDatabase } = require(join(root, "dist/packages/storage/src/index.js"));
(async () => {
  const c = startClosedLearningProductionRuntime(process.env, () => { console.log("SCHEDULER_FATAL"); });
  let body;
  for (let i = 0; i < 300 && !body; i += 1) {
    try { const r = await fetch("http://127.0.0.1:" + port + "/health"); if (r.ok) body = await r.json(); } catch { /* not listening yet */ }
    if (!body) await new Promise((r) => setTimeout(r, 100));
  }
  const db = new SqliteDatabase(process.env.NUSA_CLOUD_STATE_DB_PATH);
  const count = (sql) => { try { return db.connection.prepare(sql).get().n; } catch { return -1; } };
  const out = { runMode: body && body.runtime && body.runtime.runMode, leaseRows: count("SELECT COUNT(*) AS n FROM cloud_paper_writer_leases"), fills: count("SELECT COUNT(*) AS n FROM cloud_paper_fill_ledger"), orders: body && body.runtime && body.runtime.paperOrderCount };
  db.close();
  await c.handle.stop();
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
})().catch((e) => { console.log("START_FAILED " + (e && e.message)); process.exit(2); });
`;

async function boot(orderPath) {
  const dir = mkdtempSync(join(tmpdir(), "nusa-entry-boot-"));
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    NUSA_CLOUD_RESEARCH_EXPERIMENTS: "0", NUSA_SOURCE_COMMIT: "b".repeat(40), NUSA_RESEARCH_BACKFILL: "DISABLED",
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1", NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_TOKEN: "synthetic-test-only-not-a-credential".repeat(2),
    NUSA_CLOUD_STATE_DB_PATH: join(dir, "state.sqlite"), NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "100000",
    NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC", NUSA_CLOUD_UPBIT_PUBLIC_DATA: "0", NUSA_MODE: "PAPER", NUSA_LIVE_MUTATION: "0",
  };
  if (orderPath !== undefined) env.NUSA_PAPER_ORDER_PATH = orderPath;
  try {
    const result = spawnSync(process.execPath, ["-e", CHILD, root, String(port)], { env, cwd: root, encoding: "utf8", timeout: 60_000 });
    const line = (result.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
    assert.ok(line, `the real entry must start and answer /health (exit ${result.status}): ${(result.stdout || "").slice(-300)} ${(result.stderr || "").slice(-300)}`);
    return JSON.parse(line.slice(7));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [label, value] of [["unset", undefined], ["OFF", "OFF"], ["garbled", "ONN"], ["empty", ""]]) {
  test(`production entry, order path ${label}: collect-only, no writer lease, no ledger rows, /health says COLLECT_ONLY`, async () => {
    const r = await boot(value);
    assert.equal(r.runMode, "COLLECT_ONLY");
    assert.equal(r.leaseRows, 0, "no writer lease row");
    assert.equal(r.fills, 0, "no fills");
    assert.equal(r.orders, 0, "no orders");
  });
}

test("production entry, order path ON (control): the writer lease exists and /health says PAPER_ORDERS", async () => {
  const r = await boot("ON");
  assert.equal(r.runMode, "PAPER_ORDERS");
  assert.ok(r.leaseRows >= 1, "the lease row exists");
});
