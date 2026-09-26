const test = require("node:test");
const assert = require("node:assert/strict");

const {
  JEV_TASK_TYPE_POLICIES,
  assertJevTaskTypeRegistry,
  createJevDomainObservation,
  getJevTaskTypePolicy,
} = require("../dist/apps/cloud/src/ai/jevDomainObservation.js");

const FINGERPRINT = "a".repeat(64);

function workflowInput(overrides = {}) {
  return {
    taskType: "WORKFLOW_FAILURE_CLASSIFICATION",
    inputFingerprint: FINGERPRINT.toUpperCase(),
    sourceIdentity: "github:workflow-run:42",
    sourceVersion: "head:" + "b".repeat(40),
    decision: {
      rootCause: "CODE",
      safeToAutofix: "NO",
      severity: 2,
      requiredModel: "TERRA",
      confidence: 0.91,
    },
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

function researchInput(overrides = {}) {
  return {
    ...workflowInput(),
    taskType: "RESEARCH_INTELLIGENCE_ATTENTION_SHADOW",
    decision: {
      decision: "REVIEW_SOON",
      confidence: 0.8,
      reasonCode: "RELEVANT_PRIMARY_SOURCE",
    },
    requiredModel: "LUNA",
    reasonCode: "RELEVANT_PRIMARY_SOURCE",
    confidence: 0.8,
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

test("existing workflow policy preserves the receipt action vocabulary", () => {
  const policy = getJevTaskTypePolicy("WORKFLOW_FAILURE_CLASSIFICATION");
  assert.deepEqual(policy.allowedActions, ["OBSERVE", "ESCALATE"]);
  assert.equal(policy.decisionSchema, "WORKFLOW_FAILURE_V1");
});

test("valid workflow observation is canonical, ZERO_AUTHORITY, and shadow-only", () => {
  const observation = createJevDomainObservation(workflowInput());
  assert.equal(observation.schemaVersion, 1);
  assert.equal(observation.decisionType, "WORKFLOW_FAILURE_CLASSIFICATION");
  assert.equal(observation.domain, "AUTOPILOT_DEVELOPMENT");
  assert.equal(observation.rolloutStage, "SHADOW");
  assert.equal(observation.inputFingerprint, "sha256:" + FINGERPRINT);
  assert.deepEqual(observation.decision, {
    rootCause: "CODE",
    safeToAutofix: "NO",
    severity: 2,
    requiredModel: "TERRA",
    confidence: 0.91,
  });
  assert.equal(observation.timestamp, "2026-09-27T00:00:00.000Z");
  assert.equal(observation.usableForRouting, false);
  assert.equal(observation.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(observation.productionMutationAllowed, false);
  assert.equal(observation.liveAuthority, "NONE");
});

test("research attention observation reuses its existing validator", () => {
  const observation = createJevDomainObservation(researchInput());
  assert.equal(observation.domain, "AXIOM_RESEARCH");
  assert.deepEqual(observation.decision, {
    decision: "REVIEW_SOON",
    confidence: 0.8,
    reasonCode: "RELEVANT_PRIMARY_SOURCE",
  });
  assert.equal(observation.usableForRouting, false);
});

test("planned task types cannot emit observations before a decision validator exists", () => {
  assert.equal(getJevTaskTypePolicy("RISK_EVENT_CLASSIFICATION").decisionSchema, "UNAVAILABLE");
  assert.throws(
    () =>
      createJevDomainObservation(
        workflowInput({ taskType: "RISK_EVENT_CLASSIFICATION" }),
      ),
    /JEV_TASK_DECISION_VALIDATOR_UNAVAILABLE/,
  );
});

test("task-specific validators reject semantically invalid decisions", () => {
  assert.throws(
    () =>
      createJevDomainObservation(
        workflowInput({
          decision: {
            rootCause: "NOT_REAL",
            safeToAutofix: "NO",
            severity: -1,
            requiredModel: "TERRA",
            confidence: 0.91,
          },
        }),
      ),
    /Jev shadow/,
  );
  assert.throws(
    () =>
      createJevDomainObservation(
        researchInput({
          decision: {
            decision: "PROMOTE",
            confidence: 0.8,
            reasonCode: "RELEVANT_PRIMARY_SOURCE",
          },
        }),
      ),
    /Jev attention shadow decision invalid/,
  );
});

test("envelope metadata cannot contradict validated decision confidence/model/reason", () => {
  assert.throws(
    () => createJevDomainObservation(workflowInput({ confidence: 0.4 })),
    /JEV_DECISION_ENVELOPE_MISMATCH/,
  );
  assert.throws(
    () => createJevDomainObservation(workflowInput({ requiredModel: "SOL" })),
    /JEV_DECISION_ENVELOPE_MISMATCH/,
  );
  assert.throws(
    () => createJevDomainObservation(researchInput({ reasonCode: "DIFFERENT" })),
    /JEV_DECISION_ENVELOPE_MISMATCH/,
  );
});

test("registry blocks invalid or uncalibrated rollout stages", () => {
  assert.throws(
    () => createJevDomainObservation(workflowInput({ rolloutStage: "BOGUS" })),
    /JEV_STAGE_INVALID/,
  );
  for (const stage of ["CALIBRATED_ASSIST", "ACTIVE_ROUTING_ADVISORY"]) {
    assert.throws(
      () => createJevDomainObservation(workflowInput({ rolloutStage: stage })),
      /JEV_STAGE_NOT_APPROVED/,
    );
  }
});

test("observation rejects secret-shaped fields and credential-like values", () => {
  const join = (...parts) => parts.join("");
  const sensitiveValue = join("Bear", "er ", "abcdefghijklmnopqrstuvwxyz");
  const keyMaterial = join("-----BEGIN ", "PRIVATE", " KEY-----");
  for (const [field, value] of [
    [join("api", "Key"), "redacted-fixture"],
    [join("to", "ken"), "redacted-fixture"],
    ["note", sensitiveValue],
    [join("private", "Key"), keyMaterial],
  ]) {
    assert.throws(() =>
      createJevDomainObservation(
        workflowInput({
          decision: {
            rootCause: "CODE",
            safeToAutofix: "NO",
            severity: 2,
            requiredModel: "TERRA",
            confidence: 0.91,
            [field]: value,
          },
        }),
      ),
    );
  }
});

test("observation rejects credential-shaped values in every common string metadata field", () => {
  const sensitiveValue = ["Bear", "er ", "abcdefghijklmnopqrstuvwxyz"].join("");
  const keyMaterial = ["-----BEGIN ", "PRIVATE", " KEY-----"].join("");
  for (const field of [
    "sourceIdentity",
    "sourceVersion",
    "providerId",
    "modelIdentity",
    "providerModelVersion",
    "correlationId",
    "traceId",
  ]) {
    for (const value of [sensitiveValue, keyMaterial]) {
      assert.throws(() =>
        createJevDomainObservation(workflowInput({ [field]: value })),
      );
    }
  }
});

test("fingerprint has one canonical representation", () => {
  const raw = createJevDomainObservation(workflowInput({ inputFingerprint: FINGERPRINT }));
  const prefixed = createJevDomainObservation(
    workflowInput({ inputFingerprint: "sha256:" + FINGERPRINT.toUpperCase() }),
  );
  assert.equal(raw.inputFingerprint, "sha256:" + FINGERPRINT);
  assert.equal(prefixed.inputFingerprint, raw.inputFingerprint);
});

test("observation validates confidence, reason code, strict timestamp, and task registration", () => {
  assert.throws(
    () => createJevDomainObservation(workflowInput({ inputFingerprint: "not-a-hash" })),
    /JEV_INPUT_FINGERPRINT_INVALID/,
  );
  assert.throws(
    () => createJevDomainObservation(workflowInput({ confidence: 1.1 })),
    /JEV_CONFIDENCE_INVALID/,
  );
  assert.throws(
    () => createJevDomainObservation(workflowInput({ reasonCode: "not lowercase-safe" })),
    /JEV_REASON_CODE_INVALID/,
  );
  for (const timestamp of [
    "not-a-date",
    "0",
    "2026-02-30T00:00:00.000Z",
    "2026-09-27T00:00:00Z",
  ]) {
    assert.throws(
      () => createJevDomainObservation(workflowInput({ timestamp })),
      /JEV_TIMESTAMP_INVALID/,
    );
  }
  assert.throws(
    () => getJevTaskTypePolicy("UNREGISTERED_TASK"),
    /JEV_TASK_TYPE_UNREGISTERED/,
  );
});

test("research attention policy stays AXIOM-owned and shadow-only", () => {
  const policy = getJevTaskTypePolicy("RESEARCH_INTELLIGENCE_ATTENTION_SHADOW");
  assert.equal(policy.domain, "AXIOM_RESEARCH");
  assert.equal(policy.maxStage, "SHADOW");
  assert.equal(policy.decisionSchema, "RESEARCH_ATTENTION_V1");
  assert.deepEqual(policy.allowedActions, ["OBSERVE", "ESCALATE"]);
  assert.match(policy.canonicalOwner, /Research Intelligence Scout/);
});
