const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product navigation promotes PAPER and AI through the canonical four-tab shell", () => {
  const app = read("App.tsx");
  const tradingShell = read("src/tradingView.tsx");
  const tradingWorkspace = read("src/tradingViewLegacy.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\] as const/);
  assert.match(app, /Paper: "TRADE"/);
  assert.match(app, /type Tab = PrimaryTab \| "AiSignal" \| "Order"/);
  assert.match(app, /activeTab === "AiSignal" \? <AiView/);
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /activeTab === "Order" \? <OrderHistoryView/);
  assert.match(app, /header-notifications/);
  assert.match(app, /header-settings/);
  assert.match(app, /setUtilityView\(null\); setActiveTab\(tab\)/);
  assert.match(app, /PaperLearningMonitorView/);
  assert.match(app, /buildPaperLearningScreen/);
  assert.match(app, /onOpenPaperLearning/);
  assert.match(read("src/homeView.tsx"), /testID="home-paper-learning"/);
  assert.match(tradingShell, /import \{ TradingView as LegacyTradingView \} from "\.\/tradingViewLegacy"/);
  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(tradingWorkspace, /testID="trade-paper-learning"/);
  assert.match(read("src/portfolioView.tsx"), /testID="portfolio-paper-learning"/);
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

test("Markets keeps the chart reachable and truthful even when App has no candle data", () => {
  // v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §6): the chart is not hidden until real
  // data exists -- it defaults first and shows its own truthful unavailable state instead.
  const source = read("src/marketsView.tsx");
  const app = read("App.tsx");
  assert.match(source, /useState<Panel>\("CHART"\)/);
  assert.doesNotMatch(source, /chartAvailable/);
  assert.match(source, /panel === "WATCHLIST"/);
  // Real candle wiring landed (see PR #526) -- the chart data source is no longer a placeholder gap.
  assert.match(app, /rawCandles=\{publicMarkets\.candles === null \? null : \[\.\.\.publicMarkets\.candles\]\}/);
});

test("PAPER submit keeps LOCAL independent while Cloud PAPER remains runtime-gated", () => {
  const shell = read("src/tradingView.tsx");
  const source = read("src/tradingViewLegacy.tsx");
  assert.match(shell, /import \{ TradingView as LegacyTradingView \} from "\.\/tradingViewLegacy"/);
  assert.match(shell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(source, /const configuredEndpoint = getConfiguredPaperEndpoint\(\)/);
  assert.match(source, /const builtInSubmitAvailable = Boolean\(configuredEndpoint && credentialSession\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(source, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(source, /const cloudPaperSubmitAvailable = runtimeCanSubmit && builtInSubmitAvailable/);
  assert.match(source, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(source, /testID="paper-runtime-blocked"/);
  assert.match(source, /liveMutationAllowed: false/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.match(source, /설정에서 PAPER endpoint와 세션을 먼저 검증하세요/);
  assert.match(source, /statusLabel="LIVE NONE"/);
  assert.doesNotMatch(shell, /productionMutationAllowed: true/);
  assert.doesNotMatch(source, /productionMutationAllowed: true/);
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
