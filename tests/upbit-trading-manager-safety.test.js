const test = require("node:test");
const assert = require("node:assert/strict");
const { UpbitTradingManager } = require("../dist/apps/mobile/src/upbitTradingManager.js");

/**
 * Behavioral coverage for UpbitTradingManager's safety guards, compiled from the real
 * TypeScript source (no React Native imports in this file, so it builds into dist/ and
 * can be exercised directly -- unlike the .tsx mobile views, which are covered only by
 * source-pattern assertions elsewhere).
 */

const credentialProvider = async () => "test-bridge-token";

const stubFetchOnce = (body) => {
  const previous = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => body });
  return () => { global.fetch = previous; };
};

test("the daily-loss check trips once recordDailyLoss reaches the configured limit", () => {
  const manager = new UpbitTradingManager(credentialProvider, "LIVE", { dailyLossLimitKRW: 500_000 });
  manager.recordDailyLoss(499_999);
  assert.equal(manager.validateOrderPlacement(1_000).permitted, true, "must still permit orders just under the limit");
  manager.recordDailyLoss(1);
  const blocked = manager.validateOrderPlacement(1_000);
  assert.equal(blocked.permitted, false, "must deny once cumulative recorded loss reaches the limit");
  assert.match(blocked.reason ?? "", /Daily loss limit exceeded/);
});

test("resetDailyLoss clears a tripped kill switch", () => {
  const manager = new UpbitTradingManager(credentialProvider, "LIVE", { dailyLossLimitKRW: 500_000 });
  manager.recordDailyLoss(600_000);
  assert.equal(manager.validateOrderPlacement(1_000).permitted, false);
  manager.resetDailyLoss();
  assert.equal(manager.validateOrderPlacement(1_000).permitted, true);
});

test("KNOWN GAP: a successful LIVE order does not report its outcome to the daily-loss kill switch", async () => {
  // This test documents -- and will fail loudly the moment it stops being true, in
  // either direction -- that executeOrder() has no path back into recordDailyLoss().
  // Until real fill/cost-basis data is wired in (see the class-level doc comment in
  // upbitTradingManager.ts), the daily-loss limit cannot trip from real trading: a
  // human confirming each LIVE order individually is the only active backstop.
  const manager = new UpbitTradingManager(credentialProvider, "LIVE", { dailyLossLimitKRW: 500_000, minOrderIntervalMs: 0, rateLimitOrdersPerSecond: 10 });
  const restoreFetch = stubFetchOnce({ uuid: "order-1", market: "KRW-BTC", side: "SELL", ordType: "LIMIT", price: 1_000, volume: 1, state: "done", createdAt: new Date().toISOString() });
  try {
    await manager.executeOrder({ market: "KRW-BTC", side: "SELL", ordType: "LIMIT", price: 1_000, volume: 1, mode: "LIVE" });
  } finally {
    restoreFetch();
  }
  assert.equal(
    manager.validateOrderPlacement(1_000).permitted,
    true,
    "dailyLossKRW is still 0 after a completed order -- executeOrder never calls recordDailyLoss. " +
    "If this assertion now fails because executeOrder DOES report losses, update this test (and the " +
    "class-level doc comment) to describe the new, real wiring instead of deleting the coverage."
  );
});
