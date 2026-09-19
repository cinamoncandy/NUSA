const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical truth-bound Runtime Canvas hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /AI TRADING INTELLIGENCE/);
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /testID="home-intelligence-reveal"/);
  assert.match(home, />판단 상태 · \{stateLabel\}<\/Text>/);
  assert.match(home, />근거<\/Text>/);
  assert.match(home, />불확실성 \/ 검증<\/Text>/);
  assert.match(home, /testID="home-market-canvas-reveal"/);
  assert.match(home, /OBSERVATION CONTEXT/);
  assert.match(home, /testID="home-capital-reveal"/);
  assert.match(home, /PAPER CONTEXT · SECONDARY/);
  assert.match(home, /testID="home-paper-learning"/);
});

test("HOME Runtime Canvas uses delivered runtime and AI projection data while preserving authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(home, /const runtime = snapshot\?\.operations \?\? null/);
  assert.match(home, /runtime\?\.runtimeState === "RUNNING" && runtime\.transport === "ONLINE"/);
  assert.match(home, /runtime\?\.pipelineStage \|\| "UNAVAILABLE"/);
  assert.match(home, /const publicState = publicMarketStale \? "STALE"/);
  assert.match(home, /ai\.evidenceReferences\.slice\(0, 2\)/);
  assert.match(home, /ai\.counterEvidence\.slice\(0, 2\)/);
  assert.match(home, /const calibrated = aiAvailable && ai\.calibrationStatus === "CALIBRATED"/);
  assert.match(home, /calibrated \? probability\(ai\.confidence\) : "표시 안 함"/);
  assert.match(home, /LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
  assert.match(home, /PAPER ONLY/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
  assert.doesNotMatch(home, /BULLISH|BEARISH|STRONG SIGNAL|WEAK SIGNAL/);
  assert.doesNotMatch(home, /IntelligenceMotionField/);
});

test("HOME Runtime Canvas keeps real navigation actions", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(home, /onNavigate\("AiSignal"\)/);
  assert.match(home, /onNavigate\("Portfolio"\)/);
  assert.match(home, /onOpenPaperLearning/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.match(home, /testID="home-operational-notice"/);
});
