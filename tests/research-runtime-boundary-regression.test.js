const test = require("node:test");
const assert = require("node:assert/strict");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { canonicalResearchJson } = require("../dist/packages/contracts/src/researchRuntime.js");

const DASHBOARD_TOKEN = "research-runtime-boundary-test-token-32bytes-min";

test("canonical research JSON rejects non-finite numbers and normalizes negative zero", () => {
  assert.throws(() => canonicalResearchJson(Number.NaN), /non-finite/);
  assert.throws(() => canonicalResearchJson(Number.POSITIVE_INFINITY), /non-finite/);
  assert.throws(() => canonicalResearchJson(Number.NEGATIVE_INFINITY), /non-finite/);
  assert.equal(canonicalResearchJson(-0), "0");
  assert.equal(canonicalResearchJson({ z: -0, a: 1 }), '{"a":1,"z":0}');
});

test("cloud market-data wiring selects one research entrypoint when legacy and automation hooks coexist", async () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  let onTicker;
  let stopped = false;
  let legacyCalls = 0;
  let automationCalls = 0;
  const legacy = { onMarketData() { legacyCalls += 1; } };
  const automation = {
    recover: () => ({ status: "READY", snapshot: null, reasons: [] }),
    onMarketData(tick) { assert.equal(tick.market, "KRW-BTC"); automationCalls += 1; }
  };
  const factory = (markets, callback) => {
    assert.deepEqual(markets, ["KRW-BTC"]);
    onTicker = callback;
    return { subscribe() {}, start() {}, stop() { stopped = true; } };
  };
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: "41939", NUSA_CLOUD_DASHBOARD_TOKEN: DASHBOARD_TOKEN, NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" },
    provider,
    undefined,
    factory,
    undefined,
    undefined,
    undefined,
    legacy,
    undefined,
    automation
  );
  try {
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() });
    assert.equal(automationCalls, 1);
    assert.equal(legacyCalls, 0);
  } finally {
    await handle.stop();
    assert.equal(stopped, true);
  }
});

test("a research recovery that throws fails closed and stays isolated from PAPER/dashboard state", async () => {
  // A throwing recover() is exactly the CANDIDATE_INPUT_HASH_MISMATCH / corrupted-state case
  // researchRecoveryCoordinator raises as an exception; it must halt the research feed the same
  // way an explicit FAIL_CLOSED result does; a tick failure inside onMarketData (once recovery is
  // healthy) must still never affect the PAPER/dashboard state.
  const provider = new InMemoryCloudDashboardStateProvider();
  let onTicker;
  let automationCalls = 0;
  const automation = {
    recover() { throw new Error("research recovery failure"); },
    onMarketData() { automationCalls += 1; throw new Error("research tick failure"); }
  };
  const factory = (_markets, callback) => {
    onTicker = callback;
    return { subscribe() {}, start() {}, stop() {} };
  };
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: "41940", NUSA_CLOUD_DASHBOARD_TOKEN: DASHBOARD_TOKEN, NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" },
    provider,
    undefined,
    factory,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    automation
  );
  try {
    assert.doesNotThrow(() => onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() }));
    assert.equal(automationCalls, 0, "a recover() failure must fail closed and never reach onMarketData");
    const state = provider.read({ userId: "operator", scopes: ["dashboard:read"] });
    assert.notEqual(state, undefined);
    assert.equal(state.mode, "PAPER");
  } finally {
    await handle.stop();
  }
});
test("a FAIL_CLOSED plain researchRuntime recovery halts the market-data research feed", async () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  let onTicker;
  let legacyCalls = 0;
  const legacy = { onMarketData() { legacyCalls += 1; } };
  const recoveryCoordinator = { recover: () => ({ status: "FAIL_CLOSED", snapshot: null, reasons: ["CANDIDATE_INPUT_HASH_MISMATCH"] }) };
  const factory = (_markets, callback) => { onTicker = callback; return { subscribe() {}, start() {}, stop() {} }; };
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: "41960", NUSA_CLOUD_DASHBOARD_TOKEN: DASHBOARD_TOKEN, NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" },
    provider,
    undefined,
    factory,
    undefined,
    undefined,
    undefined,
    legacy,
    recoveryCoordinator,
    undefined
  );
  try {
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() });
    assert.equal(legacyCalls, 0, "a corrupted research recovery must never be silently discarded; it must halt the research feed");
  } finally {
    await handle.stop();
  }
});

test("a research recovery that throws also halts the plain researchRuntime market-data feed", async () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  let onTicker;
  let legacyCalls = 0;
  const legacy = { onMarketData() { legacyCalls += 1; } };
  const recoveryCoordinator = { recover: () => { throw new Error("recovery repository unavailable"); } };
  const factory = (_markets, callback) => { onTicker = callback; return { subscribe() {}, start() {}, stop() {} }; };
  const handle = startCloudRuntime(
    { NUSA_CLOUD_DASHBOARD_PORT: "41961", NUSA_CLOUD_DASHBOARD_TOKEN: DASHBOARD_TOKEN, NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" },
    provider,
    undefined,
    factory,
    undefined,
    undefined,
    undefined,
    legacy,
    recoveryCoordinator,
    undefined
  );
  try {
    assert.doesNotThrow(() => onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() }));
    assert.equal(legacyCalls, 0);
  } finally {
    await handle.stop();
  }
});
