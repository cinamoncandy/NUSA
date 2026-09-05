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

  assert.ok(errorIndex >= 0);
  assert.ok(loadingIndex > errorIndex);
  assert.ok(screenIndex > loadingIndex);
  assert.match(ai, /testID="ai-loading"/);
  assert.match(ai, /testID="ai-error"/);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
  assert.match(ai, /testID="ai-loading-skeleton"/);
  assert.doesNotMatch(ai, /ActivityIndicator/);
});

test("Markets keeps chart navigation reachable regardless of verified candles", () => {
  const markets = source("marketsView.tsx");
  assert.match(markets, /useState<Panel>\("CHART"\)/);
  assert.match(markets, /testID="markets-panels"/);
  assert.match(markets, /const watchlist = <WatchlistView/);
  assert.match(markets, /const chart = <View[\s\S]*<ChartView/);
});

test("PAPER exposes independent LOCAL execution while verified CLOUD execution remains runtime-gated", () => {
  const tradingShell = source("tradingView.tsx");
  const trading = source("tradingViewLegacy.tsx");

  assert.match(tradingShell, /import \{ TradingView as LegacyTradingView \} from "\.\/tradingViewLegacy"/);
  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(source("localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(trading, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(trading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(trading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && !usingLocalPaper/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(trading, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(trading, /statusLabel="LIVE NONE"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /liveMutationAllowed: false/);

  for (const candidate of [tradingShell, trading]) {
    assert.doesNotMatch(candidate, /productionMutationAllowed:\s*true/);
    assert.doesNotMatch(candidate, /authority:\s*["']LIVE["']/);
    assert.doesNotMatch(candidate, /\/(?:live|withdraw|transfer)(?:\/|["'`])/i);
  }
});
