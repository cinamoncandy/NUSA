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

test("HomeView presents the approved truth-bound Runtime Canvas composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(home, /useWindowDimensions/);
  assert.match(home, /const tablet = width >= 768/);
  assert.match(home, /content: \{ width: "100%", maxWidth: 720/);
  assert.match(home, /contentTablet: \{ maxWidth: 1080 \}/);
  for (const id of ["home-screen", "home-master-rail", "home-status-rail", "home-now", "home-judgment-proof", "ai-card", "home-confidence-evidence-quality", "home-market-canvas-reveal", "home-paper-performance", "home-paper-learning"]) {
    assert.match(home, new RegExp(`testID="${id}"`));
  }
  assert.match(home, /PAPER CONTEXT · SECONDARY/);
  assert.match(home, /PAPER ONLY · LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /RISK VETO|SIGNAL FUNNEL|REJECTED SIGNALS|testID="home-risk-status"|testID="home-decision-stage"/);
  assert.doesNotMatch(home, /getHomeVisualProfile\(theme\.preset\)/);
  assert.doesNotMatch(home, />[^<]*(?:BULLISH|STRONG|WEAK)[^<]*<\/Text>/);
  assert.doesNotMatch(home, /testID="home-supervisor-summary"|<SupervisorProgressPanel/);
});

test("canonical HOME uses verified public observation and Cloud PAPER projection without fabricating feeds", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const app = read("apps/mobile/App.tsx");

  assert.match(home, /publicMarkets: readonly WatchlistMarket\[\] \| null/);
  assert.match(home, /const observedMarketCount = publicMarkets\?\.length \?\? 0/);
  assert.match(home, /const publicState = publicMarketStale \? "STALE"/);
  assert.match(home, /const account = snapshot\?\.portfolio\?\.account \?\? null/);
  assert.match(home, /CLOUD PAPER CAPITAL/);
  assert.doesNotMatch(home, /buildLocalPortfolio|useLocalPaperSnapshot|selectHomeMarketData\(/);
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

test("HOME rendered financial values share one explicit formatting grammar", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /function money\(value: number \| null \| undefined\): string/);
  assert.match(home, /function signedMoney\(value: number \| null \| undefined\): string/);
  assert.match(home, /label="PAPER EQUITY" value=\{money\(account\?\.equity\)\}/);
  assert.match(home, /label="TOTAL PNL" value=\{signedMoney\(totalPnl\)\}/);
  assert.match(home, /label="CASH" value=\{money\(account\?\.cash\)\}/);
  assert.match(home, /label="EXPOSURE" value=\{money\(exposure\)\}/);
});

test("fresh or stale installs converge on the canonical master preset", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /CURRENT_DEFAULT_PRESET:\s*DesignPresetName\s*=\s*"master"/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
});
