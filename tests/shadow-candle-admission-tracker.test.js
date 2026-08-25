const test = require("node:test");
const assert = require("node:assert/strict");

const { ShadowCandleAdmissionTracker } = require("../dist/apps/desktop/src/shadow/shadowCandleAdmissionTracker.js");

const candle = (closeTime, closed = true) => ({
  market: "KRW-BTC",
  openTime: closeTime - 60_000,
  closeTime,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
  closed
});

test("shadow candle admission owns duplicate, ordering, and stale state", () => {
  let now = 1_000_000;
  const tracker = new ShadowCandleAdmissionTracker(120_000, () => now);

  assert.equal(tracker.admit(candle(900_000)), "OK");
  tracker.commit(candle(900_000));
  assert.equal(tracker.admit(candle(900_000)), "DUPLICATE");
  assert.equal(tracker.admit(candle(800_000)), "OUT_OF_ORDER");

  now = 2_000_000;
  assert.equal(tracker.admit(candle(1_000_000)), "STALE");
  assert.equal(tracker.admit(candle(2_000_000, false)), "NOT_CLOSED");

  assert.deepEqual(tracker.snapshot(), {
    lastAdmittedCandleCloseTime: 900_000,
    outOfOrderCandleCount: 1,
    duplicateCandleCount: 1,
    staleCandleCount: 1,
    dispatchedCandleCount: 1
  });
});

test("reset prevents admission state leaking across shadow sessions", () => {
  const tracker = new ShadowCandleAdmissionTracker(undefined, () => 1_000_000);
  const first = candle(900_000);
  assert.equal(tracker.admit(first), "OK");
  tracker.commit(first);
  assert.equal(tracker.admit(first), "DUPLICATE");

  tracker.reset();
  assert.equal(tracker.admit(first), "OK");
  assert.deepEqual(tracker.snapshot(), {
    lastAdmittedCandleCloseTime: undefined,
    outOfOrderCandleCount: 0,
    duplicateCandleCount: 0,
    staleCandleCount: 0,
    dispatchedCandleCount: 0
  });
});
