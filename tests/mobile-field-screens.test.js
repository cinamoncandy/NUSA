const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "apps/mobile/src/fieldScreensModel.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { buildPaperFieldHeader, buildLiveFieldHeader } = shim.exports;

const perf = { realizedPnL: 0, unrealizedPnL: 0, fees: 0, turnover: 0, completedCycles: 12, filledCycles: 0, winRate: null, expectancy: null, maxDrawdown: 0 };
const paper = (overrides = {}) => ({ status: "RUNNING", dataSource: "SERVER_STREAM", performance: perf, ...overrides });
const safety = { killSwitchActive: false, staleMarketData: false, reconciliationMismatch: false, exchangeError: false, abnormalBalanceDrift: false, riskBudgetBreached: false, strategyInvalidated: false, latencyOrSlippageBreached: false };
const live = (overrides = {}) => ({ status: "NOT_READY", blockers: ["a", "b"], liveAuthority: "NONE", runtimeSafety: safety, ...overrides });

test("PAPER header fails closed and never reads green without a verified source", () => {
  assert.equal(buildPaperFieldHeader(paper({ dataSource: "UNAVAILABLE" })).tone, "amber");
  assert.equal(buildPaperFieldHeader(paper({ status: "HALTED" })).tone, "red");
  assert.equal(buildPaperFieldHeader(paper({ status: "ERROR" })).tone, "amber");
  assert.equal(buildPaperFieldHeader(paper({ status: "PAUSED" })).tone, "dim");
  const idle = buildPaperFieldHeader(paper());
  assert.match(idle.headline, /체결이 없습니다/);
  assert.equal(idle.facts.find((f) => f.label === "FILLS").value, "0");
  assert.equal(buildPaperFieldHeader(paper({ performance: { ...perf, filledCycles: 3 } })).headline, "PAPER 실행 중");
});

test("LIVE header is always SEALED or HALTED and never claims LIVE is active", () => {
  assert.equal(buildLiveFieldHeader(null, "offline").statusWord, "SEALED");
  assert.equal(buildLiveFieldHeader(live()).statusWord, "SEALED");
  assert.equal(buildLiveFieldHeader(live({ runtimeSafety: { ...safety, killSwitchActive: true } })).tone, "red");
  const ready = buildLiveFieldHeader(live({ status: "READY_FOR_MANUAL_ENABLE", blockers: [] }));
  assert.equal(ready.statusWord, "SEALED");
  assert.match(ready.detail, /소유자 승인/);
  for (const model of [buildLiveFieldHeader(null), buildLiveFieldHeader(live()), ready]) assert.notEqual(model.tone, "green");
});

test("PAPER, LIVE and MORE render the field visual language", () => {
  const read = (file) => fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8");
  assert.match(read("paperShadowMonitorView.tsx"), /<FieldHeader model=\{buildPaperFieldHeader\(paper\)\}/);
  assert.match(read("liveReadinessMonitorView.tsx"), /<FieldHeader model=\{buildLiveFieldHeader\(snapshot, unavailableReason\)\}/);
  assert.match(read("moreMenuView.tsx"), /fieldPalette\.void/);
  const header = read("fieldHeader.tsx");
  assert.match(header, /reducedMotion !== false/);
  assert.doesNotMatch(header, /Animated\.loop/);
});
