const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/buySignalModel.ts"), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildBuySignalLine } = shim.exports;
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
const hook = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/useDailyCounts.ts"), "utf8");

test("a server that does not report the counters reads as not reported, never as zero", () => {
  assert.equal(buildBuySignalLine({ buySignals: null, buyBlocked: null, paperOrders: 0 }).value, "BUY 신호 집계 미수신");
  assert.equal(buildBuySignalLine({ buySignals: 3, buyBlocked: null, paperOrders: 0 }).tone, "muted");
  assert.equal(buildBuySignalLine({ buySignals: NaN, buyBlocked: 0, paperOrders: 0 }).value, "BUY 신호 집계 미수신");
  assert.equal(buildBuySignalLine({ buySignals: -1, buyBlocked: 0, paperOrders: 0 }).value, "BUY 신호 집계 미수신");
});

test("no BUY signal today says so and shows the order count", () => {
  assert.equal(buildBuySignalLine({ buySignals: 0, buyBlocked: 0, paperOrders: 0 }).value, "오늘 BUY 신호 없음 · 주문 0건");
  assert.equal(buildBuySignalLine({ buySignals: 0, buyBlocked: 0, paperOrders: null }).value, "오늘 BUY 신호 없음");
});

test("BUY signals that all became orders are fine; blocked ones are flagged", () => {
  const ok = buildBuySignalLine({ buySignals: 4, buyBlocked: 0, paperOrders: 4 });
  assert.equal(ok.value, "BUY 신호 4회 · 주문 4건");
  assert.equal(ok.tone, "ok");
  const warn = buildBuySignalLine({ buySignals: 9, buyBlocked: 6, paperOrders: 3 });
  assert.equal(warn.value, "BUY 신호 9회 · 주문 안 나간 6회 · 주문 3건");
  assert.equal(warn.tone, "warn");
});

test("blocked can never exceed signals in the display", () => {
  assert.match(buildBuySignalLine({ buySignals: 2, buyBlocked: 5, paperOrders: 0 }).value, /BUY 신호 2회 · 주문 안 나간 2회/);
});

test("HOME shows the BUY signal row from daily (09:00 KST) counts with its own baseline", () => {
  assert.match(view, /home-buy-signal-line/);
  assert.match(view, /useDailyCounts\([^)]*BUY_SIGNAL_KEY\)/);
  assert.match(hook, /BUY_SIGNAL_KEY = "nusa\.home\.dailyBuyBaseline\.v1"/);
  assert.match(hook, /storageKey: string = KEY/);
});

test("the runtime counts BUY decisions and BUY decisions that placed no order, display only", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /buySignalCount: 0,\s*\n\s*buyBlockedCount: 0,/);
  const at = runtime.indexOf('canonicalDecision?.action === "BUY"');
  assert.ok(at > 0, "counted from the canonical decision");
  const around = runtime.slice(at - 200, at + 260);
  assert.match(around, /buySignalCount \+= 1/);
  assert.match(around, /result\.orders\.length === 0\) heartbeat\.buyBlockedCount \+= 1/);
  assert.ok(runtime.lastIndexOf("if (result != null) {", at) > runtime.lastIndexOf("heartbeat.decisionCount +=", at), "counted only after the PAPER boundary produced a result");
});

test("the operations contract accepts the optional counters and rejects bad values", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500);
  assert.equal(attempt({}).operations.heartbeat.buySignalCount, undefined, "older runtimes omit the counters");
  assert.equal(attempt({ buySignalCount: 5, buyBlockedCount: 2 }).operations.heartbeat.buySignalCount, 5);
  assert.throws(() => attempt({ buySignalCount: -1, buyBlockedCount: 0 }), /buySignalCount/);
  assert.throws(() => attempt({ buySignalCount: 1, buyBlockedCount: 1.5 }), /buyBlockedCount/);
});
