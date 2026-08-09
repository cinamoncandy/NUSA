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
  assert.match(source, /주문·이체·LIVE 실행 권한은 없습니다/);
  assert.doesNotMatch(source, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
});

test("Markets keeps chart interaction hidden when App has no candle data", () => {
  const source = read("src/marketsView.tsx");
  const app = read("App.tsx");
  assert.match(source, /const chartAvailable = Array\.isArray\(rawCandles\) && rawCandles\.length > 0/);
  assert.match(source, /const visiblePanel = chartAvailable \? panel : "WATCHLIST"/);
  assert.match(source, /\{chartAvailable \? <View/);
  assert.match(source, /visiblePanel === "WATCHLIST"/);
  assert.match(app, /rawCandles=\{null\}/);
});

test("read-only PAPER path has explicit zero mutation state and no fake controls", () => {
  const source = read("src/tradingView.tsx");
  assert.match(source, /const readOnly = onSubmit === undefined/);
  assert.match(source, /PAPER 관찰 모드/);
  assert.match(source, /ZERO MUTATION/);
  assert.match(source, /매수·매도 요청을 만들거나 서버로 전송할 수 없습니다/);
  assert.match(source, /주문 생성/);
  assert.match(source, /현재 권한/);
  assert.doesNotMatch(source, /매수 미리보기|매도 미리보기|읽기 전용 — 주문 권한 없음/);
});

test("market discovery uses compact accessible favorite and sort controls", () => {
  const source = read("src/watchlistView.tsx");
  assert.match(source, /accessibilityLabel=\{`\$\{market\.market\}/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /favorite: \{ minWidth: 52, height: 44/);
  assert.match(source, /sortChip: \{ minHeight: 44/);
  assert.match(source, /StatusChip label="READ ONLY"/);
  assert.doesNotMatch(source, /PUBLIC · READ ONLY/);
  assert.match(source, /active \? "관심중" : "관심"/);
  assert.doesNotMatch(source, /★|☆/);
});
