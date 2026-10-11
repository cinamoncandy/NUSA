"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const SRC = path.join(__dirname, "..", "apps", "mobile", "src");
function load(name) {
  const out = ts.transpileModule(fs.readFileSync(path.join(SRC, `${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, (id) => load(id.replace(/^\.\//, "")));
  return mod.exports;
}
const { buildLearningScreen } = load("learningScreenModel");
const perf = { realizedPnL: -23, unrealizedPnL: 0, fees: 2.5, turnover: 0, completedCycles: 10, filledCycles: 2, winRate: null, expectancy: null, maxDrawdown: 0.022 };
const base = { readOnly: true, mode: "PAPER", currentCycle: "c", status: "RUNNING", dataSource: "CLOUD", latestMarket: "KRW-XRP", latestStrategy: {}, latestSignal: { action: "BUY" }, latestDecision: { action: "BUY", allocation: 0.1, confidence: 0.6 }, latestGates: [], latestRisk: { status: "FAIL", reason: "CONSECUTIVE_LOSS_LIMIT" }, latestFill: null, latestAccount: null, latestEvidence: null, timeline: [], recentCycles: [], performance: perf, entryPoints: [], autoRefresh: true, halt: null };

test("risk block is shown as the narrowest step, in amber, with the server's code", () => {
  const m = buildLearningScreen(base);
  assert.equal(m.tone, "ATTENTION");
  assert.equal(m.steps.find((s) => s.label === "안전").state, "BLOCKED");
  assert.equal(m.steps.find((s) => s.label === "체결").state, "NONE");
  assert.match(m.narrowest, /CONSECUTIVE_LOSS_LIMIT/);
  assert.equal(m.rows.find((r) => r.label === "실현 손익").value, "−₩23");
  assert.equal(m.rows.find((r) => r.label === "승률").value, "—");
});

test("missing server data never shows results or healthy", () => {
  for (const dataSource of ["NOT_CONFIGURED", "UNAVAILABLE", "PROJECTION_ABSENT"]) {
    const m = buildLearningScreen({ ...base, dataSource });
    assert.equal(m.tone, "ATTENTION");
    assert.equal(m.rows.length, 0);
    assert.equal(m.headline, "학습 정보를 받지 못했어요");
  }
});

test("halted is red", () => {
  assert.equal(buildLearningScreen({ ...base, status: "HALTED", latestRisk: null }).tone, "LOSS");
});
