const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical NUSA master design board hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, />NUSA<\/Text>/);
  assert.match(home, />총 자산<\/Text>/);
  assert.match(home, /\{rail\.pnlBasisLabel\}/);
  assert.doesNotMatch(home, />오늘</);
  assert.match(home, />NUSA AI 판단<\/Text>/);
  assert.match(home, /"NEUTRAL"/);
  assert.match(home, />신뢰도<\/Text>/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, />주요 지표<\/Text>/);
  assert.match(home, />홈<\/Text>/);
  assert.match(home, />마켓<\/Text>/);
  assert.match(home, />시그널<\/Text>/);
  assert.match(home, />페이퍼<\/Text>/);
  assert.match(home, />포트폴리오<\/Text>/);
  assert.doesNotMatch(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
  assert.doesNotMatch(home, /function TruthCell/);
});

test("HOME master design uses verified runtime data and preserves authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /const positive = theme\.colors\.success/);
  assert.match(home, /const negative = theme\.colors\.danger/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
});

test("HOME master design keeps real navigation actions", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(home, /onNavigate\("AiSignal"\)/);
  assert.match(home, /onNavigate\("Portfolio"\)/);
  assert.match(home, /onOpenPaperLearning/);
  assert.match(home, /testID="home-reference-navigation"/);
});
