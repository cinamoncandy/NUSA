const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/researchProgressModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildResearchProgressLine } = shim.exports;
const { ResearchExperimentOrchestrator } = require("../dist/apps/cloud/src/researchExperimentOrchestrator.js");
const { validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
const contract = fs.readFileSync(path.resolve(__dirname, "../packages/contracts/src/personalPaperOperations.ts"), "utf8");
const NOW = Date.UTC(2026, 9, 3, 6, 0, 0);
const REQ = 11 * 1440;

test("missing or malformed progress reads as not reported", () => {
  for (const bad of [undefined, null, {}, { market: "BTC", candleCount: 1, requiredCandles: 10 }, { market: "KRW-XRP", candleCount: -1, requiredCandles: 10 }, { market: "KRW-XRP", candleCount: 1, requiredCandles: 0 }, { market: "KRW-XRP", candleCount: 1.5, requiredCandles: 10 }]) {
    const line = buildResearchProgressLine(bad, NOW);
    assert.equal(line.value, "집계 미수신");
    assert.equal(line.tone, "muted");
  }
});

test("progress shows collected days, percentage, last collection and time to the first experiment", () => {
  const line = buildResearchProgressLine({ market: "KRW-XRP", candleCount: 1440, requiredCandles: REQ, firstCloseMs: NOW - 1440 * 60_000, lastCloseMs: NOW - 5 * 60_000, observedAt: NOW }, NOW);
  assert.equal(line.value, "KRW-XRP 1/11일치 (9%)");
  assert.match(line.detail, /마지막 수집 5분 전/);
  assert.match(line.detail, /첫 실험까지 약 10일/);
  assert.equal(line.tone, "ok");
});

test("enough candles says so without claiming an experiment ran", () => {
  const line = buildResearchProgressLine({ market: "KRW-XRP", candleCount: REQ, requiredCandles: REQ, lastCloseMs: NOW - 60_000, observedAt: NOW }, NOW);
  assert.match(line.detail, /필요량 충족/);
  assert.doesNotMatch(line.value + line.detail, /실험.*(완료|진행 중|실행)/);
});

test("a long silence is flagged and gaps are shown", () => {
  const stale = buildResearchProgressLine({ market: "KRW-XRP", candleCount: 100, requiredCandles: REQ, lastCloseMs: NOW - 3 * 3_600_000, observedAt: NOW }, NOW);
  assert.equal(stale.tone, "warn");
  assert.match(stale.detail, /수집이 멈췄을 수 있음/);
  const gappy = buildResearchProgressLine({ market: "KRW-XRP", candleCount: 900, requiredCandles: REQ, firstCloseMs: NOW - 1000 * 60_000, lastCloseMs: NOW - 60_000, observedAt: NOW }, NOW);
  assert.match(gappy.detail, /빈 구간 \d+%/);
});

test("the orchestrator reports stored candles against the three windows and caches briefly", () => {
  let reads = 0;
  const self = { progressCache: undefined, options: { markets: ["KRW-XRP"], intervalMs: 60_000, windows: { trainMs: 7 * 86_400_000, validationMs: 2 * 86_400_000, holdoutMs: 2 * 86_400_000 }, now: () => NOW,
    candles: { count: () => { reads += 1; return 1234; }, earliestCloseTime: () => NOW - 1_300 * 60_000, latestCloseTime: () => NOW - 60_000 } } };
  const first = ResearchExperimentOrchestrator.prototype.collectionProgress.call(self);
  assert.deepEqual({ ...first }, { market: "KRW-XRP", candleCount: 1234, requiredCandles: REQ, firstCloseMs: NOW - 1_300 * 60_000, lastCloseMs: NOW - 60_000, observedAt: NOW });
  ResearchExperimentOrchestrator.prototype.collectionProgress.call(self);
  assert.equal(reads, 1, "the count is not re-queried within 30 s");
  assert.equal(ResearchExperimentOrchestrator.prototype.collectionProgress.call({ progressCache: undefined, options: { ...self.options, candles: { latestCloseTime: () => undefined } } }), null, "a store without a count reports nothing");
  assert.equal(ResearchExperimentOrchestrator.prototype.collectionProgress.call({ progressCache: undefined, options: { ...self.options, candles: { count: () => { throw new Error("db"); }, latestCloseTime: () => undefined } } }), null, "a failing store never throws");
});

test("the runtime and contract treat the progress as optional display data", () => {
  assert.match(runtime, /researchAutomation\?\.collectionProgress\?\.\(\) \?\? null/);
  assert.match(runtime, /try \{ researchProgress = /, "a failing provider cannot break the heartbeat");
  assert.match(contract, /isValidResearchCollection/);
  assert.match(view, /home-research-progress-line/);
  assert.match(view, /buildResearchProgressLine\(buyHeartbeat\?\.researchCollection/);
});
