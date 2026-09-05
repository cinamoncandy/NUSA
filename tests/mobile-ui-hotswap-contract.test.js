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

test("HomeView presents the approved autonomous-intelligence composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /useWindowDimensions/);
  assert.match(home, /const tablet = width >= 768/);
  assert.match(home, /maxWidth: tablet \? 980 : 620/);
  assert.match(home, /testID="home-screen"/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /testID="home-terminal-grid"/);
  assert.match(home, /testID="home-reference-navigation"/);
  assert.match(home, />총 자산<\/Text>/);
  assert.match(home, />AUTONOMOUS<\/Text>/);
  assert.match(home, />INVESTMENT<\/Text>/);
  assert.match(home, />INTELLIGENCE<\/Text>/);
  assert.match(home, /AI INSIGHT/);
  assert.match(home, /SIGNAL TERRAIN/);
  assert.match(home, /MARKET PULSE/);
  assert.match(home, /PAPER PERFORMANCE/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);

  assert.doesNotMatch(home, /getHomeVisualProfile\(theme\.preset\)/);
  assert.doesNotMatch(home, />[^<]*(?:BULLISH|STRONG|WEAK)[^<]*<\/Text>/);
  assert.doesNotMatch(home, /testID="home-supervisor-summary"/);
  assert.doesNotMatch(home, /<SupervisorProgressPanel/);
});

test("canonical HOME uses verified market and PAPER data without fabricating unavailable feeds", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const app = read("apps/mobile/App.tsx");

  assert.match(home, /const marketFeed = selectHomeMarketData\(publicMarkets, snapshot\?\.markets \?\? \[\]\)/);
  assert.match(home, /publicMarkets: readonly WatchlistMarket\[\] \| null/);
  assert.match(home, /const marketRows = \[\.\.\.marketFeed\][^\n]*\.slice\(0, tablet \? 5 : 3\)/);
  assert.match(home, /krw\(market\.price\)/);
  assert.match(home, /signedPercent\(market\.changeRate\)/);
  assert.match(home, /snapshot\?\.portfolio\?\.account \?\? localPortfolio\?\.account \?\? null/);
  assert.match(home, /buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\)/);
  assert.match(home, /testID="home-operational-notice"/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.doesNotMatch(home, /<OperationalNotice/);

  assert.match(app, /publicMarket=\{CHART_MARKET\}/);
  assert.match(app, /publicMarkets=\{publicMarkets\.markets\}/);
  assert.match(app, /publicCandles=\{publicMarkets\.candles\}/);
  assert.match(app, /publicCurrentPrice=\{publicMarkets\.currentPrice\}/);
  assert.match(app, /publicMarketConnectionState=\{publicMarketConnectionState\}/);
  assert.match(app, /publicMarketStale=\{publicMarkets\.status !== "READY"\}/);

  assert.doesNotMatch(home, /BTC[^\n]*(65000000|70000000|100000000)/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|mock candle|fake candle/i);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});

test("HOME rendered financial values keep stable tabular numerals", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /assetValue:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /dayValue:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /marketPrice:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /marketMove:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /bigMetric:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
});

test("fresh or stale installs converge on the canonical master preset", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /CURRENT_DEFAULT_PRESET:\s*DesignPresetName\s*=\s*"master"/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
});
