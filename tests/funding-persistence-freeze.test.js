const test = require("node:test");
const assert = require("node:assert/strict");
const { FUNDING_PERSISTENCE_ALPHA_FREEZE } = require("../dist/apps/cloud/src/alpha/funding/FundingPersistenceFreeze.js");

test("freezes the complete funding persistence v1 research contract", () => {
  assert.equal(FUNDING_PERSISTENCE_ALPHA_FREEZE.alphaId, "FUNDING_PERSISTENCE");
  assert.equal(FUNDING_PERSISTENCE_ALPHA_FREEZE.version, 1);
  assert.equal(FUNDING_PERSISTENCE_ALPHA_FREEZE.status, "FROZEN_FOR_RESEARCH_VALIDATION");
  assert.deepEqual(FUNDING_PERSISTENCE_ALPHA_FREEZE.modules, [
    "FundingPersistenceFeature",
    "FundingPersistenceStrategy",
    "FundingPersistenceBacktest",
    "FundingPersistenceWalkForward",
    "FundingPersistenceStress",
    "FundingPersistencePaper"
  ]);
  assert.ok(Object.isFrozen(FUNDING_PERSISTENCE_ALPHA_FREEZE));
  assert.ok(Object.isFrozen(FUNDING_PERSISTENCE_ALPHA_FREEZE.modules));
  assert.ok(Object.isFrozen(FUNDING_PERSISTENCE_ALPHA_FREEZE.invariants));
  assert.ok(Object.isFrozen(FUNDING_PERSISTENCE_ALPHA_FREEZE.changePolicy));
});

test("keeps live trading and automatic promotion outside the frozen boundary", () => {
  const invariants = new Set(FUNDING_PERSISTENCE_ALPHA_FREEZE.invariants);
  for (const required of [
    "NO_AUTOMATIC_PROMOTION",
    "PAPER_OR_DRY_RUN_ONLY",
    "NO_PRIVATE_EXCHANGE_API",
    "NO_CREDENTIAL_ACCESS",
    "NO_LIVE_ORDER_PATH"
  ]) {
    assert.ok(invariants.has(required), `missing invariant ${required}`);
  }
  assert.equal(FUNDING_PERSISTENCE_ALPHA_FREEZE.changePolicy.safetyBoundaryRelaxationForbidden, true);
  assert.equal(FUNDING_PERSISTENCE_ALPHA_FREEZE.changePolicy.breakingChangesRequireVersionBump, true);
});
