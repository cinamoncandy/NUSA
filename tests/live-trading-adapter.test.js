const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LiveAdapterSelectionError,
  LiveTradingAdapter,
  MockTradingAdapter,
  TradingAdapterRuntime,
  createTradingAdapter,
  readTradingAdapterEnvironment,
} = require("../dist/apps/desktop/src/exchange/liveTradingAdapter.js");
const { LiveMutationDisabledError, MockUpbitRestAdapter } = require("../dist/apps/desktop/src/exchange/upbitRestAdapter.js");

const environment = (overrides = {}) => ({ NUSA_TRADING_ADAPTER_MODE: "MOCK", ...overrides });

test("adapter configuration defaults to Mock mode and rejects unknown modes", () => {
  assert.deepEqual(readTradingAdapterEnvironment({}), { mode: "MOCK", liveAdapterEnabled: false, liveOrderMutationEnabled: false });
  assert.deepEqual(readTradingAdapterEnvironment({ NUSA_ENABLE_LIVE_ADAPTER: "true" }), { mode: "MOCK", liveAdapterEnabled: true, liveOrderMutationEnabled: false });
  assert.deepEqual(readTradingAdapterEnvironment({ NUSA_ENABLE_LIVE_ORDER_MUTATION: "true" }), { mode: "MOCK", liveAdapterEnabled: false, liveOrderMutationEnabled: true });
  assert.throws(() => readTradingAdapterEnvironment({ NUSA_TRADING_ADAPTER_MODE: "unknown" }), LiveAdapterSelectionError);
});

test("factory returns deterministic Mock adapter by default", async () => {
  const adapter = createTradingAdapter(environment(), { mockReadAdapter: new MockUpbitRestAdapter() });
  assert.equal(adapter instanceof MockTradingAdapter, true);
  assert.equal(adapter.mode, "MOCK");
  assert.equal(adapter.readOnly, true);
  assert.equal(adapter.productionMutationAllowed, false);
  assert.deepEqual(await adapter.getAccounts(), []);
  await assert.rejects(adapter.submitOrder(), LiveMutationDisabledError);
});

test("Live mode is blocked unless its feature flag is explicitly enabled", () => {
  assert.throws(() => createTradingAdapter({ NUSA_TRADING_ADAPTER_MODE: "LIVE" }), LiveAdapterSelectionError);
  const adapter = createTradingAdapter({ NUSA_TRADING_ADAPTER_MODE: "LIVE", NUSA_ENABLE_LIVE_ADAPTER: "true" }, { liveReadAdapter: new MockUpbitRestAdapter() });
  assert.equal(adapter instanceof LiveTradingAdapter, true);
  assert.equal(adapter.mode, "LIVE");
  assert.equal(adapter.readOnly, true);
  assert.equal(adapter.productionMutationAllowed, false);
});

test("Live adapter delegates reads but keeps submit, cancel, and withdrawal fail-closed", async () => {
  const adapter = new LiveTradingAdapter(new MockUpbitRestAdapter({ accounts: [{ currency: "KRW", balance: "1", locked: "0", avg_buy_price: "0", avg_buy_price_modified: false, unit_currency: "KRW" }] }));
  assert.equal((await adapter.getAccounts())[0]?.currency, "KRW");
  await assert.rejects(adapter.submitOrder(), LiveMutationDisabledError);
  await assert.rejects(adapter.cancelOrder(), LiveMutationDisabledError);
  await assert.rejects(adapter.withdraw(), LiveMutationDisabledError);
});

test("runtime mode switch preserves the safety guard", () => {
  const runtime = new TradingAdapterRuntime(environment(), { liveReadAdapter: new MockUpbitRestAdapter() });
  assert.equal(runtime.adapter.mode, "MOCK");
  assert.throws(() => runtime.switchMode("LIVE"), LiveAdapterSelectionError);
  const enabled = new TradingAdapterRuntime(environment({ NUSA_ENABLE_LIVE_ADAPTER: "true" }), { liveReadAdapter: new MockUpbitRestAdapter() });
  assert.equal(enabled.switchMode("LIVE").mode, "LIVE");
  assert.equal(enabled.adapter.productionMutationAllowed, false);
  assert.equal(enabled.switchMode("MOCK").mode, "MOCK");
});
