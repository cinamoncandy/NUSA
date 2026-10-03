const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/feedDiagnosticsModel.ts"), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildFeedDiagnosticsLine } = shim.exports;
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
const SINCE = Date.UTC(2026, 9, 3, 0, 0, 0); // 09:00 KST

test("a server that does not report the feed counters reads as not reported, never as a clean feed", () => {
  assert.equal(buildFeedDiagnosticsLine({ disconnects: undefined, staleGaps: undefined, maxGapMs: undefined, since: SINCE }).value, "집계 미수신");
  assert.equal(buildFeedDiagnosticsLine({ disconnects: 0, staleGaps: 0, maxGapMs: undefined, since: SINCE }).tone, "muted");
  assert.equal(buildFeedDiagnosticsLine({ disconnects: -1, staleGaps: 0, maxGapMs: 100, since: SINCE }).value, "집계 미수신");
  assert.equal(buildFeedDiagnosticsLine({ disconnects: NaN, staleGaps: 0, maxGapMs: 100, since: SINCE }).value, "집계 미수신");
});

test("a steady feed says so with the longest gap and the window start", () => {
  const line = buildFeedDiagnosticsLine({ disconnects: 0, staleGaps: 0, maxGapMs: 4600, since: SINCE });
  assert.equal(line.value, "끊김 없음 · 최대 공백 4.6초 (09:00 이후)");
  assert.equal(line.tone, "ok");
  assert.equal(buildFeedDiagnosticsLine({ disconnects: 0, staleGaps: 0, maxGapMs: 12_400, since: undefined }).value, "끊김 없음 · 최대 공백 12초");
});

test("drops and long gaps are flagged", () => {
  const line = buildFeedDiagnosticsLine({ disconnects: 3, staleGaps: 5, maxGapMs: 52_700, since: Date.UTC(2026, 9, 3, 2, 45, 0) });
  assert.equal(line.value, "끊김 3회 · 30초+ 공백 5회 · 최대 53초 (11:45 이후)");
  assert.equal(line.tone, "warn");
  assert.equal(buildFeedDiagnosticsLine({ disconnects: 0, staleGaps: 1, maxGapMs: 31_000, since: SINCE }).tone, "warn", "a single long gap is enough");
});

test("HOME shows the feed row from the server window counts and hides them when disconnected", () => {
  assert.match(view, /testID="home-feed-line"/);
  assert.match(view, /feedDisconnectCount/);
  assert.match(view, /buyHeartbeat = fieldInput\.disconnected \|\| readOnlyError != null \? null/);
});

test("the runtime counts feed drops and long ticker gaps on arrival time, in the same window, display only", () => {
  assert.match(runtime, /feedDisconnects: 0, feedStaleGaps: 0, feedMaxGapMs: 0/);
  assert.match(runtime, /if \(gap > DEFAULT_UPBIT_TICKER_STALE_WINDOW_MS\) buyWindow\.feedStaleGaps \+= 1/);
  assert.match(runtime, /const arrivedAt = Date\.now\(\);\s*\n\s*rollBuyWindow\(arrivedAt\)/);
  assert.match(runtime, /state !== "CONNECTED" && marketConnectionState === "CONNECTED"\) \{ rollBuyWindow\(Date\.now\(\)\); buyWindow\.feedDisconnects \+= 1; \}/);
  const start = runtime.indexOf("const readHeartbeat = ");
  const body = runtime.slice(start, runtime.indexOf("\n  };\n", start));
  assert.match(body, /config\.upbitPublicDataEnabled \? \{ feedDisconnectCount/, "reported only when the public feed is on");
  assert.match(body, /productionPaperBoundary == null \? \{\} : \{ buySignalCount/, "the BUY counters still need the PAPER boundary");
});

test("the operations contract accepts the feed fields and drops malformed ones without rejecting the snapshot", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500).operations.heartbeat;
  const good = attempt({ feedDisconnectCount: 2, feedStaleGapCount: 3, feedMaxGapMs: 41_000, feedCountsSince: 900 });
  assert.equal(good.feedDisconnectCount, 2);
  assert.equal(good.feedMaxGapMs, 41_000);
  assert.equal(attempt({}).feedDisconnectCount, undefined, "older runtimes omit the fields");
  const bad = attempt({ feedDisconnectCount: -1, feedStaleGapCount: 0.5, feedMaxGapMs: "9", feedCountsSince: null });
  for (const name of ["feedDisconnectCount", "feedStaleGapCount", "feedMaxGapMs", "feedCountsSince"]) assert.equal(bad[name], undefined, `${name} is dropped`);
  assert.equal(bad.decisionCount, 0);
});
