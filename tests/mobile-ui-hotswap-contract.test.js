const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("classic and master presets are materially distinct visual systems", () => {
  const profile = read("apps/mobile/src/homeVisualProfile.ts");
  assert.match(profile, /classic:[\s\S]*?horizontalPadding:\s*20/);
  assert.match(profile, /master:[\s\S]*?horizontalPadding:\s*14/);
  assert.match(profile, /classic:[\s\S]*?minHeight:\s*300/);
  assert.match(profile, /master:[\s\S]*?minHeight:\s*228/);
  assert.match(profile, /classic:[\s\S]*?radius:\s*22/);
  assert.match(profile, /master:[\s\S]*?radius:\s*6/);
  assert.match(profile, /classic:[\s\S]*?balanceSize:\s*52/);
  assert.match(profile, /master:[\s\S]*?balanceSize:\s*44/);
  assert.match(profile, /classic:[\s\S]*?contentGap:\s*22/);
  assert.match(profile, /master:[\s\S]*?contentGap:\s*12/);
  assert.match(profile, /classic:[\s\S]*?metricGap:\s*10/);
  assert.match(profile, /master:[\s\S]*?metricGap:\s*6/);
});

test("HomeView consumes the MASTER profile and presents the dense truthful terminal composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /getHomeVisualProfile\(theme\.preset\)/);
  assert.match(home, /paddingHorizontal:\s*profile\.screen\.horizontalPadding/);
  assert.match(home, /paddingTop:\s*profile\.screen\.topPadding/);
  assert.match(home, /gap:\s*tablet \? 18 : 12/);
  assert.match(home, /paddingBottom:\s*profile\.screen\.bottomPadding/);
  assert.match(home, /maxWidth:\s*tablet \? Math\.max\(profile\.screen\.maxWidth, 980\) : profile\.screen\.maxWidth/);
  assert.match(home, /testID="home-screen"/);
  assert.match(home, /testID="home-supervisor-summary"/);
  assert.match(home, /testID="home-terminal-grid"/);
  assert.match(home, /testID="home-market-pulse"/);
  assert.match(home, /testID="home-market-structure"/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-context-panel"/);
  assert.match(home, /testID="home-portfolio-matrix"/);
  assert.match(home, /testID="home-risk-authority"/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /<InsightPanel/);
  assert.match(home, /<CompactMetric/);
  assert.match(home, /<OperationalNotice/);
  assert.match(home, /testID="home-supervisor-result"[\s\S]*onNavigate\("Portfolio"\)[\s\S]*SUPERVISE →/);
  assert.match(home, /testID="home-supervisor-learning"[\s\S]*onOpenPaperLearning[\s\S]*EVIDENCE →/);
  assert.match(home, /AI ZERO AUTHORITY · productionMutationAllowed=false · liveAuthority=NONE/);
  assert.match(home, /AI INSIGHT \/ SIGNAL TERRAIN/);
  assert.match(home, /<TerrainSignal variant="symbolic"[\s\S]*testID="home-signal-trace" \/>/);
  assert.match(home, /RISK[\s\S]*NEUTRAL[\s\S]*OPPORTUNITY/);
});

test("HOME terminal uses canonical data and declares unavailable feeds instead of fabricating them", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const app = read("apps/mobile/App.tsx");
  assert.match(home, /const publicMarkets = snapshot\?\.markets \?\? \[\]/);
  assert.match(home, /market\.source|UPBIT PUBLIC/);
  assert.match(home, /NO VERIFIED MARKET SNAPSHOT/);
  assert.match(home, /ORDER FLOW: UNAVAILABLE/);
  assert.match(home, /NO VERIFIED FEED/);
  assert.match(home, /LOCAL PAPER · 실제 계좌\/Cloud PAPER와 합산하지 않음/);
  assert.match(home, /CLOUD PAPER · REAL account not blended/);

  assert.match(app, /publicMarket=\{CHART_MARKET\}/);
  assert.match(app, /publicCandles=\{publicMarkets\.candles\}/);
  assert.match(app, /publicCurrentPrice=\{publicMarkets\.currentPrice\}/);
  assert.match(app, /publicMarketConnectionState=\{publicMarketConnectionState\}/);
  assert.match(app, /publicMarketStale=\{publicMarkets\.status !== "READY"\}/);

  assert.match(home, /import \{ buildChartViewModel, type PublicCandle \} from "\.\/chartViewModel"/);
  assert.match(home, /buildChartViewModel\(\{[\s\S]*market:\s*publicMarket,[\s\S]*interval:\s*"1m"[\s\S]*rawCandles:\s*publicCandles === null \? null : \[\.\.\.publicCandles\][\s\S]*currentPrice:\s*publicCurrentPrice[\s\S]*connectionState:\s*publicMarketConnectionState[\s\S]*stale:\s*publicMarketStale/);
  assert.match(home, /marketWave\.state === "READY" \? marketWave\.bars\.slice\(-20\) : \[\]/);
  assert.match(home, /marketWave\.state === "READY"[\s\S]*testID="home-market-wave-ready"/);
  assert.match(home, /MARKET WAVE: UNAVAILABLE · \{marketWave\.error \?\? marketWave\.state\}/);
  assert.match(home, /bar\.wickTop/);
  assert.match(home, /bar\.wickHeight/);
  assert.match(home, /bar\.bodyTop/);
  assert.match(home, /bar\.bodyHeight/);
  assert.match(home, /bar\.up \? terminalSignal : theme\.colors\.danger/);

  assert.doesNotMatch(home, /BTC[^\n]*(65000000|70000000|100000000)/);
  assert.doesNotMatch(home, /Math\.random\(|synthetic|mock candle|fake candle/i);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});

test("HOME rendered financial values keep stable tabular numerals", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /marketPrice:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /marketChange:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /metricNumber:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /cashValue:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /marketWavePrice:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
  assert.match(home, /dataValue:[^\n]*fontVariant:\s*\["tabular-nums"\]/);
});

test("fresh or stale installs converge on the canonical master preset", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /CURRENT_DEFAULT_PRESET:\s*DesignPresetName\s*=\s*"master"/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
});