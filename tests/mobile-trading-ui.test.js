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

test("Market order uses the verified current price and UI preserves the safety contract", () => {
  const model = buildTradingViewModel(input({ draft: { side: "BUY", orderType: "MARKET", priceInput: "", quantityInput: "2" } }));
  assert.equal(model.price, 100);
  assert.equal(model.estimatedNotional, 200);

  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "tradingView.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(source, /PAPER 관찰 모드/);
  assert.match(source, /READ ONLY/);
  assert.match(source, /매수·매도 요청을 만들거나 서버로 전송할 수 없습니다/);
  assert.match(source, /주문 생성/);
  assert.match(source, /연결 안 됨/);
  assert.match(source, /서버 전송/);
  assert.match(source, /value="불가"/);
  assert.match(source, /현재 권한/);
  assert.match(source, /value="읽기 전용"/);
  assert.match(source, /RefreshControl/);
  assert.match(source, /trading-loading/);
  assert.match(source, /trading-empty/);
  assert.match(source, /trading-error/);
  assert.match(source, /disabled=\{!submitEnabled\}/);
  assert.match(source, /NusaTextField/);
  assert.match(app, /activeTab === "Trade"/);
  assert.match(app, /<TradingView/);
});
