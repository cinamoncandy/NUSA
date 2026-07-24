const test = require("node:test");
const assert = require("node:assert/strict");
const {
  protectWithdrawalCapital,
  reserveWithdrawal,
  releaseWithdrawalReservation
} = require("../dist/apps/mobile/src/withdrawalReservation.js");

const reservation = (overrides = {}) => ({
  id: "withdrawal-1",
  amount: 200,
  currency: "krw",
  requestedAt: 1_000,
  targetAt: 2_000,
  status: "RESERVED",
  ...overrides
});

const state = (overrides = {}) => ({
  totalAssets: 1_000,
  tradingCapital: 700,
  reserveCapital: 200,
  pendingDepositCapital: 100,
  reservations: [],
  ...overrides
});

test("1 reserves withdrawal capital immediately", () => {
  const result = reserveWithdrawal(state(), reservation());
  assert.equal(result.reservedWithdrawalCapital, 200);
  assert.equal(result.deployableCapital, 500);
  assert.equal(result.activeReservations.length, 1);
});

test("2 released reservations return capital to deployable balance", () => {
  const reserved = reserveWithdrawal(state(), reservation());
  const result = releaseWithdrawalReservation(reserved, "withdrawal-1");
  assert.equal(result.reservedWithdrawalCapital, 0);
  assert.equal(result.deployableCapital, 700);
  assert.equal(result.reservations[0].status, "RELEASED");
});

test("3 completed reservations are not active", () => {
  const result = protectWithdrawalCapital(state({ reservations: [reservation({ status: "COMPLETED" })] }));
  assert.equal(result.reservedWithdrawalCapital, 0);
  assert.equal(result.deployableCapital, 700);
});

test("4 active reservations are sorted deterministically", () => {
  const result = protectWithdrawalCapital(state({
    reservations: [
      reservation({ id: "b", amount: 100, requestedAt: 2_000, targetAt: 2_000 }),
      reservation({ id: "a", amount: 100, requestedAt: 1_000 })
    ]
  }));
  assert.deepEqual(result.activeReservations.map((item) => item.id), ["a", "b"]);
});

test("5 duplicate reservation ids fail closed", () => {
  assert.throws(() => protectWithdrawalCapital(state({
    reservations: [reservation(), reservation({ amount: 100 })]
  })), /duplicate reservation id/);
});

test("6 reservations cannot exceed trading capital", () => {
  assert.throws(() => protectWithdrawalCapital(state({
    reservations: [reservation({ amount: 701 })]
  })), /exceeds trading capital/);
});

test("7 treasury totals must reconcile", () => {
  assert.throws(() => protectWithdrawalCapital(state({ totalAssets: 999 })), /does not reconcile/);
});

test("8 invalid timestamps and amounts fail closed", () => {
  assert.throws(() => reserveWithdrawal(state(), reservation({ amount: 0 })), /greater than zero/);
  assert.throws(() => reserveWithdrawal(state(), reservation({ targetAt: 999 })), /not earlier/);
});

test("9 releasing an unknown or inactive reservation fails closed", () => {
  assert.throws(() => releaseWithdrawalReservation(state(), "missing"), /unknown reservation/);
  assert.throws(() => releaseWithdrawalReservation(state({
    reservations: [reservation({ status: "RELEASED" })]
  }), "withdrawal-1"), /not active/);
});

test("10 same input produces the same immutable result", () => {
  const input = state({ reservations: [reservation()] });
  const first = protectWithdrawalCapital(input);
  const second = protectWithdrawalCapital(input);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.activeReservations));
});
