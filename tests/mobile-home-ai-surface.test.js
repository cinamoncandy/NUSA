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
  assert.match(home, /TOTAL P&L/);
  assert.match(home, /EQUITY/);
  // The approved layout dropped the "PAPER MODE" and "SIGNAL TERRAIN" headings. What must survive is
  // that HOME still *visibly* declares the PAPER boundary, so assert the declaration and the style it
  // renders under. homeView also carries `hiddenDecisionEvidence`
  // (position:"absolute",width:1,height:1,opacity:0); a safety declaration moved into a style like
  // that would still match a plain text assertion while being invisible to the owner.
  const safetyLine = /<View style=\{styles\.(\w+)\} testID="home-risk-authority"><Text style=\{styles\.safety\}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY<\/Text><\/View>/.exec(home);
  assert.ok(safetyLine, "HOME must render the PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY declaration");
  const safetyStyle = new RegExp(safetyLine[1] + ":\\s*\\{([^}]*)\\}").exec(home);
  assert.ok(safetyStyle, "the PAPER declaration must use a declared style");
  assert.doesNotMatch(safetyStyle[1], /opacity:\s*0\b/, "the PAPER declaration must not be rendered invisible");
  assert.doesNotMatch(safetyStyle[1], /(width|height):\s*[01]\b/, "the PAPER declaration must not be collapsed to a 1px node");
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="home-risk-authority"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-paper-learning"/);
});

test("HOME autonomous-intelligence design uses verified runtime data and preserves authority safety", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(props\.publicMarkets, props\.snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /buildHomeDecisionSurface/);
  assert.match(home, /accountSource/);
  assert.match(home, /marketRows/);
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
  assert.match(home, /onPress=\{props\.onGoSettings\}/);
  assert.match(home, /testID="home-operational-notice"/);
});
