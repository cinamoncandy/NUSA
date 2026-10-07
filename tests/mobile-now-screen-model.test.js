"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const SRC = path.join(__dirname, "..", "apps", "mobile", "src");
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const src = fs.readFileSync(path.join(SRC, `${name}.ts`), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[name] = mod.exports;
  new Function("module", "exports", "require", out)(mod, mod.exports, (id) => load(id.replace(/^\.\//, "")));
  return mod.exports;
}
const { buildNowScreen } = load("nowScreenModel");

const base = {
  phase: "CONNECTED", phaseHeadline: "시스템이 정상 작동 중", phaseDetail: "", staleLabel: null,
  equity: 9781, totalPnl: -219, startingEquity: 10000, orderReasonText: null, whyLines: [],
  decisionCount: 3680, paperOrderCount: 6, fillCount: 6,
};

test("healthy: one calm sentence, loss in red with percent, order count in lime", () => {
  const m = buildNowScreen(base);
  assert.equal(m.tone, "NORMAL");
  assert.equal(m.headline, "모두 정상이에요");
  assert.equal(m.dim, false);
  assert.equal(m.equity, "₩9,781");
  assert.equal(m.delta, "시작보다 −₩219 (−2.2%)");
  assert.equal(m.deltaTone, "LOSS");
  assert.deepEqual(m.stats.map((s) => [s.label, s.value, s.tone]), [["판단", "3,680", "NORMAL"], ["주문", "6", "ORDER"], ["체결", "6", "NORMAL"]]);
});

test("stale values never read as healthy and are dimmed", () => {
  const m = buildNowScreen({ ...base, staleLabel: "마지막 확인 2분 전" });
  assert.equal(m.tone, "ATTENTION");
  assert.equal(m.dim, true);
  assert.match(m.sub, /마지막 확인 2분 전/);
});

test("halt is red and keeps the runtime's own headline; unverified phases are amber", () => {
  assert.equal(buildNowScreen({ ...base, phase: "HALTED", phaseHeadline: "안전 정지 중" }).tone, "LOSS");
  assert.equal(buildNowScreen({ ...base, phase: "HALTED", phaseHeadline: "안전 정지 중" }).headline, "안전 정지 중");
  for (const phase of ["LAUNCH", "AUTHENTICATION", "RECOVERING", "DEGRADED"]) {
    const m = buildNowScreen({ ...base, phase, phaseHeadline: "PAPER 서버\n연결 필요" });
    assert.equal(m.tone, "ATTENTION", phase);
    assert.equal(m.dim, true, phase);
    assert.ok(!m.headline.includes("\n"));
  }
});

test("unknown money and counts show a dash, never zero or a colour", () => {
  const m = buildNowScreen({ ...base, equity: null, totalPnl: null, startingEquity: null, decisionCount: null, paperOrderCount: null, fillCount: null });
  assert.equal(m.equity, "—");
  assert.equal(m.delta, null);
  assert.equal(m.deltaTone, "MUTED");
  assert.deepEqual(m.stats.map((s) => s.value), ["—", "—", "—"]);
});

test("why joins the order reason with the decision explanation", () => {
  const m = buildNowScreen({ ...base, orderReasonText: "안전장치가 매수를 막았어요.", whyLines: ["연속 손실 한도", " "] });
  assert.equal(m.why, "안전장치가 매수를 막았어요. 연속 손실 한도");
});
