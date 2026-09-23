const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildTradingViewModel } = require("../dist/apps/mobile/src/tradingViewModel.js");

const input = (overrides = {}) => ({
  market: { market: "KRW-BTC", connectionState: "CONNECTED", stale: false, price: 100 },
  account: { mode: "PAPER", liveMutationAllowed: false, cash: 1_000, assetQuantity: 2, market: "KRW-BTC" },
  draft: { side: "BUY", orderType: "LIMIT", priceInput: "100", quantityInput: "2" },
  submitAvailable: true,
  ...overrides,
});

test("Trading model approves valid Paper order input without guessing fees", () => {
  const model = buildTradingViewModel(input());
  assert.equal(model.safetyApproved, true);
  assert.equal(model.canSubmit, true);
  assert.equal(model.estimatedNotional, 200);
  assert.equal(model.availableAmount, 1_000);
  assert.deepEqual(model.validationErrors, []);
});

test("Trading model blocks disconnected or stale market data", () => {
  for (const market of [{ connectionState: "RECONNECTING", stale: false }, { connectionState: "CONNECTED", stale: true }]) {
    const model = buildTradingViewModel(input({ market: { ...input().market, ...market } }));
    assert.equal(model.safetyApproved, false);
    assert.equal(model.canSubmit, false);
    assert.ok(model.blockedReasons.includes("MARKET_DATA_NOT_READY"));
  }
});

test("Trading model blocks missing price and invalid inputs", () => {
  const missingPrice = buildTradingViewModel(input({ market: { ...input().market, price: null }, draft: { ...input().draft, orderType: "MARKET" } }));
  assert.equal(missingPrice.canSubmit, false);
  assert.ok(missingPrice.blockedReasons.includes("PRICE_NOT_RECEIVED"));
  const invalid = buildTradingViewModel(input({ draft: { ...input().draft, priceInput: "", quantityInput: "-1" } }));
  assert.equal(invalid.canSubmit, false);
  assert.deepEqual(invalid.validationErrors, ["price is required", "quantity must be positive"]);
});

test("Trading model enforces balance, mode, and live mutation gates", () => {
  const insufficient = buildTradingViewModel(input({ account: { ...input().account, cash: 100 } }));
  assert.ok(insufficient.validationErrors.includes("insufficient available cash"));
  assert.equal(insufficient.canSubmit, false);
  const sell = buildTradingViewModel(input({ draft: { side: "SELL", orderType: "MARKET", priceInput: "", quantityInput: "3" } }));
  assert.ok(sell.validationErrors.includes("insufficient available asset"));
  const unsafe = buildTradingViewModel(input({ account: { ...input().account, mode: "SHADOW", liveMutationAllowed: true } }));
  assert.ok(unsafe.blockedReasons.includes("PAPER_MODE_REQUIRED"));
  assert.ok(unsafe.blockedReasons.includes("LIVE_MUTATION_DISABLED"));
});

test("Market order model remains safe while production PAPER exposes learning only and legacy execution stays isolated", () => {
  const model = buildTradingViewModel(input({ draft: { side: "BUY", orderType: "MARKET", priceInput: "", quantityInput: "2" } }));
  assert.equal(model.price, 100);
  assert.equal(model.estimatedNotional, 200);

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

  assert.match(fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "localPaperLedger.ts"), "utf8"), /session\.isConfigured\(\)/);
  assert.match(app, /utilityView === "PAPER"/);
  // The board has no ORDER screen; the owner removed it. PAPER is observation and learning only.
  assert.doesNotMatch(app, /<PaperOrderView/);
});

// The manual PAPER order contract this block covered moved to
// tests/mobile-no-order-submission-surface.test.js when tradingView.tsx and
// tradingViewLegacy.tsx were deleted: there is no order submission surface left to assert on.

test("production PAPER contains no public-feed execution context while legacy feed labels never borrow LIVE authority wording", () => {

  // The two order surfaces these guards used to cover were deleted with the ORDER
  // destination. The guards now cover the PAPER surfaces that replaced them.
  for (const source of [fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "paperLearningMonitorView.tsx"), "utf8"), fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8")]) {
    assert.doesNotMatch(source, /차트 LIVE/);
    assert.doesNotMatch(source, /PUBLIC LIVE/);
  }
});
