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
const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
// 09:00 KST == 00:00 UTC of 2026-10-03
const SINCE = Date.UTC(2026, 9, 3, 0, 0, 0);

test("a server that does not report the counters reads as not reported, never as zero", () => {
  assert.equal(buildBuySignalLine({ buySignals: undefined, buyBlocked: undefined, since: SINCE }).value, "집계 미수신");
  assert.equal(buildBuySignalLine({ buySignals: null, buyBlocked: null, since: SINCE }).tone, "muted");
  assert.equal(buildBuySignalLine({ buySignals: 3, buyBlocked: undefined, since: SINCE }).value, "집계 미수신");
  assert.equal(buildBuySignalLine({ buySignals: NaN, buyBlocked: 0, since: SINCE }).value, "집계 미수신");
  assert.equal(buildBuySignalLine({ buySignals: -1, buyBlocked: 0, since: SINCE }).value, "집계 미수신");
});

test("no BUY signal says so and states the 09:00 KST start", () => {
  assert.equal(buildBuySignalLine({ buySignals: 0, buyBlocked: 0, since: SINCE }).value, "없음 (09:00 이후)");
  assert.equal(buildBuySignalLine({ buySignals: 0, buyBlocked: 0, since: undefined }).value, "없음");
});

test("a runtime that started mid-window states its own start time in KST", () => {
  const since = Date.UTC(2026, 9, 3, 6, 30, 0); // 15:30 KST
  assert.equal(buildBuySignalLine({ buySignals: 2, buyBlocked: 0, since }).value, "2회 (15:30 이후)");
});

test("refused BUY decisions are flagged; the row never shows a global order total", () => {
  const warn = buildBuySignalLine({ buySignals: 9, buyBlocked: 6, since: SINCE });
  assert.equal(warn.value, "9회 · 막힘 6회 (09:00 이후)");
  assert.equal(warn.tone, "warn");
  assert.doesNotMatch(warn.value, /주문/);
  assert.equal(buildBuySignalLine({ buySignals: 4, buyBlocked: 0, since: SINCE }).tone, "ok");
});

test("blocked can never exceed signals in the display", () => {
  assert.match(buildBuySignalLine({ buySignals: 2, buyBlocked: 5, since: SINCE }).value, /^2회 · 막힘 2회/);
});

test("HOME reads the server window counts directly (no client baseline) and hides them when disconnected", () => {
  assert.match(view, /home-buy-signal-line/);
  assert.match(view, /buyHeartbeat = fieldInput\.disconnected \|\| readOnlyError != null \? null/);
  assert.doesNotMatch(view, /BUY_SIGNAL_KEY/);
});

test("the runtime counts BUY decisions in a 09:00 KST window and only refusals as blocked", () => {
  assert.match(runtime, /BUY_WINDOW_MS = 86_400_000/);
  assert.match(runtime, /Math\.floor\(nowMs \/ BUY_WINDOW_MS\)/);
  const at = runtime.indexOf('canonicalDecision?.action === "BUY"');
  assert.ok(at > 0);
  const around = runtime.slice(at, at + 330);
  assert.match(around, /buyWindow\.signals \+= 1/);
  assert.match(around, /result\.status === "BLOCKED" \|\| result\.status === "REJECTED"\) buyWindow\.blocked \+= 1/);
  assert.doesNotMatch(around, /orders\.length/, "refusal is the boundary status, not the terminal order array");
  assert.ok(runtime.lastIndexOf("if (result != null) {", at) > runtime.lastIndexOf("heartbeat.decisionCount +=", at), "counted only after the PAPER boundary produced a result");
});

test("the runtime reports the counters only when the canonical PAPER boundary is active", () => {
  const start = runtime.indexOf("const readHeartbeat = ");
  const end = runtime.indexOf("};", start);
  const body = runtime.slice(start, end);
  assert.match(body, /if \(productionPaperBoundary == null\) return Object\.freeze\(\{ \.\.\.heartbeat \}\)/);
  assert.match(body, /buySignalCount: buyWindow\.signals/);
  assert.match(body, /buyCountsSince: Math\.max\(runtimeStartedAt, buyWindow\.key \* BUY_WINDOW_MS\)/);
});

test("the operations contract accepts the optional fields and drops bad values", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500);
  assert.equal(attempt({}).operations.heartbeat.buySignalCount, undefined, "older runtimes omit the counters");
  assert.equal(attempt({ buySignalCount: 5, buyBlockedCount: 2, buyCountsSince: 900 }).operations.heartbeat.buySignalCount, 5);
  // Malformed display-only counters are omitted instead of rejecting the snapshot.
  assert.equal(attempt({ buySignalCount: -1, buyBlockedCount: 0 }).operations.heartbeat.buySignalCount, undefined);
  assert.equal(attempt({ buySignalCount: 1, buyBlockedCount: 1.5 }).operations.heartbeat.buyBlockedCount, undefined);
  assert.equal(attempt({ buySignalCount: 1, buyBlockedCount: 0, buyCountsSince: -5 }).operations.heartbeat.buyCountsSince, undefined);
});
