const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("App shell routes canonical Home and preserves five primary jobs", () => {
  const app = read("App.tsx");
  assert.match(app, /import \{ HomeView/);
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\]/);
  assert.match(app, /<HomeView/);
  assert.match(app, /activeTab === "Trade"/);
  assert.match(app, /<TradingView/);
  assert.match(app, /accessibilityRole="tablist"/);
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
});

test("Home uses v5 hierarchy (equity -> P&L -> allocation -> shortcuts -> AI insight) and keeps AI read-only", () => {
  const source = read("src/homeView.tsx");
  assert.match(source, /<ScreenHeader/);
  // v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §5): "redundant dashboard metric cards"
  // are removed, not just relabeled -- no MetricTile grid belongs on Home anymore.
  assert.doesNotMatch(source, /<MetricTile/);
  const heroIndex = source.indexOf('testID="account-hero-card"');
  const allocationIndex = source.indexOf('testID="home-allocation-panel"');
  const actionsIndex = source.indexOf("styles.primaryActions");
  const aiIndex = source.indexOf('testID="ai-card"');
  assert.ok(heroIndex > -1 && allocationIndex > heroIndex && actionsIndex > allocationIndex && aiIndex > actionsIndex, "Home must render equity -> allocation rail -> shortcuts -> AI insight in that order");
  assert.match(source, /READ ONLY/);
  assert.match(source, /LIVE 권한/);
  assert.match(source, /Production mutation/);
});

test("Markets, PAPER, Settings and History use shared segmented controls", () => {
  const markets = read("src/marketsView.tsx");
  const trading = read("src/tradingView.tsx");
  const settings = read("src/settingsView.tsx");
  const history = read("src/orderHistoryView.tsx");
  assert.match(markets, /markets-panel-segmented-control/);
  assert.match(trading, /paper-side-segmented-control/);
  assert.match(trading, /paper-type-segmented-control/);
  assert.match(settings, /settings-theme-segmented-control/);
  assert.match(history, /order-history-filters/);
  assert.match(history, /order-history-periods/);
  assert.match(history, /order-history-sorts/);
});

test("Portfolio uses v5 hierarchy (equity -> allocation -> position -> realized/unrealized -> detail) and AI stays metric-first", () => {
  const portfolio = read("src/portfolioView.tsx");
  const ai = read("src/aiView.tsx");
  assert.match(portfolio, /<ScreenHeader/);
  assert.match(portfolio, /testID="portfolio-allocation-rail"/);
  // v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §8): "avoid splitting every metric into
  // a card" -- realized/unrealized P&L are DataRow entries, not their own MetricTile boxes.
  assert.doesNotMatch(portfolio, /<MetricTile/);
  assert.match(portfolio, /testID="portfolio-realized-pnl"/);
  assert.match(portfolio, /testID="portfolio-unrealized-pnl"/);
  const allocationIndex = portfolio.indexOf('testID="portfolio-allocation-rail"');
  const positionIndex = portfolio.indexOf("renderPosition(model, theme)");
  const performanceIndex = portfolio.indexOf('testID="portfolio-performance-summary"');
  const detailIndex = portfolio.indexOf('testID="portfolio-account-breakdown"');
  assert.ok(allocationIndex > -1 && positionIndex > allocationIndex && performanceIndex > positionIndex && detailIndex > performanceIndex, "Portfolio must render allocation -> position -> realized/unrealized -> technical detail in that order");
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
  const files = ["App.tsx", "src/homeView.tsx", "src/marketsView.tsx", "src/tradingView.tsx", "src/portfolioView.tsx", "src/aiView.tsx", "src/settingsView.tsx"];
  const source = files.map(read).join("\n");
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
  assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
});
