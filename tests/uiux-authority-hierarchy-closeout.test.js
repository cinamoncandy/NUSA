const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("AI presents signal reasoning before an explicit zero-authority boundary", () => {
  const ai = read("aiView.tsx");
  const thesisIndex = ai.indexOf('testID="ai-thesis-card"');
  const zeroAuthorityIndex = ai.indexOf('testID="ai-zero-authority-status"');
  assert.ok(thesisIndex >= 0);
  assert.ok(zeroAuthorityIndex > thesisIndex, "zero-authority boundary must follow signal reasoning");
  assert.match(ai, /testID="ai-why"/);
  assert.match(ai, /testID="ai-result"/);
  assert.match(ai, /testID="ai-risk"/);
  assert.match(ai, /testID="ai-learning"/);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /PUBLIC READ ONLY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(ai, /<AuthorityBanner/);
});

test("production PAPER supervises learning while isolated legacy simulation remains PAPER-only", () => {
  const tradingWrapper = read("tradingView.tsx");
  const trading = read("tradingViewLegacy.tsx");
  const combinedTrading = `${tradingWrapper}\n${trading}`;

  assert.match(tradingWrapper, /TradingView as LegacyTradingView/);
  assert.match(tradingWrapper, /PaperLearningMonitorView/);
  assert.doesNotMatch(tradingWrapper, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.equal(occurrences(trading, 'statusLabel="LIVE NONE"'), 1);
  assert.doesNotMatch(combinedTrading, /<AuthorityBanner/);
  assert.match(read("localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(trading, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(trading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(trading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && !usingLocalPaper/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(trading, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(trading, /testID="paper-order-ticket"/);
  assert.match(trading, /const requestSubmit = \(\) =>/);
  assert.match(trading, /const submitBuiltIn = async \(\) =>/);
  assert.match(trading, /setConfirming\(true\)/);
  assert.doesNotMatch(combinedTrading, /authority: "LIVE"|productionMutationAllowed: true|liveMutationAllowed: true/);
});

test("authority hierarchy closeout preserves AI zero-authority and PAPER-only mutation", () => {
  const ai = read("aiView.tsx");
  const tradingWrapper = read("tradingView.tsx");
  const trading = read("tradingViewLegacy.tsx");
  const combinedTrading = `${tradingWrapper}\n${trading}`;

  assert.doesNotMatch(ai, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
  assert.match(tradingWrapper, /TradingView as LegacyTradingView/);
  assert.match(tradingWrapper, /PaperLearningMonitorView/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /liveMutationAllowed: false/);
  assert.doesNotMatch(combinedTrading, /authority: "LIVE"|productionMutationAllowed: true|liveMutationAllowed: true/);
  assert.doesNotMatch(combinedTrading, /\/live(?:\/|\b)|\/withdraw(?:\/|\b)|\/transfer(?:\/|\b)/i);
});
