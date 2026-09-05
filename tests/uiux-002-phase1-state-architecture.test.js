const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

function source(file) {
  return fs.readFileSync(path.join(mobile, "src", file), "utf8");
}

test("AI distinguishes error and loading before rendering analysis content", () => {
  const ai = source("aiView.tsx");
  const errorIndex = ai.indexOf('if (error) return <AiState');
  const loadingIndex = ai.indexOf('if (ai === null && research === null) return <AiState');
  const screenIndex = ai.indexOf('testID="ai-screen"');

  assert.ok(errorIndex >= 0, "AI must expose an explicit error state");
  assert.ok(loadingIndex > errorIndex, "AI loading must be evaluated after error state");
  assert.ok(screenIndex > loadingIndex, "analysis cards must not render before terminal state checks");
  assert.match(ai, /testID="ai-loading"/);
  assert.match(ai, /testID="ai-error"/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
});

test("Markets keeps chart navigation reachable regardless of verified candles", () => {
  const markets = source("marketsView.tsx");
  assert.match(markets, /useState<Panel>\("CHART"\)/);
  assert.match(markets, /testID="markets-panels"/);
  assert.match(markets, /const watchlist = <WatchlistView/);
  assert.match(markets, /const chart = <View[\s\S]*<ChartView/);
});

test("production PAPER is learning supervision only while legacy simulation stays isolated and PAPER-only", () => {
  const wrapper = source("tradingView.tsx");
  const trading = source("tradingViewLegacy.tsx");

  assert.match(wrapper, /import \{ PaperLearningMonitorView \} from "\.\/paperLearningMonitorView"/);
  assert.match(wrapper, /buildPaperLearningScreen/);
  assert.match(wrapper, /<PaperLearningMonitorView/);
  assert.doesNotMatch(wrapper, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.doesNotMatch(wrapper, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(wrapper, /authority:\s*["']LIVE["']/);

  assert.match(source("localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(trading, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(trading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(trading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && !usingLocalPaper/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(trading, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(trading, /statusLabel="LIVE NONE"/);
  assert.match(trading, /authority:\s*"PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed:\s*false/);
  assert.doesNotMatch(trading, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(trading, /authority:\s*["']LIVE["']/);
});
