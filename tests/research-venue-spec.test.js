"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { UPBIT_KRW_SPOT_SPEC, unknownFieldsBlockingSimulation, tickForPrice } = require("../dist/apps/cloud/src/researchVenueSpec.js");

test("unverified venue facts block quote simulation (fail closed)", () => {
  assert.deepEqual(unknownFieldsBlockingSimulation(UPBIT_KRW_SPOT_SPEC), ["quantityStep", "makerFeeBp", "takerFeeBp"]);
  assert.equal(UPBIT_KRW_SPOT_SPEC.minOrderNotional.value, 5000);
  assert.equal(UPBIT_KRW_SPOT_SPEC.listedFeeBp.value, 5);
  assert.equal(UPBIT_KRW_SPOT_SPEC.makerFeeBp.status, "UNKNOWN", "a single listed rate is not a maker/taker split");
});
test("a fully verified spec unblocks simulation", () => {
  const v = (value) => ({ status: "VERIFIED", value, sourceUrl: "https://example.test", verifiedAtMs: 1 });
  const spec = { ...UPBIT_KRW_SPOT_SPEC, quantityStep: v(1), makerFeeBp: v(5), takerFeeBp: v(5) };
  assert.deepEqual(unknownFieldsBlockingSimulation(spec), []);
});

test("tick comes only from the verified bands; invalid prices and unverified bands give undefined", () => {
  const price = (p) => tickForPrice(UPBIT_KRW_SPOT_SPEC, p);
  assert.equal(price(2_500_000), 1000); assert.equal(price(150_000), 100); assert.equal(price(7_000), 5);
  assert.equal(price(15), 0.1); assert.equal(price(0.5), 0.001); assert.equal(price(100), 1); assert.equal(price(99.9), 0.1);
  assert.equal(price(0), undefined); assert.equal(price(Number.NaN), undefined);
  assert.equal(tickForPrice({ ...UPBIT_KRW_SPOT_SPEC, tickBands: { status: "UNKNOWN" } }, 1000), undefined);
});
