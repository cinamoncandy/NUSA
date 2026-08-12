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
  const authorityIndex = ai.indexOf('testID="ai-authority-summary"');
  const evidenceIndex = ai.indexOf('testID="ai-evidence-card"');

  assert.ok(thesisIndex >= 0);
  assert.ok(authorityIndex > thesisIndex);
  assert.ok(evidenceIndex > authorityIndex);
  assert.equal(occurrences(ai, "ZERO AUTHORITY"), 1);
  assert.equal(occurrences(ai, "READ ONLY"), 1);
  assert.doesNotMatch(ai, /<AuthorityBanner/);
  assert.match(ai, /testID="ai-authority-card"/);
  assert.match(ai, /DataRow label="AI LIVE 권한"/);
  assert.match(ai, /DataRow label="Production mutation"/);
  assert.match(ai, /DataRow label="킬 스위치"/);
});

test("PAPER exposes mutation only after verified connection while LIVE remains forbidden", () => {
  const trading = read("tradingView.tsx");

  assert.equal(occurrences(trading, 'label="PAPER ONLY"'), 1);
  assert.equal(occurrences(trading, 'label="LIVE 금지"'), 1);
  assert.doesNotMatch(trading, /<AuthorityBanner/);
  assert.match(trading, /const builtInSubmitAvailable = Boolean\(configuredEndpoint && credentialSession\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| builtInSubmitAvailable/);
  assert.match(trading, /!submitAvailable \? <NusaCard><Text[^>]*>PAPER 주문 연결 필요<\/Text>/);
  assert.match(trading, /PAPER 주문 미리보기/);
  assert.match(trading, /PAPER 주문 확인/);
  assert.match(trading, /PAPER 주문 확정/);
});

test("authority hierarchy closeout preserves AI zero-authority and PAPER-only mutation", () => {
  const ai = read("aiView.tsx");
  const trading = read("tradingView.tsx");

  assert.doesNotMatch(ai, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /liveMutationAllowed: false/);
  assert.doesNotMatch(trading, /authority: "LIVE"|productionMutationAllowed: true|liveMutationAllowed: true/);
});
