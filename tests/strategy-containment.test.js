const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateStrategyContainment,
  fingerprintStrategyContainmentDecision,
} = require("../dist/apps/cloud/src/strategyRollbackEngine.js");
const { StrategyGovernanceService } = require("../dist/apps/cloud/src/strategyGovernanceService.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteStrategyGovernanceStore } = require("../dist/packages/storage/src/strategyGovernanceStore.js");

// Canonical Strategy Family membership for this suite. #2159 made governance registration require
// exact membership through a fail-closed port; these fixtures never supplied one, so every
// containment test died at registration with STRATEGY_FAMILY_MEMBERSHIP_UNAVAILABLE.
//
// The port is deliberately exact rather than permissive: it accepts only the one identity this
// suite registers and throws on anything else. A stub that accepted everything would make the
// tests pass while removing the guarantee the port exists for.
// #2159 made lifecycle transitions deterministic: STRATEGY_SUSPENDED is only reachable from
// PAPER_ACTIVE, PROMOTION_PENDING, CHALLENGER or CHAMPION. These fixtures used to register a
// strategy and suspend it straight out of DRAFT, which the new rule rejects — correctly, since a
// DRAFT strategy has nothing to contain. Walk the canonical path instead of widening the rule.
const toPaperActive = (service, prefix) => {
  service.transition(`${prefix}-research`, "strategy-1", "1.0.0", "RESEARCH_STARTED", "RESEARCHING", "family-1", 2, "research started");
  service.transition(`${prefix}-validated`, "strategy-1", "1.0.0", "VALIDATION_RECORDED", "VALIDATED", "family-1", 3, "validated");
  service.transition(`${prefix}-candidate`, "strategy-1", "1.0.0", "PAPER_CANDIDATE_APPROVED", "PAPER_CANDIDATE", "family-1", 4, "paper candidate");
  service.transition(`${prefix}-paper`, "strategy-1", "1.0.0", "PAPER_STARTED", "PAPER_ACTIVE", "family-1", 5, "paper started");
};

const familyMembership = {
  requireMembership: (strategyId, version, familyId) => {
    if (strategyId !== "strategy-1" || version !== "1.0.0" || familyId !== "family-1") {
      throw new Error("STRATEGY_FAMILY_MEMBERSHIP_MISMATCH");
    }
  },
};

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
  const service = new StrategyGovernanceService(store, familyMembership);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    familyId: "family-1",
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
  const service = new StrategyGovernanceService(store, familyMembership);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    familyId: "family-1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-apply-containment", identity, 1);
  toPaperActive(service, "apply");
  const decision = service.evaluateContainment(input({
    currentLifecycle: "PAPER_ACTIVE",
    rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }),
  }));
  assert.equal(decision.action, "SUSPEND");
  const approval = {
    actorType: "HUMAN",
    approvalReference: "owner:containment:1",
    approvedAt: 101,
    decisionFingerprint: fingerprintStrategyContainmentDecision(decision),
  };
  // The count is a delta, not a fixed total: the fixture now walks the canonical lifecycle to reach
  // a suspendable state, and what containment must guarantee is that it appends exactly one event.
  const beforeApply = store.listEvents().length;
  service.applyContainmentDecision("apply-containment-1", decision, approval, "family-1");
  assert.equal(store.listStrategies()[0].lifecycle, "SUSPENDED");
  assert.equal(store.listEvents().length, beforeApply + 1);
  assert.deepEqual(store.listEvents().at(-1).event.approval, approval);

  const restarted = new StrategyGovernanceService(store, familyMembership);
  restarted.restorePersistedState();
  restarted.applyContainmentDecision("apply-containment-1", decision, approval, "family-1");
  assert.equal(store.listEvents().length, beforeApply + 1, "an identical approved replay must stay idempotent");
  store.verify();
  db.close();
});

test("containment approval rejects mismatched, non-human, and stale decisions without mutation", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store, familyMembership);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    familyId: "family-1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-reject-containment", identity, 1);
  toPaperActive(service, "reject");
  const decision = service.evaluateContainment(input({
    currentLifecycle: "PAPER_ACTIVE",
    rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }),
  }));
  const approval = {
    actorType: "HUMAN",
    approvalReference: "owner:containment:2",
    approvedAt: 101,
    decisionFingerprint: fingerprintStrategyContainmentDecision(decision),
  };
  assert.throws(() => service.applyContainmentDecision("bad-fingerprint", decision, { ...approval, decisionFingerprint: "0".repeat(64) }, "family-1"), /APPROVAL_MISMATCH/);
  assert.throws(() => service.applyContainmentDecision("bad-actor", decision, { ...approval, actorType: "AI" }, "family-1"), /APPROVAL_INVALID/);
  const beforeReject = store.listEvents().length;
  service.applyContainmentDecision("apply-containment-2", decision, approval, "family-1");
  assert.throws(() => service.applyContainmentDecision("stale-containment", decision, approval, "family-1"), /STALE/);
  const hold = service.evaluateContainment(input({ currentLifecycle: "SUSPENDED", rollback: rollback({ previousChampionVersion: undefined }) }));
  assert.equal(hold.action, "HOLD");
  assert.throws(() => service.applyContainmentDecision("hold-containment", hold, approval, "family-1"), /NO_ACTION/);
  assert.equal(store.listEvents().length, beforeReject + 1, "only the one approved containment may append");
  store.verify();
  db.close();
});

test("public governance transition cannot bypass human-approved containment", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store, familyMembership);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    familyId: "family-1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-transition-guard", identity, 1);
  toPaperActive(service, "guard");
  const beforeBypass = store.listEvents().length;
  assert.throws(
    () => service.transition("bypass-containment", identity.strategyId, identity.version, "STRATEGY_SUSPENDED", "SUSPENDED", "family-1", 101, "containment:UNRESOLVED_FAULT"),
    /STRATEGY_CONTAINMENT_APPROVAL_REQUIRED/,
  );
  // What this guards is that an unapproved bypass mutates nothing — the lifecycle it started from is
  // PAPER_ACTIVE now, because containment is only reachable from there.
  assert.equal(store.listStrategies()[0].lifecycle, "PAPER_ACTIVE");
  assert.equal(store.listEvents().length, beforeBypass);
  db.close();
});

test("approval metadata is part of the governance integrity chain", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store, familyMembership);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    familyId: "family-1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-integrity-containment", identity, 1);
  toPaperActive(service, "integrity");
  const decision = service.evaluateContainment(input({ currentLifecycle: "PAPER_ACTIVE", rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }) }));
  const approval = { actorType: "HUMAN", approvalReference: "owner:containment:3", approvedAt: 101, decisionFingerprint: fingerprintStrategyContainmentDecision(decision) };
  service.applyContainmentDecision("apply-integrity-containment", decision, approval, "family-1");
  const records = store.listEvents();
  const last = records.at(-1);
  db.connection.prepare("UPDATE strategy_governance_events SET event_json=? WHERE sequence=?").run(JSON.stringify({ ...last.event, approval: { ...last.event.approval, approvalReference: "owner:tampered" } }), last.sequence);
  assert.throws(() => store.verify(), /integrity/);
  db.close();
});

test("the containment suite's family membership port is exact, not a permissive stub", () => {
  // Without this, the fixture could be replaced by `requireMembership: () => {}` and every test above
  // would still pass — the suite would be asserting containment against a port that guarantees
  // nothing. #2159 made membership a fail-closed dependency; the fixture has to behave like one.
  assert.throws(() => familyMembership.requireMembership("other-strategy", "1.0.0", "family-1"), /MEMBERSHIP_MISMATCH/);
  assert.throws(() => familyMembership.requireMembership("strategy-1", "2.0.0", "family-1"), /MEMBERSHIP_MISMATCH/);
  assert.throws(() => familyMembership.requireMembership("strategy-1", "1.0.0", "other-family"), /MEMBERSHIP_MISMATCH/);
  assert.doesNotThrow(() => familyMembership.requireMembership("strategy-1", "1.0.0", "family-1"));

  // And registration must still refuse to proceed when no port is supplied at all.
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  assert.throws(
    () => new StrategyGovernanceService(store).register("no-port", {
      strategyId: "strategy-1", version: "1.0.0", name: "Strategy 1", familyId: "family-1",
      createdAt: 1, gitCommitSha: "b".repeat(40), featureFingerprint: "c".repeat(64), engineVersion: "1", authorType: "HUMAN",
    }, 1),
    /STRATEGY_FAMILY_MEMBERSHIP_UNAVAILABLE/,
  );
  assert.equal(store.listStrategies().length, 0);
  db.close();
});

test("containment refuses a caller-supplied family that is not the registered one", () => {
  // 7eb51e92 made applyContainmentDecision derive the family from the registered canonical identity
  // and reject a mismatching caller argument. Removing that rejection passed every existing test, so
  // the guard was carrying no weight. This is the test that makes it load-bearing.
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteStrategyGovernanceStore(db);
  const service = new StrategyGovernanceService(store, familyMembership);
  const identity = {
    strategyId: "strategy-1",
    version: "1.0.0",
    name: "Strategy 1",
    familyId: "family-1",
    createdAt: 1,
    gitCommitSha: "b".repeat(40),
    featureFingerprint: "c".repeat(64),
    engineVersion: "1",
    authorType: "HUMAN",
  };
  service.register("register-family-guard", identity, 1);
  toPaperActive(service, "family-guard");
  const decision = service.evaluateContainment(input({
    currentLifecycle: "PAPER_ACTIVE",
    rollback: rollback({ previousChampionVersion: undefined, unresolvedFaultCount: 1 }),
  }));
  const approval = {
    actorType: "HUMAN",
    approvalReference: "owner:containment:family-guard",
    approvedAt: 101,
    decisionFingerprint: fingerprintStrategyContainmentDecision(decision),
  };

  const before = store.listEvents().length;
  // The old default was decision.strategyId, which is exactly the wrong value for this strategy.
  assert.throws(() => service.applyContainmentDecision("wrong-family", decision, approval, decision.strategyId), /STRATEGY_FAMILY_MISMATCH/);
  assert.throws(() => service.applyContainmentDecision("other-family", decision, approval, "family-2"), /STRATEGY_FAMILY_MISMATCH/);
  assert.equal(store.listEvents().length, before, "a family mismatch must not append an event");
  assert.equal(store.listStrategies()[0].lifecycle, "PAPER_ACTIVE");

  // Omitting the family is allowed: the canonical identity supplies it.
  service.applyContainmentDecision("derived-family", decision, approval);
  assert.equal(store.listEvents().length, before + 1);
  assert.equal(store.listEvents().at(-1).event.familyId, "family-1", "the event must carry the registered family");
  assert.equal(store.listStrategies()[0].lifecycle, "SUSPENDED");
  store.verify();
  db.close();
});
