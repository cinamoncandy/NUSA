const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AgentRole,
  AgentRunStatus,
  AgentStatus,
  EvidenceQuality,
  MultiAgentGovernanceEventType
} = require("../dist/packages/contracts/src/multiAgentGovernance.js");
const {
  appendMultiAgentGovernanceEvent,
  assessAgentIndependence,
  createAgentContextSnapshot,
  createAgentDefinition,
  createMultiAgentIncident,
  evaluateAgentCalibration,
  evaluateMultiAgentCertification,
  evaluateMultiAgentContainment,
  evaluateMultiAgentDecision,
  registerAgentDefinition,
  replayMultiAgentGovernance
} = require("../dist/apps/cloud/src/multiAgentGovernance.js");
const { SqliteDatabase, SqliteMultiAgentGovernanceStore } = require("../dist/packages/storage/src/index.js");

const digest = "a".repeat(64);
const digestFor = (value) => (value.split("").reduce((total, character) => total + character.charCodeAt(0), 0) % 16).toString(16).repeat(64);
const agent = (role, id, overrides = {}) => createAgentDefinition({
  agentId: id, name: id, role, definitionVersion: "1.0.0", modelVersionId: `model-${id}`, modelCertificationId: `cert-${id}`, promptArtifactId: `prompt-${id}`, promptArtifactDigest: digestFor(id), inputSchemaId: `in-${role}`, outputSchemaId: `out-${role}`, allowedEvidenceClasses: ["market-data"], allowedToolCapabilities: ["READ_EVIDENCE"], contextIsolationPolicyId: `isolation-${id}`, timeoutPolicyId: "bounded", correlatedGroupId: `group-${id}`, status: AgentStatus.ACTIVE, ...overrides
});
const contract = (role, output) => ({ contractId: `contract-${role}`, role, requiredInputs: ["context"], permittedOutputs: [output], prohibitedOutputs: ["order", "transfer", "credential"], evidenceRequirements: ["verified"], timeoutBehavior: "incomplete", fallbackPolicyId: "fail-closed", status: "active" });
const evidence = () => [{ evidenceId: "e-1", evidenceType: "market-data", sourceReference: "fixture", observedAt: 1, validUntil: 100, quality: EvidenceQuality.VERIFIED, contentDigest: digest, lineageReferences: [] }];
const context = (agentId, suffix, overrides = {}) => createAgentContextSnapshot({ contextSnapshotId: `context-${suffix}`, agentId, evidenceIds: ["e-1"], policyVersionIds: ["policy-1"], certificationIds: ["cert-1"], controlPlaneStateId: "control-1", createdAt: 1, validUntil: 100, ...overrides });
const run = (definition, snapshot, suffix) => ({ agentRunId: `run-${suffix}`, agentId: definition.agentId, orchestrationRunId: "orchestration-1", agentDefinitionVersion: definition.definitionVersion, modelVersionId: definition.modelVersionId, promptArtifactDigest: definition.promptArtifactDigest, contextSnapshotId: snapshot.contextSnapshotId, inputHash: digest, outputHash: "b".repeat(64), status: AgentRunStatus.COMPLETED, schemaValidationPassed: true, evidenceValidationPassed: true, startedAt: 2, completedAt: 3 });

function input(overrides = {}) {
  const producer = agent(AgentRole.EVIDENCE_PRODUCER, "evidence");
  const proposer = agent(AgentRole.STRATEGY_PROPOSER, "proposer");
  const critic = agent(AgentRole.ADVERSARIAL_CRITIC, "critic");
  const verifier = agent(AgentRole.RISK_VERIFIER, "verifier");
  const contexts = [context("evidence", "evidence"), context("proposer", "proposer"), context("critic", "critic"), context("verifier", "verifier")];
  const proposal = { proposalId: "proposal-1", agentRunId: "run-proposer", strategyVersionId: "strategy-1", decision: "candidate", rationaleClaims: ["verified market state"], evidenceReferences: ["e-1"], assumptions: [], uncertainty: "low", proposalHash: "c".repeat(64) };
  return {
    decisionId: "decision-1", evaluatedAt: 10, agents: [producer, proposer, critic, verifier], roleContracts: [contract(AgentRole.EVIDENCE_PRODUCER, "evidence_assessment"), contract(AgentRole.STRATEGY_PROPOSER, "strategy_proposal"), contract(AgentRole.ADVERSARIAL_CRITIC, "adversarial_review"), contract(AgentRole.RISK_VERIFIER, "risk_verification")], evidence: evidence(), contexts,
    runs: [run(producer, contexts[0], "evidence"), run(proposer, contexts[1], "proposer"), run(critic, contexts[2], "critic"), run(verifier, contexts[3], "verifier")],
    evidenceAssessment: { evidenceAssessmentId: "assessment-1", agentRunId: "run-evidence", observations: [{ claim: "market is available", claimType: "fact", evidenceReferences: ["e-1"], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: digest },
    proposal,
    adversarialReview: { reviewId: "review-1", agentRunId: "run-critic", reviewedProposalHash: proposal.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low", reviewHash: "d".repeat(64) },
    riskVerification: { verificationId: "risk-1", agentRunId: "run-verifier", result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"], evidenceReferences: ["e-1"], verificationHash: "e".repeat(64) },
    disagreements: [], controlVetoReasons: [], ...overrides
  };
}

function certificationInput(overrides = {}) {
  const decisionInput = input();
  return {
    certificationId: "certification-1",
    issuedAt: 10,
    orchestrationPolicyId: "orchestration-policy-1",
    agents: decisionInput.agents,
    roleContracts: decisionInput.roleContracts,
    agentDefinitionIds: decisionInput.agents.map((item) => item.agentId).sort(),
    modelCertificationIds: decisionInput.agents.map((item) => item.modelCertificationId).sort(),
    roleContractIds: decisionInput.roleContracts.map((item) => item.contractId).sort(),
    contextIsolationPolicyId: "isolated-context-v1",
    decisionPolicyId: "MULTI_AGENT_ZERO_AUTHORITY_V1",
    calibrationPolicyId: "calibration-v1",
    evidenceValidationPolicyId: "evidence-v1",
    roleSeparationPassed: true,
    contextIsolationPassed: true,
    evidenceValidationPassed: true,
    vetoSemanticsPassed: true,
    deterministicAggregationPassed: true,
    calibrationPassed: true,
    correlatedErrorAssessmentPassed: true,
    replayPassed: true,
    evidenceComplete: true,
    evidenceReferences: ["e-1"],
    evidence: decisionInput.evidence,
    evidenceBundleHash: digest,
    ...overrides
  };
}

const event = (type, payload, occurredAt) => ({ eventId: `${type}-${occurredAt}`, type, occurredAt, payload, evidenceHash: digest });

test("registry rejects authority-bearing capabilities and preserves version idempotency", () => {
  assert.throws(() => agent(AgentRole.EVIDENCE_PRODUCER, "unsafe", { allowedToolCapabilities: ["ORDER"] }), /zero-authority/);
  const first = agent(AgentRole.EVIDENCE_PRODUCER, "registry");
  const registry = new Map([["registry@1.0.0", first]]);
  assert.equal(registerAgentDefinition(registry, first), first);
  assert.throws(() => registerAgentDefinition(registry, { ...first, name: "different" }), /conflict/);
});

test("independent completed roles produce only a deterministic preview without authority", () => {
  const first = evaluateMultiAgentDecision(input());
  const second = evaluateMultiAgentDecision(input());
  assert.equal(first.result, "preview_candidate");
  assert.equal(first.realOrderAuthority, false);
  assert.equal(first.realTransferAuthority, false);
  assert.equal(first.productionMutationAllowed, false);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(first, second);
});

test("risk veto and fabricated evidence cannot be outvoted by other agent outputs", () => {
  const denied = evaluateMultiAgentDecision(input({ riskVerification: { ...input().riskVerification, result: "denied", hardDenies: ["RISK_LIMIT"] } }));
  assert.equal(denied.result, "deny");
  assert.ok(denied.vetoReasons.includes("RISK_LIMIT"));
  const fabricated = evaluateMultiAgentDecision(input({ proposal: { ...input().proposal, evidenceReferences: ["does-not-exist"] } }));
  assert.equal(fabricated.result, "deny");
  assert.ok(fabricated.vetoReasons.includes("EVIDENCE_INTEGRITY_FAILURE"));
});

test("context isolation, freshness, role contracts, and correlated roles fail closed", () => {
  const stale = input(); stale.contexts[3] = context("verifier", "verifier", { validUntil: 10 });
  assert.equal(evaluateMultiAgentDecision(stale).result, "incomplete");
  const correlated = input(); correlated.agents[3] = agent(AgentRole.RISK_VERIFIER, "verifier", { correlatedGroupId: "group-proposer" });
  assert.equal(evaluateMultiAgentDecision(correlated).result, "incomplete");
  const invalidContract = input({ roleContracts: input().roleContracts.map(item => item.role === AgentRole.RISK_VERIFIER ? { ...item, status: "revoked" } : item) });
  assert.equal(evaluateMultiAgentDecision(invalidContract).result, "incomplete");
});

test("calibration and independence diagnostics are deterministic and do not create decision weight", () => {
  const calibrated = evaluateAgentCalibration("proposer", "window-1", [{ predictedConfidence: 0.9, correct: true }, { predictedConfidence: 0.1, correct: false }], 2, 0.2);
  assert.equal(calibrated.calibrationStatus, "calibrated");
  const degraded = evaluateAgentCalibration("proposer", "window-1", [{ predictedConfidence: 1, correct: false }, { predictedConfidence: 1, correct: false }], 2, 0.2);
  assert.equal(degraded.calibrationStatus, "degraded");
  assert.equal(assessAgentIndependence([agent(AgentRole.EVIDENCE_PRODUCER, "a", { correlatedGroupId: "same" }), agent(AgentRole.RISK_VERIFIER, "b", { correlatedGroupId: "same" })]).independent, false);
});

test("critical multi-agent incidents recommend containment without creating runtime authority", () => {
  const critical = createMultiAgentIncident({
    incidentId: "incident-1",
    type: "fabricated_evidence",
    severity: "critical",
    affectedAgentIds: ["proposer"],
    orchestrationPolicyId: "orchestration-policy-1",
    detectedAt: 10,
    evidenceReferences: ["e-1"],
    status: "detected",
    containmentRequired: true
  });
  const contained = evaluateMultiAgentContainment(critical);
  assert.equal(contained.action, "contain");
  assert.deepEqual(contained.agentIdsToSuspend, ["proposer"]);
  assert.equal(contained.orchestrationPolicySuspended, true);
  assert.equal(contained.productionMutationAllowed, false);
  assert.ok(Object.isFrozen(contained));

  const low = evaluateMultiAgentContainment(createMultiAgentIncident({ ...critical, incidentId: "incident-2", type: "model_mismatch", severity: "low", containmentRequired: false }));
  assert.equal(low.action, "no_action");
  assert.equal(low.orchestrationPolicySuspended, false);
});

test("multi-agent certification is deterministic and can only certify zero-authority controls", () => {
  const certified = evaluateMultiAgentCertification(certificationInput());
  assert.equal(certified.status, "certified_zero_authority");
  assert.equal(certified.realOrderAuthority, false);
  assert.equal(certified.realTransferAuthority, false);
  assert.equal(certified.productionMutationAllowed, false);
  assert.ok(Object.isFrozen(certified));
  assert.deepEqual(certified, evaluateMultiAgentCertification(certificationInput()));

  const failed = evaluateMultiAgentCertification(certificationInput({ certificationId: "certification-2", calibrationPassed: false }));
  assert.equal(failed.status, "failed");
  assert.ok(failed.failureReasons.includes("CONTROL_FAILED:calibrationPassed"));

  const missingEvidence = evaluateMultiAgentCertification(certificationInput({ certificationId: "certification-3", evidenceReferences: [] }));
  assert.equal(missingEvidence.status, "failed");
  assert.ok(missingEvidence.failureReasons.includes("CERTIFICATION_EVIDENCE_MISSING"));
});

test("multi-agent ledger and SQLite state replay deterministically and reject tampering", () => {
  const decision = evaluateMultiAgentDecision(input()); const registered = agent(AgentRole.EVIDENCE_PRODUCER, "ledger"); const snapshot = context("ledger", "ledger");
  const first = appendMultiAgentGovernanceEvent([], event(MultiAgentGovernanceEventType.AGENT_REGISTERED, { agent: registered }, 1));
  const second = appendMultiAgentGovernanceEvent(first, event(MultiAgentGovernanceEventType.AGENT_EVIDENCE_REGISTERED, { evidence: evidence()[0] }, 2));
  const third = appendMultiAgentGovernanceEvent(second, event(MultiAgentGovernanceEventType.AGENT_CONTEXT_SNAPSHOT_CREATED, { context: snapshot }, 3));
  const decisionRecords = appendMultiAgentGovernanceEvent(third, event(MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_EVALUATED, { decision }, 4));
  const incident = createMultiAgentIncident({ incidentId: "ledger-incident", type: "fabricated_evidence", severity: "critical", affectedAgentIds: ["ledger"], orchestrationPolicyId: "orchestration-policy-1", detectedAt: 5, evidenceReferences: ["e-1"], status: "detected", containmentRequired: true });
  const containment = evaluateMultiAgentContainment(incident);
  const opened = appendMultiAgentGovernanceEvent(decisionRecords, event(MultiAgentGovernanceEventType.MULTI_AGENT_INCIDENT_OPENED, { incident }, 5));
  const contained = appendMultiAgentGovernanceEvent(opened, event(MultiAgentGovernanceEventType.MULTI_AGENT_INCIDENT_CONTAINED, { incidentId: incident.incidentId, containment }, 6));
  const certification = evaluateMultiAgentCertification(certificationInput());
  const records = appendMultiAgentGovernanceEvent(contained, event(MultiAgentGovernanceEventType.MULTI_AGENT_CERTIFICATION_ISSUED_ZERO_AUTHORITY, { certification }, 7));
  assert.equal(replayMultiAgentGovernance(records).decisions.get("decision-1").decisionHash, decision.decisionHash);
  assert.equal(replayMultiAgentGovernance(records).containments.get(incident.incidentId).action, "contain");
  assert.equal(replayMultiAgentGovernance(records).certifications.get(certification.certificationId).status, "certified_zero_authority");
  assert.throws(() => replayMultiAgentGovernance([{ ...records[0], hash: "0".repeat(64) }]), /integrity/);
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqliteMultiAgentGovernanceStore(db);
    store.append(event(MultiAgentGovernanceEventType.AGENT_REGISTERED, { agent: registered }, 1));
    store.append(event(MultiAgentGovernanceEventType.AGENT_EVIDENCE_REGISTERED, { evidence: evidence()[0] }, 2));
    store.append(event(MultiAgentGovernanceEventType.AGENT_CONTEXT_SNAPSHOT_CREATED, { context: snapshot }, 3));
    store.append(event(MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_EVALUATED, { decision }, 4));
    store.append(event(MultiAgentGovernanceEventType.MULTI_AGENT_INCIDENT_OPENED, { incident }, 5));
    store.append(event(MultiAgentGovernanceEventType.MULTI_AGENT_INCIDENT_CONTAINED, { incidentId: incident.incidentId, containment }, 6));
    store.append(event(MultiAgentGovernanceEventType.MULTI_AGENT_CERTIFICATION_ISSUED_ZERO_AUTHORITY, { certification }, 7));
    store.verify();
    db.connection.prepare("UPDATE multi_agent_governance_state SET ledger_hash=? WHERE id=1").run("0".repeat(64));
    assert.throws(() => store.verify(), /snapshot mismatch/);
  } finally { db.close(); }
});
