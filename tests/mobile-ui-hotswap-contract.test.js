const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("classic and master presets remain materially distinct visual systems", () => {
  const profile = read("apps/mobile/src/homeVisualProfile.ts");
  assert.match(profile, /classic:[\s\S]*?horizontalPadding:\s*20/);
  assert.match(profile, /master:[\s\S]*?horizontalPadding:\s*14/);
  assert.match(profile, /classic:[\s\S]*?minHeight:\s*300/);
  assert.match(profile, /master:[\s\S]*?minHeight:\s*228/);
  assert.match(profile, /classic:[\s\S]*?radius:\s*22/);
  assert.match(profile, /master:[\s\S]*?radius:\s*6/);
  assert.match(profile, /classic:[\s\S]*?balanceSize:\s*52/);
  assert.match(profile, /master:[\s\S]*?balanceSize:\s*44/);
});

test("HomeView presents the approved dark wealth product composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const tablet = width >= 768/);
  assert.match(home, /maxWidth: tablet \? 980 : 720/);
  for (const marker of ['testID="home-screen"','testID="home-master-rail"','testID="home-status-rail"','testID="ai-card"','testID="home-decision-stage"','testID="home-market-pulse"','testID="home-paper-performance"','testID="home-paper-learning"','testID="home-risk-authority"']) assert.match(home, new RegExp(marker));
  assert.match(home, /SIGNAL TERRAIN/);
  assert.match(home, /MARKET PULSE/);
  assert.match(home, /PAPER PERFORMANCE/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, />[^<]*(?:BULLISH|STRONG|WEAK)[^<]*<\/Text>/);
});

test("HOME MASTER uses verified market and PAPER data without fabricating unavailable feeds", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const app = read("apps/mobile/App.tsx");
  assert.match(home, /const marketFeed = selectHomeMarketData\(props\.publicMarkets, props\.snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /const cloudAccount = props\.snapshot\?\.portfolio\?\.account \?\? null/);
  assert.match(home, /const localAccount = localPortfolio\?\.account \?\? null/);
  assert.match(home, /const account = cloudAccount \?\? localAccount/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /testID="home-operational-notice"/);
  assert.match(home, /onPress=\{props\.onGoSettings\}/);
  assert.match(app, /publicMarket=\{CHART_MARKET\}/);
  assert.match(app, /publicMarkets=\{publicMarkets\.markets\}/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|mock candle|fake candle/i);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});

test("HOME MASTER rendered financial values keep stable tabular numerals", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  for (const style of ["marketPrice","rowChange","metricValue"]) assert.match(home, new RegExp(`${style}: \\{[^}]*fontVariant: \\["tabular-nums"\\]`));
  assert.match(home, /won\(account\?\.equity\)/);
});

test("fresh or stale installs converge on the canonical master preset", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /CURRENT_DEFAULT_PRESET:\s*DesignPresetName\s*=\s*"master"/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
});
