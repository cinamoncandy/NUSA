const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical autonomous intelligence hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, />NUSA<\/Text>/);
  assert.match(home, /AUTONOMOUS INVESTMENT INTELLIGENCE/);
  assert.match(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
  assert.match(home, />NOW<\/Text>/);
  assert.match(home, /testID="home-supervisor-now"/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /function TruthCell/);
});

test("HOME autonomous intelligence uses verified runtime data and preserves authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /buildHomeDecisionSurface\(\{/);
  assert.match(home, /paperEquity: account\?\.equity/);
  assert.match(home, /paperTotalPnl: totalPnl/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /const terminalSignal = theme\.colors\.success/);
  assert.match(home, /const counterSignal = theme\.colors\.danger/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
});

test("HOME autonomous intelligence keeps real navigation and learning actions", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /case "MARKETS": return onNavigate\("Markets"\)/);
  assert.match(home, /case "AI_SIGNAL": return onNavigate\("AiSignal"\)/);
  assert.match(home, /case "PORTFOLIO": return onNavigate\("Portfolio"\)/);
  assert.match(home, /case "SETTINGS": return onGoSettings\(\)/);
  assert.match(home, /onOpenPaperLearning/);
});
