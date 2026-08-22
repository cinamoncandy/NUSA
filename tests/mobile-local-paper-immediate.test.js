const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("mobile PAPER falls back to a 10M KRW local simulator without Cloud authority", () => {
  const app = read("apps/mobile/App.tsx");
  const view = read("apps/mobile/src/tradingView.tsx");
  assert.match(app, /activeTab !== "Portfolio" && activeTab !== "Paper"/);
  assert.match(view, /LOCAL_PAPER_INITIAL_CASH = 10_000_000/);
  assert.match(view, /new MockTradingService\(\[\{ currency: "KRW", available: LOCAL_PAPER_INITIAL_CASH \}\]\)/);
  assert.match(view, /const usingLocalPaper = !builtInSubmitAvailable/);
  assert.match(view, /loadUpbitPublicMarkets\(\)/);
  assert.match(view, /localTradingService\.placePaperOrder/);
  assert.match(view, /LOCAL PAPER 체결 완료/);
  assert.match(view, /liveMutationAllowed: false/);
  assert.match(view, /productionMutationAllowed: false/);
});

test("MockTradingService parses KRW-BTC as KRW quote and BTC base", () => {
  const service = read("apps/mobile/src/tradingService.ts");
  assert.match(service, /market\.includes\("\/"\) \? "\/" : market\.includes\("-"\) \? "-" : null/);
  assert.match(service, /const \[quote, base, \.\.\.rest\] = market\.split\(separator\)/);
  assert.doesNotMatch(service, /market\.split\("\/"\)\[0\] \?\? market\.split\("-"\)\[0\]/);
});
