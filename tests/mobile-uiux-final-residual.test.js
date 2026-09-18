const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home MASTER preserves safety-first routes and truthful supervisor action", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");
  for (const marker of ['testID="home-screen"','testID="home-master-rail"','testID="ai-card"','testID="home-decision-stage"','testID="home-paper-performance"','testID="home-paper-learning"','testID="home-risk-authority"']) assert.match(home, new RegExp(marker));
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /testID="home-operational-notice"/);
  assert.match(home, /onPress=\{props\.onGoSettings\}/);
  assert.match(home, /onNavigate\("Portfolio"\)/);
  assert.match(home, /onNavigate\("AiSignal"\)/);
  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(decisionSurface, /"CONNECT PAPER"/);
  assert.match(decisionSurface, /const primaryAction: HomeDecisionPrimaryAction/);
});

test("AI separates uncalibrated raw probability from trusted calibrated confidence", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
  assert.match(app, /<HomeView snapshot=\{snapshot\}/);
  for (const source of [ai]) {
    assert.match(source, /UNVERIFIED/);
    assert.match(source, /검증 신뢰도/);
    assert.match(source, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
    assert.doesNotMatch(source, /<DataRow label="신뢰도"/);
    assert.doesNotMatch(source, /모델 점수 \(미보정\)/);
  }
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
  assert.match(ai, /calibrationStatus === "CALIBRATED"/);
  assert.match(ai, /calibrated\?percent\(ai\?\.confidence\):"UNVERIFIED"/);
  assert.match(ai, /calibrated\?`검증 신뢰도/);
  assert.match(ai, /수익 확률로 표시하지 않습니다/);
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
