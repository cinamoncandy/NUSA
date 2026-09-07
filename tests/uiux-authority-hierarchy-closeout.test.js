const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("AI presents intelligence before one compact authority summary", () => {
  const ai = read("aiView.tsx");
  const thesisIndex = ai.indexOf('testID="ai-thesis-card"');
  const authorityIndex = ai.indexOf('testID="ai-authority-card"');
  const evidenceIndex = ai.indexOf('testID="ai-evidence-card"');

  assert.ok(thesisIndex >= 0);
  assert.ok(evidenceIndex > thesisIndex);
  assert.ok(authorityIndex > evidenceIndex);
  assert.match(ai, /testID="ai-zero-authority-status"><StatusChip label="AI ZERO AUTHORITY"/);
  assert.match(ai, /AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다/);
  assert.equal(occurrences(ai, "READ ONLY"), 1);
  assert.doesNotMatch(ai, /<AuthorityBanner/);
  assert.match(ai, /testID="ai-authority-card"/);
  assert.match(ai, /DataRow label="AI LIVE 권한" value=\{liveAuthority \?\? "-"\}/);
  assert.match(ai, /DataRow label="Production mutation" value=\{productionMutationAllowed == null \? "-"/);
  assert.match(ai, /DataRow label="킬 스위치" value=\{killSwitchActive == null \? "-"/);

  const confidenceIndex = ai.indexOf('testID="ai-trusted-confidence"');
  const diagnosticsIndex = ai.indexOf('testID="ai-diagnostics-card"');
  const zeroAuthorityIndex = ai.indexOf('testID="ai-zero-authority-status"');
  assert.ok(confidenceIndex > thesisIndex, "trusted confidence must follow thesis");
  assert.ok(diagnosticsIndex > evidenceIndex, "diagnostics must follow evidence/counter-evidence");
  assert.ok(zeroAuthorityIndex > diagnosticsIndex, "authority boundary must follow detail/diagnostics, not interrupt it");
  assert.ok(authorityIndex > zeroAuthorityIndex, "the final authority card must be the last element");
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
