const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = () => fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");

test("mobile AI separates uncalibrated raw probability from trusted calibrated confidence", () => {
  const code = source();
  assert.match(code, /원시 모델 확률 \(미보정\)/);
  assert.match(code, /검증 신뢰도/);
  assert.match(code, /보정 확률/);
  assert.match(code, /ai\?\.calibrationStatus === "CALIBRATED" \? percent\(ai\.confidence\) : "-"/);
  assert.match(code, /ai\?\.calibrationStatus === "CALIBRATED" \? percent\(ai\.calibratedProbability\) : "-"/);
  assert.doesNotMatch(code, /모델 점수 \(미보정\)/);
});

test("mobile AI explains that raw probability is not a verified probability or performance guarantee", () => {
  const code = source();
  assert.match(code, /원시 모델 확률은 미보정 모델 출력/);
  assert.match(code, /검증된 성공 확률이나 성과 보장이 아닙니다/);
  assert.match(code, /CALIBRATED일 때만 별도의 검증 신뢰도/);
});

test("mobile AI translates verdict/status enums to plain Korean instead of raw English tokens", () => {
  // calibrationStatus/explanationVerdict/scenarioRobustnessState reach the UI as raw English
  // enum values (e.g. "ABSTAIN", "NOT_EVALUATED") -- exactly the fields meant to build the
  // user's trust in the AI, so leaving them untranslated undercuts explainability even though
  // the rest of the screen is fully Korean.
  const code = source();
  assert.match(code, /calibrationStatusLabel/);
  assert.match(code, /explanationVerdictLabel/);
  assert.match(code, /scenarioRobustnessLabel/);
  assert.match(code, /ABSTAIN: "판단 보류"/);
  assert.match(code, /CALIBRATED: "보정 완료"/);
  assert.match(code, /SENSITIVE: "민감함"/);
  assert.doesNotMatch(code, /value=\{ai\?\.calibrationStatus \?\? "UNKNOWN"\}/);
  assert.doesNotMatch(code, /value=\{ai\?\.explanationVerdict \?\? "NOT_EVALUATED"\}/);
  assert.doesNotMatch(code, /value=\{ai\?\.scenarioRobustnessState \?\? "NOT_EVALUATED"\}/);
});

test("mobile AI exposes calibration evidence without adding execution authority", () => {
  const code = source();
  assert.match(code, /보정 표본/);
  assert.match(code, /label="ECE"/);
  assert.match(code, /label="Brier"/);
  assert.match(code, /ZERO AUTHORITY/);
  assert.match(code, /READ ONLY/);
  assert.doesNotMatch(code, /submitOrder\s*\(|cancelOrder\s*\(|withdraw\s*\(|transfer\s*\(/i);
});
