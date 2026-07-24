const test = require("node:test");
const assert = require("node:assert/strict");

const { ORDERBOOK_IMBALANCE_ALPHA_FREEZE } = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceFreeze.js");

test("freezes the complete orderbook imbalance v1 module set", () => {
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.alphaId, "ORDERBOOK_IMBALANCE");
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.version, 1);
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.status, "FROZEN_FOR_RESEARCH_VALIDATION");
  assert.deepEqual(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.modules, [
    "OrderbookImbalanceFeature",
    "OrderbookImbalanceStrategy",
    "OrderbookImbalanceBacktest",
    "OrderbookImbalanceWalkForward",
    "OrderbookImbalanceStress",
    "OrderbookImbalancePaper"
  ]);
  assert.ok(Object.isFrozen(ORDERBOOK_IMBALANCE_ALPHA_FREEZE));
  assert.ok(Object.isFrozen(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.modules));
  assert.ok(Object.isFrozen(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.invariants));
  assert.ok(Object.isFrozen(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.changePolicy));
});

test("keeps execution and safety boundaries immutable", () => {
  const invariants = new Set(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.invariants);
  for (const required of [
    "CHRONOLOGICAL_SNAPSHOTS_ONLY",
    "NEXT_SNAPSHOT_EXECUTION",
    "DETERMINISTIC_REPLAY",
    "FAIL_CLOSED_VALIDATION",
    "NO_AUTOMATIC_PROMOTION",
    "PAPER_OR_DRY_RUN_ONLY",
    "NO_PRIVATE_EXCHANGE_API",
    "NO_CREDENTIAL_ACCESS",
    "NO_LIVE_ORDER_PATH"
  ]) assert.ok(invariants.has(required));

  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.changePolicy.breakingChangesRequireVersionBump, true);
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.changePolicy.safetyBoundaryRelaxationForbidden, true);
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.changePolicy.metricSemanticChangesRequireAudit, true);
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.changePolicy.dataContractChangesRequireMigration, true);
  assert.equal(ORDERBOOK_IMBALANCE_ALPHA_FREEZE.changePolicy.executionModelChangesRequireRevalidation, true);
});
