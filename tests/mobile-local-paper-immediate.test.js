const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("production PAPER monitors autonomous learning while legacy local simulator stays isolated", () => {
  const app = read("apps/mobile/App.tsx");
  const shell = read("apps/mobile/src/tradingView.tsx");
  const legacy = read("apps/mobile/src/tradingViewLegacy.tsx");
  const ledger = read("apps/mobile/src/localPaperLedger.ts");

  assert.match(app, /activeTab === "Paper" \? <TradingView/);
  assert.match(shell, /PaperLearningMonitorView/);
  assert.doesNotMatch(shell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.doesNotMatch(shell, /priceInput|quantityInput|PAPER 주문 확정|placeLocalPaperOrder/);

  // The old simulator remains available only as an internal/debug implementation and stays PAPER-only.
  assert.match(ledger, /10_000_000/);
  assert.match(ledger, /MockTradingService/);
  assert.match(ledger, /currency: "KRW"/);
  assert.match(legacy, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(legacy, /await placeLocalPaperOrder\(/);
  assert.match(legacy, /productionMutationAllowed: false/);
  assert.doesNotMatch(legacy, /productionMutationAllowed:\s*true|authority:\s*"LIVE"/);
  assert.doesNotMatch(shell, /productionMutationAllowed:\s*true|authority:\s*"LIVE"/);
});

test("MockTradingService parses KRW-BTC as KRW quote and BTC base", () => {
  const service = read("apps/mobile/src/tradingService.ts");
  assert.match(service, /market\.includes\("\/"\) \? "\/" : market\.includes\("-"\) \? "-" : null/);
  assert.match(service, /const \[quote, base, \.\.\.rest\] = market\.split\(separator\)/);
  assert.doesNotMatch(service, /market\.split\("\/"\)\[0\] \?\? market\.split\("-"\)\[0\]/);
});
