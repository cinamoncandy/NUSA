"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { UPBIT_KRW_SPOT_SPEC, unknownFieldsBlockingSimulation } = require("../dist/apps/cloud/src/researchVenueSpec.js");

test("unverified venue facts block quote simulation (fail closed)", () => {
  assert.deepEqual(unknownFieldsBlockingSimulation(UPBIT_KRW_SPOT_SPEC), ["tickSize", "quantityStep", "minOrderNotional", "makerFeeBp", "takerFeeBp"]);
});
test("a fully verified spec unblocks simulation", () => {
  const v = (value) => ({ status: "VERIFIED", value, sourceUrl: "https://example.test", verifiedAtMs: 1 });
  const spec = { ...UPBIT_KRW_SPOT_SPEC, tickSize: v(1), quantityStep: v(1), minOrderNotional: v(5000), makerFeeBp: v(5), takerFeeBp: v(5) };
  assert.deepEqual(unknownFieldsBlockingSimulation(spec), []);
});
