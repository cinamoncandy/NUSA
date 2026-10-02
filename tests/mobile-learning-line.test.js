const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/learningLineModel.ts"), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildLearningLine, promotionProgress, buildAiTrustLine } = shim.exports;
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
  assert.match(l.value, /실험 12 · 후보 3 · 도전자 우세 6\/현재 4 · 5시간 전 검증 · 승격 기준 거래 0\/50 · 관측 0\/30일/);
});
test("stale or degraded research is flagged, never presented as healthy", () => {
  assert.equal(buildLearningLine(r({ health: "STALE", evidenceAgeMs: 100 * 3_600_000 })).tone, "warn");
  assert.match(buildLearningLine(r({ health: "STALE", evidenceAgeMs: 100 * 3_600_000 })).value, /검증 오래됨 \(4일 전 검증\)/);
  assert.match(buildLearningLine(r({ health: "FAIL_CLOSED" })).value, /연구 일시 제한/);
});

test("promotion progress shows trades and days toward the 50/30 gate and tolerates missing metrics", () => {
  assert.equal(promotionProgress({ tradeCount: 8, observationDays: 3 }), "승격 기준 거래 8/50 · 관측 3/30일");
  assert.equal(promotionProgress({}), "승격 기준 거래 0/50 · 관측 0/30일");
  assert.equal(promotionProgress({ tradeCount: -4, observationDays: NaN }), "승격 기준 거래 0/50 · 관측 0/30일");
});

const ai = (o = {}) => ({ status: "AVAILABLE", calibrationStatus: "CALIBRATED", calibrationSampleCount: 120, calibrationExpectedError: 0.043, calibrationBrierScore: 0.2111, calibrationDurabilityStatus: "HEALTHY", ...o });
test("AI trust: missing or unavailable AI is stated, never invented", () => {
  assert.equal(buildAiTrustLine(null).value, "AI 상태 미수신");
  assert.equal(buildAiTrustLine(ai({ status: "UNAVAILABLE" })).value, "AI 분석 사용 불가");
});
test("AI trust: calibrated shows samples, expected error and Brier", () => {
  const l = buildAiTrustLine(ai());
  assert.equal(l.tone, "ok");
  assert.equal(l.value, "보정 완료 · 표본 120 · 예상 오차 4.3%p · Brier 0.211");
});
test("AI trust: only CALIBRATED is trusted; everything else reads as zero trust", () => {
  for (const st of ["UNKNOWN", "UNVERIFIED"]) assert.match(buildAiTrustLine(ai({ calibrationStatus: st })).value, /신뢰도 0/);
  assert.match(buildAiTrustLine(ai({ calibrationStatus: "INSUFFICIENT_DATA", calibrationSampleCount: 7 })).value, /표본 부족 \(7건\) · 신뢰도 0/);
  assert.match(buildAiTrustLine(ai({ calibrationStatus: "DEGRADED" })).value, /보정 저하/);
  assert.equal(buildAiTrustLine(ai({ calibrationStatus: "UNKNOWN" })).tone, "warn");
});
test("AI trust: unhealthy calibration storage is flagged even when calibrated", () => {
  const l = buildAiTrustLine(ai({ calibrationDurabilityStatus: "UNHEALTHY" }));
  assert.equal(l.tone, "warn");
  assert.match(l.value, /보정 기록 저장 이상/);
});

test("a fail-closed research state with zero experiments is not hidden behind 실험 아직 없음", () => {
  const l = buildLearningLine(r({ experimentCount: 0, health: "FAIL_CLOSED" }));
  assert.equal(l.tone, "warn");
  assert.match(l.value, /실험 아직 없음 · 연구 일시 제한/);
});
test("malformed research projection never throws and reads as a warning", () => {
  for (const bad of [r({ metrics: undefined }), r({ metrics: null }), r({ experimentCount: "x" }), r({ candidateCount: undefined }), r({ experimentCount: NaN })]) {
    const l = buildLearningLine(bad);
    assert.equal(l.tone, "warn");
    assert.match(l.value, /형식 확인 필요/);
  }
  assert.doesNotThrow(() => promotionProgress(undefined));
  assert.doesNotThrow(() => buildLearningLine(r({ metrics: {} })));
});
