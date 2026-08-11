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
  assert.match(app, /<HomeView/);
});

test("AI destination is evidence-backed and explicitly zero authority", () => {
  const source = read("src/aiView.tsx");
  assert.match(source, /StatusChip label="ZERO AUTHORITY"/);
  assert.match(source, /StatusChip label="READ ONLY"/);
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
  assert.match(source, /const visiblePanel = chartAvailable \? panel : "WATCHLIST"/);
  assert.match(source, /chartAvailable \? <ChartView/);
  assert.match(source, /!wide && chartAvailable \? <View style=\{styles\.panels\}/);
  assert.match(source, /wide \? <WatchlistView/);
  assert.match(source, /visiblePanel === "WATCHLIST" \? <WatchlistView/);
  assert.match(source, /markets-panel-segmented-control/);
  assert.match(source, /차트 데이터가 아직 없습니다/);
  assert.match(app, /rawCandles=\{null\}/);
});

test("Trading permits only verified PAPER mutation and never LIVE authority", () => {
  const source = read("src/tradingView.tsx");
  assert.match(source, /const builtInSubmitAvailable = Boolean\(configuredEndpoint && credentialSession\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(source, /const submitAvailable = onSubmit !== undefined \|\| builtInSubmitAvailable/);
  assert.match(source, /StatusChip label="PAPER ONLY"/);
  assert.match(source, /StatusChip label="LIVE 금지"/);
  assert.match(source, /PAPER 주문 연결 필요/);
  assert.match(source, /paper-side-segmented-control/);
  assert.match(source, /paper-type-segmented-control/);
  assert.match(source, /PAPER 주문 확인/);
  assert.match(source, /PAPER 주문 확정/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.match(source, /PersonalPaperOrderRetryIdentity/);
  assert.match(source, /submitPersonalPaperOrderWithRetryIdentity/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
});

test("market discovery uses 48px accessible favorite and segmented sort controls", () => {
  const source = read("src/watchlistView.tsx");
  assert.match(source, /accessibilityLabel=\{`\$\{market\.market\}/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /favorite: \{ minWidth: 52, minHeight: 48/);
  assert.match(source, /<SegmentedControl/);
  assert.match(source, /testID="watchlist-sort"/);
  assert.match(source, /StatusChip label="READ ONLY"/);
  assert.match(source, /active \? "관심중" : "관심"/);
  assert.doesNotMatch(source, /★|☆/);
});
