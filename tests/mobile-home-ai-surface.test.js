const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical autonomous-intelligence hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, />NUSA<\/Text>/);
  assert.match(home, />AUTONOMOUS<\/Text>/);
  assert.match(home, />INVESTMENT<\/Text>/);
  assert.match(home, />INTELLIGENCE<\/Text>/);
  assert.match(home, />총 자산<\/Text>/);
  assert.match(home, /AI INSIGHT/);
  assert.match(home, /label="NOW"/);
  assert.match(home, /label="WHY"/);
  assert.match(home, /label="RESULT"/);
  assert.match(home, /label="RISK"/);
  assert.match(home, /label="LEARNING"/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /SIGNAL TERRAIN/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /testID="home-terminal-grid"/);
  assert.match(home, /testID="home-reference-navigation"/);
});

test("HOME autonomous-intelligence design uses verified runtime data and preserves authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /const terminal = theme\.colors\.success/);
  assert.match(home, /const danger = theme\.colors\.danger/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
});

test("HOME autonomous-intelligence design keeps real navigation actions", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(home, /onNavigate\("AiSignal"\)/);
  assert.match(home, /onNavigate\("Portfolio"\)/);
  assert.match(home, /onOpenPaperLearning/);
  assert.match(home, />홈<\/Text>/);
  assert.match(home, />관찰<\/Text>/);
  assert.match(home, />시그널<\/Text>/);
  assert.match(home, />페이퍼<\/Text>/);
  assert.match(home, />포트폴리오<\/Text>/);
  assert.match(home, />더보기<\/Text>/);
});
