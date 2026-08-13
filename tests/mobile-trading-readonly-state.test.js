const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Trading permits only explicit verified PAPER mutation while LIVE remains disabled", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "tradingView.tsx"), "utf8");

  assert.match(source, /testID="trading-screen"/);
  assert.match(source, /StatusChip label="PAPER ONLY"/);
  assert.match(source, /statusLabel="LIVE NONE"/);
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
});
