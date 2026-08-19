const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  CredentialBoundaryDecision,
  SqliteCredentialBoundaryEvidenceRepository,
  ProductionAdapterAttestationDecision,
  SqliteProductionAdapterAttestationRepository,
  SqliteDeploymentAttemptEvidenceRepository,
  DeploymentEvidenceChainVerifier,
  DeploymentEvidenceChainDecision
} = require('../dist/apps/execution/src/index.js');

const productionInput = { environment: "production", endpoint: "https://api.exchange.example", apiKeyPresent: true, apiSecretPresent: true, accountIdentifier: "live-main" };
const cleanInventory = { productionExchangeAdapter: false, liveTradingExecutor: false, realOrderSubmitter: false, capitalMovementAdapter: false };
const attempt = { attemptId: "d1", candidateId: "rc-1", requestedBy: "operator", blockers: ["DEPLOYMENT_HARD_BLOCK_ACTIVE"], attemptedAtMs: 3, deploymentAllowed: false, productionMutationAllowed: false };

function seed(db) {
  const boundaries = new SqliteCredentialBoundaryEvidenceRepository(db);
  const attestations = new SqliteProductionAdapterAttestationRepository(db);
  const attempts = new SqliteDeploymentAttemptEvidenceRepository(db);
  return { boundaries, attestations, attempts, verifier: new DeploymentEvidenceChainVerifier(attempts, boundaries, attestations) };
}

test("credential boundary evidence derives its own verdict and is append only", () => {
  const db = new DatabaseSync(":memory:");
  const { boundaries } = seed(db);
  const stored = boundaries.append({ evaluationId: "cb-1", input: productionInput, nowMs: 5 });
  assert.equal(stored.decision, CredentialBoundaryDecision.BLOCK);
  assert.equal(stored.productionMutationAllowed, false);
  assert.ok(stored.blockers.includes("PRODUCTION_CREDENTIAL_DETECTED"));
  assert.throws(() => boundaries.append({ evaluationId: "cb-1", input: productionInput, nowMs: 6 }), /duplicate/);
  db.close();
});

test("a credential boundary verdict edited directly in the database is rejected on read", () => {
  const db = new DatabaseSync(":memory:");
  const { boundaries } = seed(db);
  boundaries.append({ evaluationId: "cb-1", input: productionInput, nowMs: 5 });
  // flip a real BLOCK into a forged ALLOW_SYNTHETIC without changing the recorded inputs
  db.prepare("UPDATE credential_boundary_evidence SET decision = ? WHERE evaluation_id = ?").run(CredentialBoundaryDecision.ALLOW_SYNTHETIC, "cb-1");
  assert.throws(() => boundaries.get("cb-1"), /does not match its recorded inputs/);
  db.close();
});

test("adapter attestation evidence recomputes from the stored inventory", () => {
  const db = new DatabaseSync(":memory:");
  const { attestations } = seed(db);
  const ok = attestations.append({ attestationId: "at-1", inventory: cleanInventory, nowMs: 5 });
  assert.equal(ok.decision, ProductionAdapterAttestationDecision.ATTESTED);
  const bad = attestations.append({ attestationId: "at-2", inventory: { ...cleanInventory, realOrderSubmitter: true }, nowMs: 6 });
  assert.equal(bad.decision, ProductionAdapterAttestationDecision.FAILED);
  // forging ATTESTED over an inventory that contains a real order submitter is caught on read
  db.prepare("UPDATE production_adapter_attestation_evidence SET decision = ? WHERE attestation_id = ?").run(ProductionAdapterAttestationDecision.ATTESTED, "at-2");
  assert.throws(() => attestations.get("at-2"), /does not match its recorded inventory/);
  db.close();
});

test("chain verifier refuses to certify evidence that was never recorded", () => {
  const db = new DatabaseSync(":memory:");
  const { verifier } = seed(db);
  const result = verifier.verify({ attemptId: "d1", credentialBoundaryEvaluationId: "cb-1", adapterAttestationId: "at-1", expectedCandidateId: "rc-1", nowMs: 10 });
  assert.equal(result.decision, DeploymentEvidenceChainDecision.INVALID);
  assert.deepEqual(result.blockers, [
    "CREDENTIAL_BOUNDARY_EVIDENCE_NOT_RECORDED",
    "DEPLOYMENT_ATTEMPT_EVIDENCE_NOT_RECORDED",
    "PRODUCTION_ADAPTER_ATTESTATION_NOT_RECORDED"
  ]);
  assert.equal(result.deploymentAllowed, false);
  assert.equal(result.productionMutationAllowed, false);
  db.close();
});

test("chain verifier certifies a blocked deployment only from fully persisted evidence", () => {
  const db = new DatabaseSync(":memory:");
  const { boundaries, attestations, attempts, verifier } = seed(db);
  boundaries.append({ evaluationId: "cb-1", input: productionInput, nowMs: 5 });
  attestations.append({ attestationId: "at-1", inventory: cleanInventory, nowMs: 6 });
  attempts.append(attempt);

  const result = verifier.verify({ attemptId: "d1", credentialBoundaryEvaluationId: "cb-1", adapterAttestationId: "at-1", expectedCandidateId: "rc-1", nowMs: 10 });
  assert.equal(result.decision, DeploymentEvidenceChainDecision.COMPLETE_BLOCKED);
  assert.equal(result.deploymentAllowed, false);
  assert.equal(result.productionMutationAllowed, false);

  // a synthetic-only boundary genuinely did not block, so it cannot complete the denial chain
  boundaries.append({ evaluationId: "cb-synth", input: { environment: "synthetic", endpoint: "http://localhost/synthetic", apiKeyPresent: false, apiSecretPresent: false, accountIdentifier: "synthetic-test" }, nowMs: 7 });
  const notBlocked = verifier.verify({ attemptId: "d1", credentialBoundaryEvaluationId: "cb-synth", adapterAttestationId: "at-1", expectedCandidateId: "rc-1", nowMs: 11 });
  assert.equal(notBlocked.decision, DeploymentEvidenceChainDecision.INVALID);
  assert.ok(notBlocked.blockers.includes("CREDENTIAL_BOUNDARY_DID_NOT_BLOCK"));
  db.close();
});
