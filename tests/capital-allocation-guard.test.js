const test = require("node:test");
const assert = require("node:assert/strict");
const { guardCapitalAllocation } = require("../dist/apps/mobile/src/capitalAllocationGuard.js");

const treasury = (overrides = {}) => ({
  totalAssets: 1_000,
  tradingCapital: 700,
  reserveCapital: 200,
  pendingDepositCapital: 50,
  reservations: [],
  reservedWithdrawalCapital: 50,
  deployableCapital: 650,
  activeReservations: [],
  ...overrides
});

test("allocates spot and futures only from deployable capital", () => {
  const result = guardCapitalAllocation(treasury(), [
    { id: "spot-btc", bucket: "SPOT", amount: 300 },
    { id: "futures-btc", bucket: "FUTURES", amount: 200 }
  ]);
  assert.equal(result.allocatedCapital, 500);
  assert.equal(result.remainingCash, 150);
  assert.equal(result.protectedCapital, 300);
});

test("rejects allocation that invades protected capital", () => {
  assert.throws(() => guardCapitalAllocation(treasury(), [
    { id: "spot", bucket: "SPOT", amount: 500 },
    { id: "futures", bucket: "FUTURES", amount: 200 }
  ]), /exceeds deployable capital/);
});

test("empty allocation leaves all deployable capital as cash", () => {
  const result = guardCapitalAllocation(treasury(), []);
  assert.equal(result.allocatedCapital, 0);
  assert.equal(result.remainingCash, 650);
});

test("duplicate ids fail closed", () => {
  assert.throws(() => guardCapitalAllocation(treasury(), [
    { id: "same", bucket: "SPOT", amount: 100 },
    { id: "same", bucket: "FUTURES", amount: 100 }
  ]), /duplicate allocation id/);
});

test("invalid money fails closed", () => {
  assert.throws(() => guardCapitalAllocation(treasury(), [
    { id: "spot", bucket: "SPOT", amount: Number.NaN }
  ]), /finite non-negative/);
});

test("same logical input produces stable ordering and output", () => {
  const left = guardCapitalAllocation(treasury(), [
    { id: "z", bucket: "SPOT", amount: 100 },
    { id: "a", bucket: "FUTURES", amount: 200 }
  ]);
  const right = guardCapitalAllocation(treasury(), [
    { id: "a", bucket: "FUTURES", amount: 200 },
    { id: "z", bucket: "SPOT", amount: 100 }
  ]);
  assert.deepEqual(left, right);
  assert.ok(Object.isFrozen(left));
  assert.ok(Object.isFrozen(left.allocations));
});
