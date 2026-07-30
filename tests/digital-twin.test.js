const test = require("node:test");
const assert = require("node:assert/strict");
const { createDigitalTwin } = require("../dist/apps/cloud/src/digitalTwin.js");

const input = (overrides = {}) => ({ twinId: "twin-1", sourceSnapshotId: "snap-1", observedAt: 100, regime: "RANGING", price: 100, volatility: 0.2, liquidity: 0.8, simulated: true, ...overrides });

test("digital twin is explicitly simulated and non-authoritative", () => {
  const twin = createDigitalTwin(input(), 200);
  assert.equal(twin.provenance, "WORLD_MODEL");
  assert.equal(twin.productionMutationAllowed, false);
  assert.equal(Object.isFrozen(twin), true);
});

test("real-world mutation path is rejected", () => {
  assert.throws(() => createDigitalTwin(input({ simulated: false }), 200), /explicitly simulated/);
});
