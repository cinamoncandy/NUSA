const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home exposes one real safety-first next action from verified runtime state", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="home-next-action"/);
  assert.match(app, /testID="home-next-action-button"/);
  assert.match(app, /PAPER 상태 보기/);
  assert.match(app, /AI 분석 보기/);
  assert.match(app, /시장 보기/);
  assert.match(app, /setActiveTab\(nextAction\.tab\)/);
  assert.match(app, /snapshot\.health !== "HEALTHY" \|\| snapshot\.dashboard\.killSwitchActive \|\| !snapshot\.readyForPaperOperations/);
  assert.match(app, /aiInsightAvailable = ai\?\.status === "AVAILABLE" && Boolean\(ai\.thesis\?\.trim\(\)\) && ai\.evidenceReferences\.length > 0/);
  assert.match(app, /: aiInsightAvailable\s*\? \{ title: "최신 AI 분석 확인"/s);
});

test("AI separates uncalibrated raw probability from trusted calibrated confidence", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  for (const source of [app, ai]) {
    assert.match(source, /원시 모델 확률 \(미보정\)/);
    assert.match(source, /검증 신뢰도/);
    assert.match(source, /보정 상태/);
    assert.doesNotMatch(source, /<DataRow label="신뢰도"/);
    assert.doesNotMatch(source, /모델 점수 \(미보정\)/);
  }
  assert.match(app, /ai\?\.calibrationStatus === "CALIBRATED"/);
  assert.match(app, /aiRawProbability/);
  assert.match(app, /aiTrustedConfidence/);
  assert.match(ai, /calibrationStatus === "CALIBRATED"/);
  assert.match(ai, /보정 확률/);
  assert.match(ai, /원시 모델 확률은 미보정 모델 출력/);
  assert.match(ai, /검증된 성공 확률이나 성과 보장이 아닙니다/);
  assert.match(ai, /CALIBRATED일 때만 별도의 검증 신뢰도/);
});

test("Residual polish preserves read-only and zero-authority product boundaries", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});
