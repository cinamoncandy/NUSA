const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { RecoveryLedger, buildRecoveryHealthReport, retryWithTimeout } = require("../dist/apps/desktop/src/recovery/recovery.js");
const { PaperSessionStore } = require("../dist/apps/desktop/src/paper/paperSessionStore.js");
const { ControlSessionStore } = require("../dist/apps/desktop/src/control/controlSessionStore.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { ControlPlane } = require("../dist/apps/desktop/src/control/controlPlane.js");
const { UpbitWebSocketClient } = require("../dist/apps/desktop/src/exchange/upbitWebSocket.js");

test("recovery ledger is immutable, idempotent, and bounded", () => {
  const ledger = new RecoveryLedger(2);
  const event = { id: "one", timestamp: 1, component: "STORAGE", status: "WARNING", message: "primary invalid" };
  assert.equal(ledger.record(event), ledger.record(event));
  ledger.record({ ...event, id: "two", timestamp: 2 });
  ledger.record({ ...event, id: "three", timestamp: 3 });
  const records = ledger.list();
  assert.deepEqual(records.map((record) => record.id), ["two", "three"]);
  assert.ok(Object.isFrozen(records));
  assert.ok(Object.isFrozen(records[0]));
});

test("health monitor marks missing storage critical and delayed market data warning", () => {
  const report = buildRecoveryHealthReport({ now: 10_000, ipcHealthy: true, websocketConnected: true, rendererHealthy: true, storageHealthy: false, lastMarketDataAt: 1_000, maximumMarketDataAgeMs: 1_000, heapUsedBytes: 10, maximumHeapUsedBytes: 100 });
  assert.equal(report.status, "CRITICAL");
  assert.match(report.reasons.join(" "), /Storage recovery/);
  assert.match(report.reasons.join(" "), /Market data is delayed/);
  assert.ok(Object.isFrozen(report));
});

test("IPC recovery makes at most three attempts and preserves the last failure", async () => {
  let attempts = 0;
  await assert.rejects(() => retryWithTimeout(async () => { attempts += 1; throw new Error("unavailable"); }, { timeoutMs: 10, maximumAttempts: 3 }), /unavailable/);
  assert.equal(attempts, 3);
});

test("IPC recovery times out without retrying forever", async () => {
  let attempts = 0;
  await assert.rejects(() => retryWithTimeout(() => { attempts += 1; return new Promise(() => undefined); }, { timeoutMs: 5, maximumAttempts: 3 }), /timed out/);
  assert.equal(attempts, 3);
});

test("paper and control sessions restore a valid backup while returning a fail-closed diagnostic", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-recovery-"));
  try {
    const paperPath = join(directory, "paper.json");
    const controlPath = join(directory, "control.json");
    const paper = new PaperSessionStore(paperPath);
    const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
    paper.save(broker.exportState());
    broker.execute("BUY", 0.01, 50_000_000);
    paper.save(broker.exportState());
    writeFileSync(paperPath, "{", "utf8");
    const paperRecovered = paper.loadSafe();
    assert.equal(paperRecovered.restoredFromBackup, true);
    assert.equal(paperRecovered.state.orders.length, 0);
    assert.match(paperRecovered.diagnostic, /automatic trading remains disabled/);

    const control = new ControlSessionStore(controlPath);
    const stopped = new ControlPlane("sma-crossover");
    control.save(stopped.exportState());
    stopped.start();
    control.save(stopped.exportState());
    writeFileSync(controlPath, "{", "utf8");
    const controlRecovered = control.loadSafe();
    assert.equal(controlRecovered.restoredFromBackup, true);
    assert.equal(controlRecovered.state.status, "STOPPED");
    assert.match(controlRecovered.diagnostic, /automatic trading remains disabled/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("WebSocket recovery has a finite reconnect limit", () => {
  assert.throws(() => new UpbitWebSocketClient("KRW-BTC", () => undefined, () => undefined, 0), /positive safe integer/);
  // apps/desktop/src/exchange/upbitWebSocket.ts is a re-export shim; the real source lives in
  // packages/core, shared with apps/cloud/src.
  const source = require("node:fs").readFileSync("packages/core/src/upbitWebSocket.ts", "utf8");
  assert.match(source, /reconnect-exhausted/);
  assert.match(source, /maximumReconnectAttempts/);
});

test("main recreates a renderer and surfaces safe IPC recovery text", () => {
  const fs = require("node:fs");
  const main = fs.readFileSync("apps/desktop/src/main.ts", "utf8");
  const renderer = fs.readFileSync("apps/desktop/renderer/renderer.js", "utf8");
  assert.match(main, /render-process-gone/);
  assert.match(main, /createWindow\(\)/);
  assert.match(renderer, /데이터를 가져오지 못했습니다/);
});
