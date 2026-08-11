const test = require("node:test");
const assert = require("node:assert/strict");
const { guardCapitalAllocation, guardCashInvestmentAllocation, createCashInvestmentEnvelope } = require("../dist/apps/mobile/src/capitalAllocationGuard.js");

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

test("cash investment envelope supports 100/0, 60/40, and 0/100", () => {
  assert.deepEqual(createCashInvestmentEnvelope(10_000_000, 100), { exchangeCash: 10_000_000, investmentPercent: 100, reservePercent: 0, investableCash: 10_000_000, reservedCash: 0 });
  assert.deepEqual(createCashInvestmentEnvelope(10_000_000, 60), { exchangeCash: 10_000_000, investmentPercent: 60, reservePercent: 40, investableCash: 6_000_000, reservedCash: 4_000_000 });
  assert.deepEqual(createCashInvestmentEnvelope(10_000_000, 0), { exchangeCash: 10_000_000, investmentPercent: 0, reservePercent: 100, investableCash: 0, reservedCash: 10_000_000 });
});

test("cash envelope rejects invalid and over-allocation inputs", () => {
  for (const value of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => createCashInvestmentEnvelope(100, value), /between 0 and 100/);
  assert.throws(() => guardCashInvestmentAllocation(treasury(), [{ id: "spot", bucket: "SPOT", amount: 651 }], 60), /exceeds deployable capital/);
  const guarded = guardCashInvestmentAllocation(treasury(), [{ id: "spot", bucket: "SPOT", amount: 390 }], 60);
  assert.equal(guarded.cashEnvelope.investableCash, 390);
  assert.equal(guarded.cashEnvelope.reservedCash, 260);
});
