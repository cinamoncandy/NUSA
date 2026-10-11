const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const load = (rel) => {
  const shim = { exports: {} };
  new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
  return shim.exports;
};
const { explainDecision, isDecisionDetail } = load("../apps/mobile/src/whyNoTradeModel.ts");
const { describeCanonicalDecision } = load("../apps/cloud/src/paperDecisionDetail.ts");
const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
const contract = fs.readFileSync(path.resolve(__dirname, "../packages/contracts/src/personalPaperOperations.ts"), "utf8");

const base = { action: "WAIT", score: 0.1, confidence: 0.3, risk: "LOW", hasPosition: false, observedAt: 1 };

test("missing or malformed detail explains nothing", () => {
  assert.deepEqual([...explainDecision(undefined)], []);
  assert.deepEqual([...explainDecision({ ...base, action: "wait" })], []);
  assert.deepEqual([...explainDecision({ ...base, score: NaN })], []);
  assert.equal(isDecisionDetail({ ...base, hasPosition: "no" }), false);
});

test("SMA crossover reason shows the reported averages", () => {
  const lines = explainDecision({ ...base, strategyAction: "WAIT", reason: "PAPER_CANDIDATE:fam:SMA_CROSSOVER:5/20:short=100.5:long=101.2" });
  assert.match(lines[0], /^최근 판단: WAIT/);
  assert.match(lines[1], /단기 100\.5 · 장기 101\.2/);
  assert.match(lines[1], /아래/);
});

test("insufficient observations, donchian and rsi are explained from their numbers", () => {
  assert.match(explainDecision({ ...base, reason: "X:INSUFFICIENT_CANDLE_OBSERVATIONS:12/30" })[1], /12\/30/);
  assert.match(explainDecision({ ...base, reason: "X:DONCHIAN_BREAKOUT:20:high=105:low=95" })[1], /고점 105/);
  assert.match(explainDecision({ ...base, reason: "X:RSI_MEAN_REVERSION:14:30/70" })[1], /RSI 14/);
});

test("high risk without a position and fallback thresholds are worded honestly", () => {
  assert.match(explainDecision({ ...base, risk: "HIGH" })[1], /위험 등급이 HIGH/);
  assert.match(explainDecision(base)[1], /0\.35 이상.*0\.55 이상/);
  assert.match(explainDecision({ ...base, strategyAction: "SELL" })[1], /매도할 것이 없습니다/);
});

test("the cloud detail is sanitized, bounded and frozen", () => {
  const d = describeCanonicalDecision({ action: "WAIT", score: 0.123456, confidence: Infinity, risk: "LOW", allocation: 0, reasons: ["a b<script>:1/2"], paperCandidateStrategyDecision: { action: "WAIT" } }, 5);
  assert.equal(d.score, 0.1235);
  assert.equal(d.confidence, 0);
  assert.equal(d.hasPosition, false);
  assert.match(d.reason, /^[A-Za-z0-9_.:/=+-]+$/);
  assert.ok(Object.isFrozen(d));
});

test("runtime reports the detail only inside the PAPER boundary block and the contract drops bad detail", () => {
  assert.match(runtime, /lastDecisionDetail = describeCanonicalDecision\(canonicalDecision, now\)/);
  assert.match(runtime, /lastDecisionDetail === undefined \? \{\} : \{ lastDecisionDetail \}/);
  assert.match(contract, /isValidDecisionDetail/);
  assert.match(contract, /lastDecisionDetail/);
  assert.match(view, /home-decision-why-/);
});
