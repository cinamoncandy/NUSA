const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("production PAPER monitors autonomous learning while legacy local simulator stays isolated", () => {
  const app = read("apps/mobile/App.tsx");
  const ledger = read("apps/mobile/src/localPaperLedger.ts");

  // The Paper tab is now the supervision monitor and the order form moved to the Order tab, which
  // is what this test is named for.
  assert.match(app, /utilityView === "PAPER" \? <PaperLearningMonitorView/);
  assert.match(app, /activeTab === "Strategies" \? <StrategiesView/);

  // The old simulator remains available only as an internal/debug implementation and stays PAPER-only.
  assert.match(ledger, /10_000_000/);
  assert.match(ledger, /MockTradingService/);
  assert.match(ledger, /currency: "KRW"/);
});

test("MockTradingService parses KRW-BTC as KRW quote and BTC base", () => {
  const service = read("apps/mobile/src/tradingService.ts");
  assert.match(service, /market\.includes\("\/"\) \? "\/" : market\.includes\("-"\) \? "-" : null/);
  assert.match(service, /const \[quote, base, \.\.\.rest\] = market\.split\(separator\)/);
  assert.doesNotMatch(service, /market\.split\("\/"\)\[0\] \?\? market\.split\("-"\)\[0\]/);
});
