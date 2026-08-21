const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Trading permits only PAPER mutation while LIVE remains disabled", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "tradingView.tsx"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "localPaperStore.ts"), "utf8");

  assert.match(source, /testID="trading-screen"/);
  assert.match(source, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(source, /statusLabel="LIVE NONE"/);
  assert.match(source, /const usingLocalPaper = !builtInSubmitAvailable/);
  assert.match(source, /placeLocalPaperOrder\(/);
  assert.match(store, /const service = new MockTradingService/);
  assert.match(store, /service\.placePaperOrder/);
  assert.match(source, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(source, /PAPER 주문 연결이 필요합니다/);
  assert.match(source, /02 · 주문 검토/);
  assert.match(source, /PAPER 주문 확정/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.match(source, /PersonalPaperOrderRetryIdentity/);
  assert.match(source, /submitPersonalPaperOrderWithRetryIdentity/);

  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /\/api\/(?:live|withdraw|transfer)/i);
  assert.doesNotMatch(store, /authority:\s*"LIVE"/);
  assert.doesNotMatch(store, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(store, /\/api\/(?:live|withdraw|transfer)/i);
});
