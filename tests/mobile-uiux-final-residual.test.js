const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home exposes exactly one real safety-first next action from verified runtime state", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");
  // The one actionable button lives only in the supervisor deck; the canonical projection decides
  // its label/destination so presentation never reconstructs runtime truth independently.
  assert.match(home, /testID="home-supervisor-primary-action"/);
  assert.equal((home.match(/testID="home-supervisor-primary-action"/g) ?? []).length, 1);
  assert.doesNotMatch(home, /testID="home-next-action"/);
  assert.doesNotMatch(home, /testID="home-next-action-button"/);
  assert.match(home, /설정에서 연결/);
  assert.match(home, /PAPER 연결/);
  assert.match(home, /switch \(decisionSurface\.primaryAction\)/);
  assert.match(home, /case "SETTINGS"[\s\S]*onGoSettings\(\)/);
  assert.match(home, /case "PORTFOLIO"[\s\S]*onNavigate\("Portfolio"\)/);
  assert.match(home, /case "AI_SIGNAL"[\s\S]*onNavigate\("AiSignal"\)/);
  assert.match(home, /case "MARKETS"[\s\S]*onNavigate\("Markets"\)/);
  assert.match(home, /const disconnected = notConfigured != null/);
  assert.match(decisionSurface, /"CONNECT PAPER"/);
  assert.match(decisionSurface, /"RECOVER"/);
  assert.match(decisionSurface, /"SUPERVISE PAPER"/);
  assert.match(decisionSurface, /"OPEN SIGNAL"/);
  assert.match(decisionSurface, /"OPEN MARKET"/);
  assert.match(decisionSurface, /const primaryAction: HomeDecisionPrimaryAction/);
});

test("AI separates uncalibrated raw probability from trusted calibrated confidence", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
  assert.match(app, /<HomeView snapshot=\{snapshot\}/);
  for (const source of [ai]) {
    assert.match(source, /원시 모델 확률 \(미보정\)/);
    assert.match(source, /검증 신뢰도/);
    assert.match(source, /보정 상태/);
    assert.doesNotMatch(source, /<DataRow label="신뢰도"/);
    assert.doesNotMatch(source, /모델 점수 \(미보정\)/);
  }
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
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
