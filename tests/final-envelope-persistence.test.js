const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  EvidenceCompletenessDecision,
  SqliteEvidenceCompletenessAuditRepository,
  SqliteCredentialBoundaryEvidenceRepository,
  SqliteProductionAdapterAttestationRepository,
  SqliteDeploymentAttemptEvidenceRepository,
  SqliteIndependentApprovalEvidenceRepository,
  SqlitePromotionEvidenceRepository,
  DeploymentEvidenceChainVerifier,
  FinalSyntheticReleaseEnvelopeSealer,
  FinalSyntheticReleaseEnvelopeDecision,
  ReleaseCandidatePromotionDecision,
  evaluateIndependentApproval
} = require("../apps/execution/src/index");

const candidateId = "rc-1";
const requirements = [
  { id: "burn-in", present: true, candidateId },
  { id: "certification", present: true, candidateId },
  { id: "deployment-denial", present: true, candidateId }
];
const promotion = { candidateId, decision: ReleaseCandidatePromotionDecision.PROMOTABLE, productionMutationAllowed: false, blockers: [], evaluatedAtMs: 10 };
const productionInput = { environment: "production", endpoint: "https://api.exchange.example", apiKeyPresent: true, apiSecretPresent: true, accountIdentifier: "live-main" };
const cleanInventory = { productionExchangeAdapter: false, liveTradingExecutor: false, realOrderSubmitter: false, capitalMovementAdapter: false };

function wire(db) {
  const audits = new SqliteEvidenceCompletenessAuditRepository(db);
  const boundaries = new SqliteCredentialBoundaryEvidenceRepository(db);
  const attestations = new SqliteProductionAdapterAttestationRepository(db);
  const attempts = new SqliteDeploymentAttemptEvidenceRepository(db);
  const approvals = new SqliteIndependentApprovalEvidenceRepository(db);
  const promotions = new SqlitePromotionEvidenceRepository(db, approvals);
  const chainVerifier = new DeploymentEvidenceChainVerifier(attempts, boundaries, attestations);
  return { audits, boundaries, attestations, attempts, approvals, promotions, sealer: new FinalSyntheticReleaseEnvelopeSealer(promotions, audits, chainVerifier) };
}

function seedDenialChain({ boundaries, attestations, attempts }) {
  boundaries.append({ evaluationId: "cb-1", input: productionInput, nowMs: 5 });
  attestations.append({ attestationId: "at-1", inventory: cleanInventory, nowMs: 6 });
  attempts.append({ attemptId: "d1", candidateId, requestedBy: "operator", blockers: ["DEPLOYMENT_HARD_BLOCK_ACTIVE"], attemptedAtMs: 7, deploymentAllowed: false, productionMutationAllowed: false });
}

function seedPromotion({ approvals, promotions }) {
  const approval = evaluateIndependentApproval({ approvalId: "ap-1", candidateId, requesterId: "r", approverId: "a", verifierId: "v", approved: true, approvedAtMs: 2 });
  approvals.append({ result: approval, requesterId: "r", approverId: "a", verifierId: "v", approved: true });
  promotions.append({ promotionId: "pr-1", promotion, approvalId: "ap-1" });
}

test("completeness audit evidence is append only and derives its own verdict", () => {
  const db = new DatabaseSync(":memory:");
  const { audits } = wire(db);
  const complete = audits.append({ auditId: "au-1", candidateId, requirements, nowMs: 8 });
  assert.equal(complete.decision, EvidenceCompletenessDecision.COMPLETE);
  assert.throws(() => audits.append({ auditId: "au-1", candidateId, requirements, nowMs: 9 }), /duplicate/);

  const empty = audits.append({ auditId: "au-empty", candidateId, requirements: [], nowMs: 9 });
  assert.equal(empty.decision, EvidenceCompletenessDecision.INCOMPLETE, "an audit that checked nothing must not read as complete");
  db.close();
});

test("an audit verdict edited directly in the database is rejected on read", () => {
  const db = new DatabaseSync(":memory:");
  const { audits } = wire(db);
  audits.append({ auditId: "au-bad", candidateId, requirements: [{ id: "burn-in", present: false, candidateId }], nowMs: 8 });
  db.prepare("UPDATE evidence_completeness_audit_evidence SET decision = ? WHERE audit_id = ?").run(EvidenceCompletenessDecision.COMPLETE, "au-bad");
  assert.throws(() => audits.get("au-bad"), /does not match its recorded requirements/);
  db.close();
});

test("envelope sealer refuses to seal when promotion or audit was never recorded", () => {
  const db = new DatabaseSync(":memory:");
  const ctx = wire(db);
  seedDenialChain(ctx);
  const envelope = ctx.sealer.seal({ envelopeId: "env-1", candidateId, promotionId: "pr-1", auditId: "au-1", attemptId: "d1", credentialBoundaryEvaluationId: "cb-1", adapterAttestationId: "at-1", nowMs: 20 });
  assert.equal(envelope.decision, FinalSyntheticReleaseEnvelopeDecision.BLOCKED);
  assert.deepEqual(envelope.blockers, ["EVIDENCE_AUDIT_NOT_RECORDED", "PROMOTION_EVIDENCE_NOT_RECORDED"]);
  assert.equal(envelope.deploymentAllowed, false);
  assert.equal(envelope.productionMutationAllowed, false);
  db.close();
});

test("envelope sealer refuses to seal when the denial chain was never recorded", () => {
  const db = new DatabaseSync(":memory:");
  const ctx = wire(db);
  seedPromotion(ctx);
  ctx.audits.append({ auditId: "au-1", candidateId, requirements, nowMs: 8 });
  const envelope = ctx.sealer.seal({ envelopeId: "env-2", candidateId, promotionId: "pr-1", auditId: "au-1", attemptId: "missing", credentialBoundaryEvaluationId: "missing", adapterAttestationId: "missing", nowMs: 20 });
  assert.equal(envelope.decision, FinalSyntheticReleaseEnvelopeDecision.BLOCKED);
  assert.ok(envelope.blockers.includes("DEPLOYMENT_DENIAL_CHAIN_INVALID"));
  db.close();
});

test("envelope seals only from fully persisted evidence and still grants no authority", () => {
  const db = new DatabaseSync(":memory:");
  const ctx = wire(db);
  seedDenialChain(ctx);
  seedPromotion(ctx);
  ctx.audits.append({ auditId: "au-1", candidateId, requirements, nowMs: 8 });

  const envelope = ctx.sealer.seal({ envelopeId: "env-3", candidateId, promotionId: "pr-1", auditId: "au-1", attemptId: "d1", credentialBoundaryEvaluationId: "cb-1", adapterAttestationId: "at-1", nowMs: 20 });
  assert.equal(envelope.decision, FinalSyntheticReleaseEnvelopeDecision.SEALED_SYNTHETIC_ONLY);
  assert.deepEqual(envelope.blockers, []);
  assert.equal(envelope.deploymentAllowed, false);
  assert.equal(envelope.productionMutationAllowed, false);
  assert.ok(envelope.limitations.includes("NO_REAL_CAPITAL_OR_ORDER_AUTHORITY"));

  // an audit that checked nothing cannot seal the same candidate
  ctx.audits.append({ auditId: "au-empty", candidateId, requirements: [], nowMs: 9 });
  const blocked = ctx.sealer.seal({ envelopeId: "env-4", candidateId, promotionId: "pr-1", auditId: "au-empty", attemptId: "d1", credentialBoundaryEvaluationId: "cb-1", adapterAttestationId: "at-1", nowMs: 21 });
  assert.equal(blocked.decision, FinalSyntheticReleaseEnvelopeDecision.BLOCKED);
  assert.ok(blocked.blockers.includes("EVIDENCE_AUDIT_INCOMPLETE"));
  db.close();
});
