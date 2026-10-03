const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/dailyResetModel.ts"), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { applyDailyBaseline, nextDailyBaseline, resetDayKey, msUntilNextReset, chooseDailyCounts, partialWindowNote } = shim.exports;
const kst = (d, h, m = 0) => Date.UTC(2026, 9, d, h - 9, m);

test("window flips exactly at 09:00 KST, not at midnight KST", () => {
  assert.equal(resetDayKey(kst(2, 8, 59)), resetDayKey(kst(2, 0, 1)));
  assert.notEqual(resetDayKey(kst(2, 8, 59)), resetDayKey(kst(2, 9, 0)));
});
test("counts are relative to the window baseline and reset at 09:00", () => {
  const b = nextDailyBaseline(null, 7, 1000, 5, kst(2, 10));
  assert.deepEqual({ ...applyDailyBaseline(b, 7, 1500, 7, kst(2, 12)) }, { decisionCount: 500, paperOrderCount: 2 });
  assert.deepEqual({ ...applyDailyBaseline(b, 7, 1800, 7, kst(3, 9, 0)) }, { decisionCount: 0, paperOrderCount: 0 });
});
test("server counter going backwards rebases; null stays null", () => {
  const b = nextDailyBaseline(null, 7, 1000, 5, kst(2, 10));
  assert.equal(applyDailyBaseline(b, 7, 10, 0, kst(2, 11)).decisionCount, 0);
  assert.equal(applyDailyBaseline(b, 7, null, null, kst(2, 11)).decisionCount, null);
});

test("a different runtime source rebases even when its counters are higher", () => {
  const b = nextDailyBaseline(null, 7, 1000, 5, kst(2, 10));
  assert.equal(applyDailyBaseline(b, 8, 5000, 9, kst(2, 11)).decisionCount, 0);
});
test("next reset is the following 09:00 KST", () => {
  assert.equal(msUntilNextReset(kst(2, 8, 59)), 60_000);
  assert.equal(msUntilNextReset(kst(2, 9, 0)), 86_400_000);
});

test("server window counts win over the client baseline, and only when both are usable", () => {
  const baseline = { decisionCount: 2522, paperOrderCount: 0 };
  assert.deepEqual({ ...chooseDailyCounts(24222, 6, baseline) }, { decisionCount: 24222, paperOrderCount: 6 }, "covers the whole window even if the app opened late");
  assert.equal(chooseDailyCounts(undefined, undefined, baseline), baseline, "older servers fall back to the client baseline");
  assert.equal(chooseDailyCounts(10, undefined, baseline), baseline, "one usable value is not enough");
  assert.equal(chooseDailyCounts(-1, 0, baseline), baseline);
  assert.equal(chooseDailyCounts(NaN, 0, baseline), baseline);
  assert.equal(chooseDailyCounts("10", 0, baseline), baseline, "non-numbers are ignored");
  assert.deepEqual({ ...chooseDailyCounts(0, 0, baseline) }, { decisionCount: 0, paperOrderCount: 0 }, "a real zero is a value, not missing");
});

test("HOME uses the server window counts for the rings and field, keeping the baseline hook as the fallback", () => {
  const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
  assert.match(view, /const baselineCounts = useDailyCounts\(/);
  assert.match(view, /const dailyCounts = chooseDailyCounts\(snapshot\?\.operations\.heartbeat\?\.windowDecisionCount, snapshot\?\.operations\.heartbeat\?\.windowOrderCount, baselineCounts\)/);
});

test("the runtime counts decisions and orders in the same 09:00 KST window and reports them only with the PAPER boundary", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /buyWindow = \{ key: Math\.floor\(runtimeStartedAt \/ BUY_WINDOW_MS\), signals: 0, blocked: 0, decisions: 0, orders: 0, feedDisconnects: 0, feedStaleGaps: 0, feedMaxGapMs: 0 \}/);
  assert.match(runtime, /buyWindow\.decisions \+= state\.decisions\.length/);
  assert.match(runtime, /buyWindow\.orders \+= result\.orders\.length/);
  const start = runtime.indexOf("const readHeartbeat = ");
  const body = runtime.slice(start, runtime.indexOf("\n  };\n", start));
  assert.match(body, /productionPaperBoundary == null \? \{\} : \{ buySignalCount/, "the window counts need the PAPER boundary");
  assert.match(body, /windowDecisionCount: buyWindow\.decisions, windowOrderCount: buyWindow\.orders/);
});

test("the operations contract accepts the window counts and rejects bad values", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500);
  assert.equal(attempt({ windowDecisionCount: 10, windowOrderCount: 2 }).operations.heartbeat.windowDecisionCount, 10);
  assert.equal(attempt({}).operations.heartbeat.windowDecisionCount, undefined);
  // Malformed display-only counters are omitted, never reject the snapshot and hide valid state.
  const bad = attempt({ windowDecisionCount: -1, windowOrderCount: 0.5, buySignalCount: "3", buyBlockedCount: null, buyCountsSince: -5 }).operations.heartbeat;
  for (const name of ["windowDecisionCount", "windowOrderCount", "buySignalCount", "buyBlockedCount", "buyCountsSince"]) assert.equal(bad[name], undefined, `${name} is dropped`);
  assert.equal(bad.decisionCount, 0, "the validated cumulative fields are kept");
  const mixed = attempt({ windowDecisionCount: 7, windowOrderCount: -1 }).operations.heartbeat;
  assert.equal(mixed.windowDecisionCount, 7);
  assert.equal(mixed.windowOrderCount, undefined, "only the malformed one is dropped");
});

test("a restart inside the window is disclosed; a full window and unknown starts show nothing", () => {
  const now = kst(3, 12, 24);
  const windowStart = Date.UTC(2026, 9, 3, 0, 0, 0);
  assert.equal(partialWindowNote(windowStart, now), null, "counts cover the whole window");
  assert.equal(partialWindowNote(windowStart + 30_000, now), null, "within a minute of the window start is not a restart");
  assert.equal(partialWindowNote(Date.UTC(2026, 9, 3, 2, 45, 0), now), "11:45 이후 집계 (서버 재시작)");
  assert.equal(partialWindowNote(undefined, now), null);
  assert.equal(partialWindowNote(-1, now), null);
  assert.equal(partialWindowNote(Date.UTC(2026, 9, 2, 20, 0, 0), now), null, "a start before the current window is not partial");
  const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
  assert.match(view, /testID="home-window-note"/);
  assert.match(view, /partialWindowNote\(snapshot\?\.operations\.heartbeat\?\.buyCountsSince, Date\.now\(\)\)/);
});

test("window counters are attributed with the time of counting, not the start of the tick", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /rollBuyWindow\(Date\.now\(\)\);\s*\n\s*buyWindow\.decisions \+= state\.decisions\.length/);
  assert.match(runtime, /rollBuyWindow\(Date\.now\(\)\);\s*\n\s*buyWindow\.orders \+= result\.orders\.length/);
  assert.match(runtime, /canonicalDecision\?\.action === "BUY"\) \{ rollBuyWindow\(Date\.now\(\)\)/);
});
