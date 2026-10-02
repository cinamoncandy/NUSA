const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/learningLineModel.ts"), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildLearningLine } = shim.exports;
const r = (o = {}) => ({ health: "HEALTHY", candidateCount: 3, experimentCount: 12, evidenceAgeMs: 5 * 3_600_000, metrics: { championBetterCount: 4, challengerBetterCount: 6, equivalentCount: 1, inconclusiveCount: 1 }, ...o });

test("missing research projection is stated, not invented", () => {
  assert.equal(buildLearningLine(null).value, "리서치 상태 미수신");
});
test("no experiments yet reads as not started", () => {
  assert.match(buildLearningLine(r({ experimentCount: 0 })).value, /실험 아직 없음/);
});
test("healthy research shows counts and evidence age", () => {
  const l = buildLearningLine(r());
  assert.equal(l.tone, "ok");
  assert.match(l.value, /실험 12 · 후보 3 · 도전자 우세 6\/현재 4 · 5시간 전 검증/);
});
test("stale or degraded research is flagged, never presented as healthy", () => {
  assert.equal(buildLearningLine(r({ health: "STALE", evidenceAgeMs: 100 * 3_600_000 })).tone, "warn");
  assert.match(buildLearningLine(r({ health: "STALE", evidenceAgeMs: 100 * 3_600_000 })).value, /검증 오래됨 \(4일 전 검증\)/);
  assert.match(buildLearningLine(r({ health: "FAIL_CLOSED" })).value, /연구 일시 제한/);
});
