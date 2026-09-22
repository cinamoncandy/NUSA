const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("App shell routes the canonical five-tab decision flow and preserves deeper jobs", () => {
  const app = read("App.tsx");
  assert.match(app, /import \{ HomeView/);
  assert.match(app, /const tabs = \["Home", "Market", "Signals", "Strategies", "More"\]/);
  assert.match(app, /Signals: "Signals"/);
  assert.match(app, /const tabDisplayLabels: Readonly<Record<PrimaryTab, string>> = \{ Home: "Home", Market: "Market", Signals: "Signals", Strategies: "Strategies", More: "More" \};/);
  assert.doesNotMatch(app, /Paper: "STRATEGY"/);
  assert.doesNotMatch(app, /AiSignal: "SIGNAL"/);
  assert.match(app, /Signals: "AI 판단과 근거"/);
  assert.match(app, /type Tab = PrimaryTab/);
  assert.match(app, /<HomeView/);
  assert.match(app, /utilityView === "PAPER"/);
  assert.doesNotMatch(app, /<PaperOrderView/);
  assert.match(app, /activeTab === "Signals" \? <AiView/);
  assert.match(app, /accessibilityRole="tablist"/);
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
});

test("Home uses the approved intelligence hierarchy and keeps AI read-only", () => {
  const source = read("src/homeView.tsx");
  const decisionSurface = read("src/homeDecisionSurface.ts");
  assert.match(source, /testID="home-master-rail"/);
  assert.match(source, /testID="home-market-pulse"/);
  assert.match(source, /testID="account-hero-card"/);
  assert.match(source, /TOTAL P&L/);
  assert.match(source, />EQUITY<\/Text>/);
  assert.match(source, /\{signalAvailable \? "VERIFIED AI SIGNAL" : "NO VERIFIED SIGNAL"\}/);
  assert.match(source, /const signalAvailable = decision\.aiInsightAvailable/);
  assert.match(source, /testID="home-risk-authority"/);
  assert.match(source, /testID="home-decision-stage"/);
  assert.match(source, /testID="home-market-breadth"/);
  assert.match(source, /testID="home-top-signals"/);
  assert.match(source, /testID="home-paper-performance"/);
  assert.match(source, /testID="home-capital-limits"/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(source, /selectHomeMarketData\(props\.publicMarkets, props\.snapshot\?\.markets \?\? \[\]\)/);
  assert.match(source, /const signalAvailable = decision\.aiInsightAvailable/);
  assert.match(decisionSurface, /PAPER P&L .*EQUITY/);
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
  assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
});

test("Markets, PAPER, Settings and History use shared segmented controls", () => {
  const markets = read("src/marketsView.tsx");
  const settings = read("src/settingsView.tsx");
  const history = read("src/orderHistoryView.tsx");
  assert.match(markets, /markets-panel-segmented-control/);
  assert.match(settings, /settings-theme-segmented-control/);
  assert.match(history, /order-history-filters/);
  assert.match(history, /order-history-periods/);
  assert.match(history, /order-history-sorts/);
});

test("Portfolio and AI use decision-first information hierarchy", () => {
  const portfolio = read("src/portfolioView.tsx");
  const ai = read("src/aiView.tsx");
  assert.match(portfolio, /<AuthorityRail/);
  assert.match(portfolio, /testID="portfolio-master-hero"/);
  assert.match(portfolio, /testID="portfolio-supervisor-summary"/);
  assert.match(portfolio, /label: "PAPER EQUITY"/);
  assert.match(portfolio, /testID="portfolio-upbit-read-only"/);
  assert.match(portfolio, /testID="portfolio-allocation-rail"/);
  assert.match(portfolio, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다/);
  assert.doesNotMatch(portfolio, /testID="portfolio-summary"/);
  assert.doesNotMatch(portfolio, /<MetricTile/);

  assert.match(ai, /testID="ai-screen"/);
  assert.match(ai, /SIGNAL DETAIL/);
  assert.match(ai, /testID="ai-convergence-signal"/);
  assert.match(ai, /testID="ai-stage-timeline"/);
  assert.match(ai, /testID="ai-thesis-card"/);
  assert.match(ai, /testID="ai-why"/);
  assert.match(ai, /testID="ai-result"/);
  assert.match(ai, /testID="ai-risk"/);
  assert.match(ai, /testID="ai-learning"/);
  assert.match(ai, /calibrationStatus==="CALIBRATED"/);
  assert.match(ai, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
});

test("Notification utility is honest about unavailable runtime capability", () => {
  const notifications = read("src/notificationView.tsx");
  assert.match(notifications, /알림 이벤트 수집이 아직 연결되지 않았습니다/);
  assert.match(notifications, /가짜 알림/);
  assert.match(notifications, /READ ONLY/);
});

test("UI v3 never introduces live execution authority", () => {
  const files = ["App.tsx", "src/homeView.tsx", "src/homeDecisionSurface.ts", "src/marketsView.tsx", "src/paperLearningMonitorView.tsx", "src/strategiesView.tsx", "src/portfolioView.tsx", "src/aiView.tsx", "src/settingsView.tsx", "src/moreMenuView.tsx"];
  const source = files.map(read).join("\n");
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
  assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
});
