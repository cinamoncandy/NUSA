const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("production PAPER is read-only supervision while isolated legacy execution remains PAPER-only", () => {
  const shellSource = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "tradingView.tsx"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "tradingViewLegacy.tsx"), "utf8");

  assert.match(shellSource, /PaperLearningMonitorView/);
  assert.match(shellSource, /buildPaperLearningScreen\(\[\], "PAUSED", "PROJECTION_ABSENT"\)/);
  assert.match(shellSource, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(shellSource, /<LegacyTradingView \{\.\.\.props\} \/>/);

  assert.match(source, /testID="trading-screen"/);
  assert.match(source, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(source, /statusLabel="LIVE NONE"/);
  assert.match(source, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(source, /await placeLocalPaperOrder\(/);
  assert.match(source, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(source, /PAPER 주문 연결이 필요합니다/);
  assert.match(source, /02 · 주문 검토/);
  assert.match(source, /PAPER 주문 확정/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.match(source, /PersonalPaperOrderRetryIdentity/);
  assert.match(source, /submitPersonalPaperOrderWithRetryIdentity/);

  for (const candidate of [shellSource, source]) {
    assert.doesNotMatch(candidate, /authority:\s*"LIVE"/);
    assert.doesNotMatch(candidate, /productionMutationAllowed:\s*true/);
    assert.doesNotMatch(candidate, /\/api\/(?:live|withdraw|transfer)/i);
  }
});
