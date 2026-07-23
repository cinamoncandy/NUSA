const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const execution = require("../dist/apps/execution/src/index.js");

const {
  CertificationRequirementStatus,
  FinalCertificationDecision,
  CertificationImplementationStatus,
  evaluateFinalCertification,
  createReconstructedBaselineInventory
} = execution;

function requirement(id, status, nonWaivable = false) {
  return { id, status, nonWaivable };
}

test("non-waivable failure rejects production authorization", () => {
  const result = evaluateFinalCertification({
    requirements: [requirement("POSITION_RECONCILIATION", CertificationRequirementStatus.NOT_IMPLEMENTED, true)],
    openCriticalFindings: 0,
    openHighFindings: 0,
    productionObserved: false,
    independentReview: "INDEPENDENCE_LIMITED"
  });
  assert.equal(result.decision, FinalCertificationDecision.REJECTED);
  assert.equal(result.productionMutationAllowed, false);
  assert.deepEqual(result.blockingRequirementIds, ["POSITION_RECONCILIATION"]);
});

test("unknown or unverified evidence defers certification", () => {
  const result = evaluateFinalCertification({
    requirements: [requirement("DISASTER_RECOVERY", CertificationRequirementStatus.NOT_VERIFIED)],
    openCriticalFindings: 0,
    openHighFindings: 0,
    productionObserved: false,
    independentReview: "INDEPENDENCE_LIMITED"
  });
  assert.equal(result.decision, FinalCertificationDecision.DEFERRED);
  assert.equal(result.productionMutationAllowed, false);
});

test("limited independence and no production observation cannot produce unrestricted authorization", () => {
  const result = evaluateFinalCertification({
    requirements: [requirement("BASELINE", CertificationRequirementStatus.PASS)],
    openCriticalFindings: 0,
    openHighFindings: 0,
    productionObserved: false,
    independentReview: "INDEPENDENCE_LIMITED"
  });
  assert.equal(result.decision, FinalCertificationDecision.AUTHORIZED_WITH_LIMITATIONS);
  assert.equal(result.productionMutationAllowed, true);
  assert.deepEqual(result.limitations, ["NO_PRODUCTION_OBSERVATION", "INDEPENDENCE_LIMITED"]);
});

test("conflicted review rejects certification even when controls pass", () => {
  const result = evaluateFinalCertification({
    requirements: [requirement("BASELINE", CertificationRequirementStatus.PASS)],
    openCriticalFindings: 0,
    openHighFindings: 0,
    productionObserved: true,
    independentReview: "CONFLICTED"
  });
  assert.equal(result.decision, FinalCertificationDecision.REJECTED);
  assert.equal(result.productionMutationAllowed, false);
});

test("reconstructed baseline inventory never invents implementation evidence", () => {
  const inventory = createReconstructedBaselineInventory();
  assert.equal(inventory.length, 45);
  assert.equal(inventory[0].status, CertificationImplementationStatus.PARTIALLY_IMPLEMENTED);
  assert.equal(inventory[2].status, CertificationImplementationStatus.PARTIALLY_IMPLEMENTED);
  assert.equal(inventory[44].status, CertificationImplementationStatus.NOT_FOUND);
  assert.deepEqual(inventory[44].evidence, []);
});

test("reconstructed baseline inventory never references an evidence path that does not exist on disk", () => {
  const inventory = createReconstructedBaselineInventory();
  const repoRoot = path.resolve(__dirname, "..");
  const missing = [];
  for (const item of inventory) {
    for (const evidencePath of item.evidence) {
      if (!fs.existsSync(path.join(repoRoot, evidencePath))) missing.push(evidencePath);
    }
  }
  assert.deepEqual(missing, [], `phantom evidence paths that do not exist on disk: ${missing.join(", ")}`);
});
