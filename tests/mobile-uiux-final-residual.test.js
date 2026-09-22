const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home preserves the canonical Intelligence OS safety-first actions without restoring the legacy supervisor CTA", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");

  assert.match(home, /testID="home-screen"/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /testID="home-market-status"/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="home-ai-judgement"/);
  // The approved layout has no evidence rows on HOME; the decision surface still gates signal
  // availability, and the evidence itself is on AI SIGNAL.
  assert.match(home, /const signalAvailable = decision\.aiInsightAvailable/);
  assert.match(home, /testID="home-risk-authority"/);
  assert.match(home, /testID="home-ai-judgement"/);
  assert.match(home, /testID="home-paper-status"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);

  assert.doesNotMatch(home, /testID="home-supervisor-primary-action"/);
  assert.doesNotMatch(home, /testID="home-next-action"/);
  assert.doesNotMatch(home, /testID="home-next-action-button"/);

  assert.match(home, /testID="home-operational-notice"/);
  assert.match(home, /onPress=\{props\.onGoSettings\}/);
  assert.doesNotMatch(home, /onAction=\{(?:props\.)?onGoSettings\}/);
  assert.doesNotMatch(home, /<OperationalNotice/);
  // Strategies is a primary tab on the board, reachable from the navigation bar, so HOME does not
  // carry a card for it. Every control HOME does render must still lead somewhere real.

  assert.match(home, /onNavigate\("Signals"\)/);
  assert.match(home, /onNavigate\("Market"\)/);
  assert.match(home, /onOpenPaperLearning/);

  // Keep the canonical fail-closed decision model available for runtime truth and downstream users,
  // but the approved HOME presentation must not reconstruct the retired supervisor deck.
  assert.match(decisionSurface, /"CONNECT PAPER"/);
  assert.match(decisionSurface, /"RECOVER"/);
  assert.match(decisionSurface, /"SUPERVISE PAPER"/);
  assert.match(decisionSurface, /"OPEN SIGNAL"/);
  assert.match(decisionSurface, /"OPEN MARKET"/);
  assert.match(decisionSurface, /const primaryAction: HomeDecisionPrimaryAction/);
});

test("AI exposes confidence only through the calibrated truth contract", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /<AiView ai=\{ai\} error=\{readOnlyError\}/);
  assert.match(app, /<HomeView snapshot=\{snapshot\}/);
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(ai, /calibrationStatus\s*===\s*"CALIBRATED"/);
  assert.match(ai, /const trusted=calibrated\?percent\(ai\?\.confidence\):"UNVERIFIED"/);
  // The wording moved; the fail-closed gate is what matters. An uncalibrated model never reports a
  // confidence number, and the RESULT row says so in words.
  assert.match(ai, /const calibrated=ai\?\.calibrationStatus==="CALIBRATED"/);
  assert.match(ai, /const trusted=calibrated\?percent\(ai\?\.confidence\):"UNVERIFIED"/);
  assert.match(ai, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
  assert.match(ai, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
  assert.doesNotMatch(ai, /<DataRow label="신뢰도"/);
  assert.doesNotMatch(ai, /모델 점수 \(미보정\)/);
});

test("Residual polish preserves read-only and zero-authority product boundaries", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  // TradingView is imported as PaperOrderView and renders on the Order tab. The contract that
  // matters is unchanged: App passes it a snapshot and never an onSubmit handler.
  assert.match(app, /<PortfolioView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<PaperOrderView[^>]*onSubmit=/s);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});
