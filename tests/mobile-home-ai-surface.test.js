const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME matches the canonical white mint supervisory composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const provider = read("apps/mobile/src/ThemeProvider.tsx");

  assert.match(provider, /initialMode = "light"/);
  assert.match(home, /AI SUPERVISORY OS/);
  assert.match(home, /AI ZERO AUTHORITY/);
  assert.match(home, /PAPER ONLY · LIVE NONE/);
  assert.match(home, /YOU ARE SUPERVISOR/);
  assert.match(home, /All Stable\./);
  assert.match(home, /No Action Needed\./);
  assert.match(home, /MARKET OVERVIEW/);
  assert.match(home, /CAPITAL OVERVIEW/);
  assert.match(home, /NUSA JUDGMENT/);
  assert.match(home, /EVIDENCE STREAM/);
  assert.match(home, /OWNER COMMAND/);
  assert.match(home, />NOW<\/Text>/);
  assert.match(home, />MARKET<\/Text>/);
  assert.match(home, />NUSA<\/Text>/);
  assert.match(home, />ASSETS<\/Text>/);
  assert.match(home, />CONTROL<\/Text>/);
  assert.doesNotMatch(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
  assert.doesNotMatch(home, /function TruthCell/);
});

test("white mint HOME remains runtime truthful and authority safe", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /const mint = theme\.colors\.success/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
});

test("white mint HOME keeps real navigation and learning actions", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /onNavigate\("Markets"\)/);
  assert.match(home, /onNavigate\("AiSignal"\)/);
  assert.match(home, /onNavigate\("Portfolio"\)/);
  assert.match(home, /onOpenPaperLearning/);
  assert.match(home, /testID="home-supervisor-learning"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /testID="home-reference-navigation"/);
});
