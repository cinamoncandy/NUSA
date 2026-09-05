const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical autonomous-intelligence hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const os = read("apps/mobile/src/intelligenceOs.tsx");

  assert.match(home, /AuthorityRail/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(os, />NUSA<\/Text>/);
  assert.match(home, /AUTONOMOUS INVESTMENT INTELLIGENCE/);
  assert.match(home, /eyebrow="NOW"/);
  assert.match(home, /kicker="WHY · AI INSIGHT"/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /kicker="RISK STATUS"/);
  assert.match(home, /kicker="SIGNAL TERRAIN"/);
  assert.match(home, /kicker="PAPER PERFORMANCE"/);
  assert.match(home, /kicker="LEARNING"/);
});

test("HOME autonomous-intelligence design uses verified runtime data and preserves authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /buildHomeDecisionSurface/);
  assert.match(home, /buildHomeStatusRail/);
  assert.match(home, /freshestObservedAtMs\(marketRows\)/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /PUBLIC READ ONLY · 시장 관찰은 전략 신호나 주문 권한으로 자동 승격되지 않습니다/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
  assert.doesNotMatch(home, /BULLISH|BEARISH|STRONG SIGNAL|WEAK SIGNAL/);
});

test("HOME autonomous-intelligence design keeps real navigation actions", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(home, /onNavigate\("AiSignal"\)/);
  assert.match(home, /onNavigate\("Portfolio"\)/);
  assert.match(home, /onOpenPaperLearning/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.match(home, /testID="home-operational-notice"/);
});
