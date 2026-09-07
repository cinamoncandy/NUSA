const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateStrategyContainment,
  fingerprintStrategyContainmentDecision,
} = require("../dist/apps/cloud/src/strategyRollbackEngine.js");
const { StrategyGovernanceService } = require("../dist/apps/cloud/src/strategyGovernanceService.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteStrategyGovernanceStore } = require("../dist/packages/storage/src/strategyGovernanceStore.js");

const rollback = (overrides = {}) => ({
  now: 100,
  strategyId: "strategy-1",
  version: "1.0.0",
  previousChampionVersion: "0.9.0",
  maximumDrawdown: 0.01,
  maximumDrawdownThreshold: 0.1,
  rollingSharpe: 1,
  minimumRollingSharpe: 0,
  executionQualityScore: 90,
  minimumExecutionQualityScore: 80,
  unresolvedFaultCount: 0,
  partialHedgeRecoveryFailures: 0,
  killSwitchActive: false,
  featureFingerprintMatches: true,
  dataQualityHealthy: true,
  paperAvailabilityRatio: 1,
  minimumAvailabilityRatio: 0.99,
  strategyDriftDetected: false,
  unresolvedExposure: false,
  ...overrides,
});

const evidence = (overrides = {}) => ({
  status: "VERIFIED",
  observedAt: 99,
  fingerprint: "a".repeat(64),
  references: ["paper:evidence", "rollback:evidence"],
  ...overrides,
});

const input = (overrides = {}) => ({
  currentLifecycle: "CHAMPION",
  rollback: rollback(),
  evidence: evidence(),
  ...overrides,
});

test("verified containment advice is deterministic, provenance-bound, and read-only", () => {
  const first = evaluateStrategyContainment(input({ evidence: evidence({ references: ["z:evidence", "a:evidence"] }) }));
  const second = evaluateStrategyContainment(input({ evidence: evidence({ references: ["z:evidence", "a:evidence"] }) }));
  assert.deepEqual(first, second);
  assert.equal(first.action, "HOLD");
  assert.equal(first.targetLifecycle, "CHAMPION");
  assert.deepEqual(first.reasons, ["NO_CONTAINMENT_TRIGGER"]);
  assert.equal(first.requiresHumanApproval, true);
  assert.equal(first.productionMutationAllowed, false);
  assert.equal(first.liveAuthority, "NONE");
  assert.deepEqual(first.evidenceReferences, ["a:evidence", "z:evidence"]);
});

test("existing rollback policy maps critical verified evidence to advisory rollback", () => {
  const result = evaluateStrategyContainment(input({ rollback: rollback({ unresolvedFaultCount: 1 }) }));
  assert.equal(result.action, "ROLLBACK");
  assert.equal(result.targetLifecycle, "ROLLED_BACK");
  assert.deepEqual(result.reasons, ["UNRESOLVED_FAULT"]);
});

test("stale evidence protects an active strategy and blocks permissive advice", () => {
  const result = evaluateStrategyContainment(input({ evidence: evidence({ status: "STALE" }) }));
  assert.equal(result.action, "SUSPEND");
  assert.equal(result.targetLifecycle, "SUSPENDED");
  assert.deepEqual(result.reasons, ["STALE_EVIDENCE"]);
});

test("unavailable evidence holds an unpromoted strategy without treating missing data as healthy", () => {
  const result = evaluateStrategyContainment(input({ currentLifecycle: "PAPER_CANDIDATE", evidence: evidence({ status: "UNAVAILABLE" }) }));
  assert.equal(result.action, "HOLD");
  assert.equal(result.targetLifecycle, "PAPER_CANDIDATE");
  assert.deepEqual(result.reasons, ["PROMOTION_BLOCKED", "UNAVAILABLE_EVIDENCE"]);
});

test("conflicting evidence fails closed for challengers", () => {
  const result = evaluateStrategyContainment(input({ currentLifecycle: "CHALLENGER", evidence: evidence({ status: "CONFLICTING" }) }));
  assert.equal(result.action, "SUSPEND");
  assert.equal(result.targetLifecycle, "SUSPENDED");
  assert.deepEqual(result.reasons, ["CONFLICTING_EVIDENCE"]);
});

test("retirement requires verified evidence, a suspended state, and an explicit threshold review", () => {
  const result = evaluateStrategyContainment(input({
    currentLifecycle: "SUSPENDED",
    retirement: { eligible: true, consecutiveFailurePeriods: 3, minimumConsecutiveFailurePeriods: 3 },
  }));
  assert.equal(result.action, "RETIRE");
  assert.equal(result.targetLifecycle, "RETIRED");
  assert.deepEqual(result.reasons, ["RETIREMENT_THRESHOLD_MET"]);
  assert.equal(result.requiresHumanApproval, true);
});

test("retirement remains closed when the supplied threshold review is incomplete", () => {
  const result = evaluateStrategyContainment(input({
    currentLifecycle: "SUSPENDED",
    retirement: { eligible: true, consecutiveFailurePeriods: 2, minimumConsecutiveFailurePeriods: 3 },
  }));
  assert.equal(result.action, "HOLD");
  assert.equal(result.targetLifecycle, "SUSPENDED");
  assert.deepEqual(result.reasons, ["NO_CONTAINMENT_TRIGGER"]);
});

test("invalid, future, and duplicate evidence identity is rejected", () => {
  assert.throws(() => evaluateStrategyContainment(input({ evidence: evidence({ observedAt: 101 }) })), /INVALID_EVIDENCE_TIME/);
  assert.throws(() => evaluateStrategyContainment(input({ evidence: evidence({ fingerprint: "not-a-sha" }) })), /INVALID_EVIDENCE_FINGERPRINT/);
  assert.throws(() => evaluateStrategyContainment(input({ evidence: evidence({ references: ["same", "same"] }) })), /INVALID_EVIDENCE_REFERENCES/);
  assert.throws(() => evaluateStrategyContainment(input({ evidence: undefined })), /INVALID_EVIDENCE_STATUS/);
});

test("governance service evaluates containment without appending events or changing registry state", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-containment", identity, 1);
  const beforeEvents = store.listEvents().length;
  const before = store.listStrategies()[0];
  const result = service.evaluateContainment(input({ currentLifecycle: "DRAFT", rollback: rollback({ strategyId: identity.strategyId, version: identity.version, previousChampionVersion: undefined }) }));
  assert.equal(result.action, "HOLD");
  assert.equal(store.listEvents().length, beforeEvents);
  assert.deepEqual(store.listStrategies()[0], before);
  store.verify();
  db.close();
});

test("human-approved containment applies one evidence-bound lifecycle event and survives replay", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-apply-containment", identity, 1);
  const decision = service.evaluateContainment(input({
    currentLifecycle: "DRAFT",
    rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }),
  }));
  assert.equal(decision.action, "SUSPEND");
  const approval = {
    actorType: "HUMAN",
    approvalReference: "owner:containment:1",
    approvedAt: 101,
    decisionFingerprint: fingerprintStrategyContainmentDecision(decision),
  };
  service.applyContainmentDecision("apply-containment-1", decision, approval, "family-1");
  assert.equal(store.listStrategies()[0].lifecycle, "SUSPENDED");
  assert.equal(store.listEvents().length, 2);
  assert.deepEqual(store.listEvents().at(-1).event.approval, approval);

  const restarted = new StrategyGovernanceService(store);
  restarted.restorePersistedState();
  restarted.applyContainmentDecision("apply-containment-1", decision, approval, "family-1");
  assert.equal(store.listEvents().length, 2);
  store.verify();
  db.close();
});

test("containment approval rejects mismatched, non-human, and stale decisions without mutation", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-reject-containment", identity, 1);
  const decision = service.evaluateContainment(input({
    currentLifecycle: "DRAFT",
    rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }),
  }));
  const approval = {
    actorType: "HUMAN",
    approvalReference: "owner:containment:2",
    approvedAt: 101,
    decisionFingerprint: fingerprintStrategyContainmentDecision(decision),
  };
  assert.throws(() => service.applyContainmentDecision("bad-fingerprint", decision, { ...approval, decisionFingerprint: "0".repeat(64) }), /APPROVAL_MISMATCH/);
  assert.throws(() => service.applyContainmentDecision("bad-actor", decision, { ...approval, actorType: "AI" }), /APPROVAL_INVALID/);
  assert.equal(store.listEvents().length, 1);
  service.applyContainmentDecision("apply-containment-2", decision, approval);
  assert.throws(() => service.applyContainmentDecision("stale-containment", decision, approval), /STALE/);
  const hold = service.evaluateContainment(input({ currentLifecycle: "SUSPENDED", rollback: rollback({ previousChampionVersion: undefined }) }));
  assert.equal(hold.action, "HOLD");
  assert.throws(() => service.applyContainmentDecision("hold-containment", hold, approval), /NO_ACTION/);
  assert.equal(store.listEvents().length, 2);
  store.verify();
  db.close();
});

test("public governance transition cannot bypass human-approved containment", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-transition-guard", identity, 1);
  assert.throws(
    () => service.transition("bypass-containment", identity.strategyId, identity.version, "STRATEGY_SUSPENDED", "SUSPENDED", "family-1", 101, "containment:UNRESOLVED_FAULT"),
    /STRATEGY_CONTAINMENT_APPROVAL_REQUIRED/,
  );
  assert.equal(store.listStrategies()[0].lifecycle, "DRAFT");
  assert.equal(store.listEvents().length, 1);
  db.close();
});

test("approval metadata is part of the governance integrity chain", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-integrity-containment", identity, 1);
  const decision = service.evaluateContainment(input({ currentLifecycle: "DRAFT", rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }) }));
  const approval = { actorType: "HUMAN", approvalReference: "owner:containment:3", approvedAt: 101, decisionFingerprint: fingerprintStrategyContainmentDecision(decision) };
  service.applyContainmentDecision("apply-integrity-containment", decision, approval);
  const records = store.listEvents();
  const last = records.at(-1);
  db.connection.prepare("UPDATE strategy_governance_events SET event_json=? WHERE sequence=?").run(JSON.stringify({ ...last.event, approval: { ...last.event.approval, approvalReference: "owner:tampered" } }), last.sequence);
  assert.throws(() => store.verify(), /integrity/);
  db.close();
});
