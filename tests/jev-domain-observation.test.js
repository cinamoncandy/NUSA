const test = require("node:test");
const assert = require("node:assert/strict");

const {
  JEV_TASK_TYPE_POLICIES,
  assertJevTaskTypeRegistry,
  createJevDomainObservation,
  getJevTaskTypePolicy,
} = require("../dist/apps/cloud/src/ai/jevDomainObservation.js");

const FINGERPRINT = "a".repeat(64);

function validInput(overrides = {}) {
  return {
    taskType: "WORKFLOW_FAILURE_CLASSIFICATION",
    inputFingerprint: "sha256:" + FINGERPRINT,
    sourceIdentity: "github:workflow-run:42",
    sourceVersion: "head:" + "b".repeat(40),
    decision: { rootCause: "CODE", severity: 2 },
    requiredModel: "TERRA",
    reasonCode: "SHADOW_CLASSIFIED",
    confidence: 0.91,
    providerId: "jev",
    modelIdentity: "jev-shadow",
    providerModelVersion: "jev-shadow-v1",
    timeoutApplied: true,
    fallbackApplied: false,
    correlationId: "corr:42",
    traceId: "trace:42",
    timestamp: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

test("registry is unique, complete across all NUSA rollout domains, and shadow-only", () => {
  assert.doesNotThrow(() => assertJevTaskTypeRegistry());
  const taskTypes = JEV_TASK_TYPE_POLICIES.map((entry) => entry.taskType);
  assert.equal(new Set(taskTypes).size, taskTypes.length);
  assert.equal(taskTypes.includes("WORKFLOW_FAILURE_CLASSIFICATION"), true);
  assert.equal(taskTypes.includes("RESEARCH_INTELLIGENCE_ATTENTION_SHADOW"), true);

  const domains = new Set(JEV_TASK_TYPE_POLICIES.map((entry) => entry.domain));
  assert.deepEqual(
    [...domains].sort(),
    [
      "AUTOPILOT_DEVELOPMENT",
      "AXIOM_RESEARCH",
      "CORE_EVOLVE",
      "DATA_RESEARCH_INTEGRITY",
      "INFRASTRUCTURE_RUNTIME",
      "INTEGRATION_E2E",
      "MARKET_DATA",
      "OBSERVABILITY_SRE",
      "PAPER_EXECUTION",
      "PAPER_LEDGER",
      "PERFORMANCE_EVIDENCE",
      "PORTFOLIO_RISK",
      "RELEASE_AUDIT",
      "SECURITY_IDENTITY",
      "STRATEGY_FAMILY",
      "STRATEGY_GOVERNANCE",
      "UI_MOBILE",
    ],
  );
  for (const entry of JEV_TASK_TYPE_POLICIES) {
    assert.equal(entry.maxStage, "SHADOW");
    assert.equal(entry.calibrationEvidenceVersion, null);
    assert.ok(entry.canonicalOwner.length > 0);
    for (const forbidden of [
      "PROTECTED_TRANSITION",
      "CANONICAL_TRUTH_MUTATION",
      "SECRET_ACCESS",
      "LIVE_MUTATION",
      "AUDIT_VERDICT",
      "RELEASE_AUTHORIZATION",
      "MERGE",
    ]) {
      assert.equal(entry.forbiddenActions.includes(forbidden), true);
      assert.equal(entry.allowedActions.includes(forbidden), false);
    }
  }
});

test("valid observation is replay-identifiable, ZERO_AUTHORITY, and not usable for routing", () => {
  const observation = createJevDomainObservation(validInput());
  assert.equal(observation.schemaVersion, 1);
  assert.equal(observation.decisionType, "WORKFLOW_FAILURE_CLASSIFICATION");
  assert.equal(observation.domain, "AUTOPILOT_DEVELOPMENT");
  assert.equal(observation.rolloutStage, "SHADOW");
  assert.equal(observation.inputFingerprint, "sha256:" + FINGERPRINT);
  assert.deepEqual(observation.decision, { rootCause: "CODE", severity: 2 });
  assert.equal(observation.usableForRouting, false);
  assert.equal(observation.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(observation.productionMutationAllowed, false);
  assert.equal(observation.liveAuthority, "NONE");
});

test("registry blocks promotion without calibration evidence", () => {
  for (const stage of ["CALIBRATED_ASSIST", "ACTIVE_ROUTING_ADVISORY"]) {
    assert.throws(
      () => createJevDomainObservation(validInput({ rolloutStage: stage })),
      /JEV_STAGE_NOT_APPROVED/,
    );
  }
});

test("observation rejects secret-shaped fields and credential-like values", () => {
  for (const decision of [
    { apiKey: "should-not-enter-observation" },
    { token: "should-not-enter-observation" },
    { note: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { privateKey: "-----BEGIN PRIVATE KEY-----" },
  ]) {
    assert.throws(() => createJevDomainObservation(validInput({ decision })));
  }
});

test("observation validates fingerprint, confidence, reason code, timestamp, and task registration", () => {
  assert.throws(
    () => createJevDomainObservation(validInput({ inputFingerprint: "not-a-hash" })),
    /JEV_INPUT_FINGERPRINT_INVALID/,
  );
  assert.throws(
    () => createJevDomainObservation(validInput({ confidence: 1.1 })),
    /JEV_CONFIDENCE_INVALID/,
  );
  assert.throws(
    () => createJevDomainObservation(validInput({ reasonCode: "not lowercase-safe" })),
    /JEV_REASON_CODE_INVALID/,
  );
  assert.throws(
    () => createJevDomainObservation(validInput({ timestamp: "not-a-date" })),
    /JEV_TIMESTAMP_INVALID/,
  );
  assert.throws(
    () => getJevTaskTypePolicy("UNREGISTERED_TASK"),
    /JEV_TASK_TYPE_UNREGISTERED/,
  );
});

test("research attention policy stays AXIOM-owned and shadow-only", () => {
  const policy = getJevTaskTypePolicy("RESEARCH_INTELLIGENCE_ATTENTION_SHADOW");
  assert.equal(policy.domain, "AXIOM_RESEARCH");
  assert.equal(policy.maxStage, "SHADOW");
  assert.match(policy.canonicalOwner, /Research Intelligence Scout/);
});
