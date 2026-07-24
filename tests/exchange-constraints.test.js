const test=require("node:test");const assert=require("node:assert/strict");const x=require("../dist/apps/execution/src/index.js");
const c={symbol:"BTCUSDT",minQtyRaw:10n,maxQtyRaw:1000n,qtyStepRaw:10n,priceTickRaw:5n,minNotionalRaw:1000n,maxNotionalRaw:1000000n,effectiveAtMs:0,expiresAtMs:2000};
test("allows aligned order",()=>{const r=x.validateExchangeConstraints({symbol:"BTCUSDT",orderType:"LIMIT",qtyRaw:20n,priceRaw:100n},c,1000);assert.equal(r.type,x.ExchangeConstraintDecisionType.ALLOW)});
test("blocks stale metadata",()=>{const r=x.validateExchangeConstraints({symbol:"BTCUSDT",orderType:"LIMIT",qtyRaw:20n,priceRaw:100n},c,2000);assert.equal(r.reason,x.ExchangeConstraintReason.METADATA_STALE)});
test("blocks quantity step mismatch",()=>{const r=x.validateExchangeConstraints({symbol:"BTCUSDT",orderType:"LIMIT",qtyRaw:25n,priceRaw:100n},c,1000);assert.equal(r.reason,x.ExchangeConstraintReason.QTY_STEP_MISMATCH)});
test("blocks price tick mismatch",()=>{const r=x.validateExchangeConstraints({symbol:"BTCUSDT",orderType:"LIMIT",qtyRaw:20n,priceRaw:102n},c,1000);assert.equal(r.reason,x.ExchangeConstraintReason.PRICE_TICK_MISMATCH)});
test("market order requires a reference price",()=>{const r=x.validateExchangeConstraints({symbol:"BTCUSDT",orderType:"MARKET",qtyRaw:20n},c,1000);assert.equal(r.reason,x.ExchangeConstraintReason.MARKET_PRICE_REQUIRED)});
test("blocks minimum notional violation",()=>{const r=x.validateExchangeConstraints({symbol:"BTCUSDT",orderType:"LIMIT",qtyRaw:10n,priceRaw:50n},c,1000);assert.equal(r.reason,x.ExchangeConstraintReason.NOTIONAL_BELOW_MIN)});
