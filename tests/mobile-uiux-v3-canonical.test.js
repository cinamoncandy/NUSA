const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("App shell routes the canonical four-tab decision flow and preserves deeper jobs", () => {
  const app = read("App.tsx");
  assert.match(app, /import \{ HomeView/);
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\]/);
  assert.match(app, /<HomeView/);
  assert.match(app, /activeTab === "Paper"/);
  assert.match(app, /<TradingView/);
  assert.match(app, /accessibilityRole="tablist"/);
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
});

test("Home uses MASTER hierarchy and keeps AI read-only", () => {
  const source = read("src/homeView.tsx");
  assert.match(source, />NUSA<\/Text>/);
  assert.match(source, /TOTAL EQUITY/);
  assert.match(source, />PAPER ONLY<\/Text>/);
  assert.match(source, /NUSA VIEW/);
  assert.match(source, /<InsightPanel/);
  assert.match(source, /READ ONLY/);
  assert.match(source, /testID="home-signal-trace"/);
  assert.match(source, /<CompactMetric label="PAPER 연결"/);
  assert.match(source, /<CompactMetric label="안전 게이트"/);
  assert.match(source, /<CompactMetric label="AI 분석"/);
  assert.match(source, /LIVE 권한/);
  assert.match(source, /Production mutation/);
  assert.doesNotMatch(source, /<ScreenHeader/);
  assert.doesNotMatch(source, /<MetricTile/);
});

test("Markets, PAPER, Settings and History use shared segmented controls", () => {
  const markets = read("src/marketsView.tsx");
  const trading = read("src/tradingView.tsx");
  const tradingLegacy = read("src/tradingViewLegacy.tsx");
  const settings = read("src/settingsView.tsx");
  const history = read("src/orderHistoryView.tsx");
  assert.match(markets, /markets-panel-segmented-control/);
  assert.match(trading, /LegacyTradingView/);
  assert.match(tradingLegacy, /paper-side-segmented-control/);
  assert.match(tradingLegacy, /paper-type-segmented-control/);
  assert.match(settings, /settings-theme-segmented-control/);
  assert.match(history, /order-history-filters/);
  assert.match(history, /order-history-periods/);
  assert.match(history, /order-history-sorts/);
});

test("Portfolio and AI use decision-first v3 information hierarchy", () => {
  const portfolio = read("src/portfolioView.tsx");
  const ai = read("src/aiView.tsx");
  assert.match(portfolio, /<ScreenHeader/);
  assert.match(portfolio, /testID="portfolio-supervisor-summary"/);
  assert.match(portfolio, /<DataRow label="PAPER 평가자산"/);
  assert.match(portfolio, /testID="portfolio-upbit-read-only"/);
  assert.match(portfolio, /testID="portfolio-allocation-rail"/);
  assert.doesNotMatch(portfolio, /testID="portfolio-summary"/);
  assert.doesNotMatch(portfolio, /<MetricTile/);
  assert.match(ai, /<ScreenHeader/);
  assert.match(ai, /<DataRow label="원시 모델 확률 \(미보정\)"/);
  assert.match(ai, /<MetricTile label="검증 신뢰도"/);
  assert.match(ai, /AI ZERO AUTHORITY/);
});

test("Notification utility is honest about unavailable runtime capability", () => {
  const notifications = read("src/notificationView.tsx");
  assert.match(notifications, /알림 이벤트 수집이 아직 연결되지 않았습니다/);
  assert.match(notifications, /가짜 알림/);
  assert.match(notifications, /READ ONLY/);
});

test("UI v3 never introduces live execution authority", () => {
  const files = ["App.tsx", "src/homeView.tsx", "src/marketsView.tsx", "src/tradingView.tsx", "src/tradingViewLegacy.tsx", "src/portfolioView.tsx", "src/aiView.tsx", "src/settingsView.tsx"];
  const source = files.map(read).join("\n");
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
  assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
});
