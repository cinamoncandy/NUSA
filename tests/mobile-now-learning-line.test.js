const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/learningLineModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildNowLearningLine } = shim.exports;
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/nowView.tsx"), "utf8");
const r = (o = {}) => ({ health: "HEALTHY", candidateCount: 2, experimentCount: 3, evidenceAgeMs: 5 * 3_600_000, metrics: { championBetterCount: 0, challengerBetterCount: 1, equivalentCount: 0, inconclusiveCount: 0 }, ...o });

test("a healthy loop reads in plain words, without champion/challenger or promotion jargon", () => {
  const line = buildNowLearningLine(r());
  assert.deepEqual({ ...line }, { value: "배우고 있나 · 실험 3개 · 후보 2개 · 5시간 전 검증", tone: "muted" });
  assert.doesNotMatch(line.value, /도전자|현재 |승격/);
});

test("no research projection shows nothing instead of a permanent 'not received' line", () => {
  assert.equal(buildNowLearningLine(null), null);
});

test("stale, restricted, malformed and not-started states are stated honestly", () => {
  assert.deepEqual({ ...buildNowLearningLine(r({ health: "STALE" })) }, { value: "배우고 있나 · 검증이 오래됐어요 (5시간 전 검증)", tone: "warn" });
  assert.equal(buildNowLearningLine(r({ health: "DEGRADED" })).value, "배우고 있나 · 연구가 잠시 멈췄어요");
  assert.equal(buildNowLearningLine(r({ experimentCount: Number.NaN })).tone, "warn");
  assert.equal(buildNowLearningLine(r({ experimentCount: 0 })).value, "배우고 있나 · 아직 실험 전이에요");
});

test("the Now tab uses the short variant, hides it when stale or blocked, and keeps it out of the money lines", () => {
  assert.match(view, /const learningLine = blocked \? null : buildNowLearningLine\(snapshot\?\.research \?\? null\);/);
  const order = ["now-today-realized", "now-loss-limit", "now-why", "now-learning-line"].map((id) => view.indexOf(`testID="${id}"`));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "learning line comes after P&L, loss limit and why");
});
