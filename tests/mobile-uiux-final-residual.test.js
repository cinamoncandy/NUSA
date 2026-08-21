const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home exposes one real safety-first next action from verified runtime state", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /testID="home-next-action"/);
  assert.match(home, /testID="home-next-action-button"/);
  assert.match(home, /설정에서 연결/);
  assert.match(home, /분석 보기/);
  assert.match(home, /시장 보기/);

  // Cloud PAPER being unconfigured is no longer itself a blocker because Home falls back
  // to LOCAL PAPER. Actual read-only errors or missing public mark price still block.
  assert.match(home, /const usingLocalPaper = notConfigured !== null/);
  assert.match(home, /const blocked = Boolean\(readOnlyError \|\| !signalReady\)/);
  assert.doesNotMatch(home, /const blocked = Boolean\(notConfigured \|\| readOnlyError \|\| !signalReady\)/);
  assert.match(home, /signalReady = usingLocalPaper\s*\? localState\.markPrice != null\s*:\s*snapshot\?\.health === "HEALTHY" && snapshot\.readyForPaperOperations/s);

  // LOCAL PAPER stays on public market data and never routes the user to settings merely
  // because Cloud PAPER is absent. Cloud read-only errors keep their recovery path.
  assert.match(home, /if \(!usingLocalPaper && readOnlyError\) \{\s*onGoSettings\(\)/s);
  assert.match(home, /onNavigate\(aiInsightAvailable \? "AiSignal" : "Markets"\)/);
  assert.match(home, /aiInsightAvailable = !usingLocalPaper && ai\?\.status === "AVAILABLE" && Boolean\(ai\.thesis\?\.trim\(\)\) && ai\.evidenceReferences\.length > 0/);
  assert.match(home, /aiInsightAvailable\s*\? "분석 보기"/s);
  assert.match(home, /LOCAL PAPER/);
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
