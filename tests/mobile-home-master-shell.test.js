const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME uses one canonical Intelligence OS authority rail instead of the legacy global shell header", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const os = read("apps/mobile/src/intelligenceOs.tsx");

  assert.match(app, /const homeShellActive = utilityView === null && activeTab === "Home"/);
  assert.match(app, /\{!homeShellActive \? <View style=\{\[styles\.header/);
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /PAPER ONLY/);
  assert.match(home, /LIVE NONE/);
  assert.match(home, /AI ZERO/);
  assert.match(os, />NUSA<\/Text>/);
  assert.match(os, />PAPER ONLY<\/Text>/);
});

test("HOME terminal fold prioritizes dense truthful evidence without synthetic feeds", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const chart = read("apps/mobile/src/chartView.tsx");
  const visual = read("apps/mobile/src/homeTerminalVisual.ts");
  const designSystem = read("apps/mobile/src/designSystem.ts");

  assert.match(home, /testID="home-terminal-grid"/);
  assert.match(home, /MARKET PULSE/);
  assert.match(home, /PAPER EQUITY/);
  assert.match(home, /TOTAL PNL/);
  assert.match(home, /RISK \/ AUTHORITY/);
  assert.match(home, /MARKET WAVE/);
  assert.match(home, /WATCHLIST \/ SNAPSHOT/);
  assert.match(home, /testID="home-market-snapshot"/);
  assert.match(home, /selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /<CandlePlot model=\{marketChart\} compact \/>/);
  assert.match(home, /createHomeTerminalVisualProfile\(theme\)/);
  assert.match(chart, /compact = false/);
  assert.match(chart, /plotCompact/);
  assert.match(chart, /const terminal = compact \? createHomeTerminalVisualProfile\(theme\) : null/);
  assert.match(visual, /homeTerminalColors/);
  assert.doesNotMatch(visual, /#[0-9A-Fa-f]{6}/);
  assert.match(designSystem, /canvas: "rgb\\(3, 5, 3\\)"/);
  assert.match(designSystem, /signal: "rgb\\(200, 255, 70\\)"/);
  assert.match(home, /ORDER FLOW/);
  assert.match(home, /NO VERIFIED ORDERBOOK FEED/);
  assert.match(home, /NEWS \/ ECON/);
  assert.match(home, /NO VERIFIED FEED/);
  assert.match(home, /const pnlSourceLabel = totalPnl != null && Number\.isFinite\(totalPnl\) && accountSource/);
  assert.match(home, />\{pnlSourceLabel\}<\/Text>/);
  assert.doesNotMatch(home, />VERIFIED PAPER ONLY<\/Text>/);
  assert.doesNotMatch(home, /fake|fabricated|synthetic/i);
});

test("bottom navigation is restrained and does not restore the legacy neon pill shell", () => {
  const app = read("apps/mobile/App.tsx");

  assert.doesNotMatch(app, /backgroundColor: active \? appTheme\.colors\.neonGlow/);
  assert.doesNotMatch(app, /borderColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /shadowColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /color: active \? appTheme\.colors\.neonTeal/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.primarySoft : "transparent"/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.aiSignalEnd : appTheme\.colors\.border/);
  assert.match(app, /navigationFrame/);
  assert.match(app, /color: active \? appTheme\.colors\.text : appTheme\.colors\.textMuted/);
});
