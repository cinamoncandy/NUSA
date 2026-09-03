const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME is visibly AI-first instead of the prior stacked supervisor screen", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /AUTONOMOUS INVESTMENT INTELLIGENCE/);
  assert.match(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
  assert.match(home, />NOW<\/Text>/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /terminalSignal = theme\.mode === "dark" \? "#C8FF48"/);
  assert.match(home, /counterSignal = theme\.mode === "dark" \? "#FF4B9B"/);
  assert.match(home, /function TruthCell/);
  assert.match(home, /label="WHY"/);
  assert.match(home, /label="RESULT"/);
  assert.match(home, /label="RISK"/);
  assert.match(home, /label="LEARNING"/);
  assert.doesNotMatch(home, /SUPERVISOR \/ EVIDENCE FIRST/);
});

test("HOME AI-first redesign remains evidence-first and authority-safe", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /buildChartViewModel\(\{/);
  assert.match(home, /ORDER FLOW: UNAVAILABLE/);
  assert.match(home, /NO VERIFIED FEED/);
  assert.match(home, /LOCAL PAPER · 실제 계좌\/Cloud PAPER와 합산하지 않음/);
  assert.match(home, /CLOUD PAPER · REAL account not blended/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /AI ZERO AUTHORITY · productionMutationAllowed=false · liveAuthority=NONE/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|fake candle|mock candle/i);
});

test("HOME keeps real actions and a 48dp primary decision target", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /testID="home-supervisor-primary-action"/);
  assert.match(home, /case "SETTINGS": return onGoSettings\(\)/);
  assert.match(home, /case "PORTFOLIO": return onNavigate\("Portfolio"\)/);
  assert.match(home, /case "AI_SIGNAL": return onNavigate\("AiSignal"\)/);
  assert.match(home, /case "MARKETS": return onNavigate\("Markets"\)/);
  assert.match(home, /primaryButton:\s*\{[^}]*minHeight:\s*48/);
});
