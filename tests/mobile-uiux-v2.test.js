const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product navigation promotes PAPER and AI without changing foundation tab keys", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\] as const/);
  assert.match(app, /Trade: "PAPER"/);
  assert.match(app, /More: "AI"/);
  assert.match(app, /activeTab === "More" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /header-order-history/);
  assert.match(app, /header-notifications/);
  assert.match(app, /header-settings/);
  assert.match(app, /setUtilityView\(null\); setActiveTab\(tab\)/);
});

test("AI destination is evidence-backed and explicitly zero authority", () => {
  const source = read("src/aiView.tsx");
  assert.match(source, /ZERO AUTHORITY/);
  assert.match(source, /READ ONLY/);
  assert.match(source, /ai\.evidenceReferences/);
  assert.match(source, /ai\.counterEvidence/);
  assert.match(source, /ai\.disagreements/);
  assert.match(source, /liveAuthority/);
  assert.match(source, /productionMutationAllowed/);
  assert.match(source, /AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다/);
  assert.doesNotMatch(source, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
});

test("Markets keeps chart interaction hidden when App has no candle data", () => {
  const source = read("src/marketsView.tsx");
  const app = read("App.tsx");
  assert.match(source, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(source, /const visiblePanel(?::\s*Panel)? = chartAvailable \? panel : "WATCHLIST"/);
  assert.match(source, /!tabletWorkspace && chartAvailable \? <View/);
  assert.match(source, /visiblePanel === "WATCHLIST"/);
  assert.match(app, /rawCandles=\{publicMarkets\.candles === null \? null : \[\.\.\.publicMarkets\.candles\]\}/);
});

test("PAPER submit remains unavailable until a scoped mobile session exists", () => {
  const source = read("src/tradingView.tsx");
  assert.match(source, /const configuredEndpoint = getConfiguredPaperEndpoint\(\)/);
  assert.match(source, /const builtInSubmitAvailable = false/);
  assert.match(source, /const submitAvailable = runtimeCanSubmit && \(onSubmit !== undefined \|\| builtInSubmitAvailable\)/);
  assert.match(source, /testID="paper-runtime-blocked"/);
  assert.match(source, /liveMutationAllowed: false/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.match(source, /NUSA Cloud 세션을 사용할 수 없습니다/);
  assert.match(source, /statusLabel="LIVE NONE"/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
});

test("market discovery uses compact accessible favorite and sort controls", () => {
  const source = read("src/watchlistView.tsx");
  assert.match(source, /accessibilityLabel=\{`\$\{market\.market\}/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /favorite: \{ minWidth: 52, minHeight: 48/);
  assert.match(source, /sortChip: \{ minHeight: 44/);
  assert.match(source, /StatusChip label="READ ONLY"/);
  assert.doesNotMatch(source, /PUBLIC · READ ONLY/);
  assert.match(source, /active \? "관심중" : "관심"/);
  assert.doesNotMatch(source, /★|☆/);
});
