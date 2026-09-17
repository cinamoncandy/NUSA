const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical autonomous-intelligence hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const os = read("apps/mobile/src/intelligenceOs.tsx");

  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(os, />NUSA<\/Text>/);
  assert.match(home, /PAPER PERFORMANCE/);
  assert.match(home, /P&L/);
  assert.match(home, />NOW<\/Text>/);
  assert.match(home, /WHY/);
  assert.match(home, /RESULT/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="home-risk-authority"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-paper-learning"/);
});

test("HOME autonomous-intelligence design uses verified runtime data and preserves authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /buildHomeDecisionSurface/);
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /market\.observedAt/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /UPBIT PUBLIC/);
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
  assert.match(home, /onAction=\{onGoSettings\}/);
  assert.match(home, /testID="home-operational-notice"/);
});
