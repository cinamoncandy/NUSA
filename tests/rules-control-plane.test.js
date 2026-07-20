const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionTableHitPolicy,
  PolicyLifecycleState,
  RuleComparator,
  RuleDecision,
  RuleLifecycleState,
  RulesEventType
} = require("../dist/packages/contracts/src/rules.js");
const {
  appendRulesEvent,
  createBusinessPolicy,
  createBusinessRule,
  evaluatePolicy,
  registerRuleVersion,
  replayRulesLedger
} = require("../dist/apps/cloud/src/rulesControlPlane.js");
const { SqliteDatabase, SqliteRulesControlPlaneStore } = require("../dist/packages/storage/src/index.js");

const evidence = "a".repeat(64);
const rule = (overrides = {}) => createBusinessRule({
  ruleId: "eligibility", canonicalName: "eligibility", displayName: "Eligibility", description: "Paper eligibility", category: "ELIGIBILITY", domain: "PAPER", owner: "owner", approver: "approver", policyId: "paper-policy", version: "1.0.0", priority: 10, salience: 10,
  activationConditions: [{ input: "eligible", comparator: RuleComparator.EQUALS, value: true }], evaluationExpression: "DECLARATIVE_CONJUNCTION", outputExpression: RuleDecision.APPROVE, mandatoryInputs: ["eligible"], allowedOutputs: [RuleDecision.APPROVE, RuleDecision.BLOCK], dependencies: [], effectiveFrom: 1, lifecycleState: RuleLifecycleState.PUBLISHED, certificationState: "CERTIFIED", evidenceHash: evidence,
  ...overrides
});
const policy = (overrides = {}) => createBusinessPolicy({
  policyId: "paper-policy", canonicalName: "paper-policy", displayName: "Paper policy", description: "No-authority policy", domain: "PAPER", version: "1.0.0", hierarchy: 10, hitPolicy: DecisionTableHitPolicy.FIRST_MATCH, ruleReferences: [{ ruleId: "eligibility", version: "1.0.0" }], effectiveFrom: 1, lifecycleState: PolicyLifecycleState.PUBLISHED, evidenceHash: evidence,
  ...overrides
});
const request = (overrides = {}) => ({ evaluationId: "evaluation-1", evaluatedAt: 10, policy: policy(), rules: [rule()], inputs: { eligible: true }, ...overrides });
const event = (type, payload, occurredAt) => ({ eventId: `${type}-${occurredAt}`, type, occurredAt, payload, evidenceHash: evidence });

test("published declarative policies are deterministic, immutable, and never create authority", () => {
  const first = evaluatePolicy(request());
  assert.equal(first.decision, RuleDecision.APPROVE);
  assert.equal(first.productionMutationAllowed, false);
  assert.equal(first.durationMs, 0);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(first, evaluatePolicy(request()));
});

test("unknown policy, missing mandatory input, unpublished rule, and ambiguous unique table fail closed", () => {
  assert.equal(evaluatePolicy(request({ policy: undefined })).decision, RuleDecision.UNKNOWN);
  assert.equal(evaluatePolicy(request({ inputs: {} })).decision, RuleDecision.UNKNOWN);
  assert.equal(evaluatePolicy(request({ rules: [rule({ lifecycleState: RuleLifecycleState.APPROVED })] })).decision, RuleDecision.UNKNOWN);
  const second = rule({ ruleId: "second", priority: 1, outputExpression: RuleDecision.BLOCK, activationConditions: [], mandatoryInputs: [] });
  const unique = policy({ hitPolicy: DecisionTableHitPolicy.UNIQUE, ruleReferences: [{ ruleId: "eligibility", version: "1.0.0" }, { ruleId: "second", version: "1.0.0" }] });
  assert.equal(evaluatePolicy(request({ policy: unique, rules: [rule(), second] })).decision, RuleDecision.UNKNOWN);
});

test("conflicts use stable policy semantics and published versions cannot be replaced", () => {
  const blocking = rule({ ruleId: "blocker", priority: 1, salience: 1, outputExpression: RuleDecision.BLOCK, activationConditions: [], mandatoryInputs: [] });
  const collected = policy({ hitPolicy: DecisionTableHitPolicy.COLLECT, ruleReferences: [{ ruleId: "eligibility", version: "1.0.0" }, { ruleId: "blocker", version: "1.0.0" }] });
  const trace = evaluatePolicy(request({ policy: collected, rules: [blocking, rule()] }));
  assert.equal(trace.decision, RuleDecision.BLOCK);
  assert.deepEqual(trace.executionOrder.map(value => value.ruleId), ["eligibility", "blocker"]);
  const registry = new Map([["eligibility@1.0.0", rule()]]);
  assert.equal(registerRuleVersion(registry, rule()), registry.get("eligibility@1.0.0"));
  assert.throws(() => registerRuleVersion(registry, rule({ description: "changed" })), /published rule is immutable/);
});

test("rules events replay exactly and SQLite snapshot tampering fails closed", () => {
  const trace = evaluatePolicy(request());
  const first = appendRulesEvent([], event(RulesEventType.RULE_PUBLISHED, { rule: rule() }, 1));
  const second = appendRulesEvent(first, event(RulesEventType.POLICY_PUBLISHED, { policy: policy() }, 2));
  const records = appendRulesEvent(second, event(RulesEventType.DECISION_EVALUATED, { trace }, 3));
  assert.equal(replayRulesLedger(records).traces.get("evaluation-1").replayHash, trace.replayHash);
  assert.throws(() => replayRulesLedger([{ ...records[0], hash: "0".repeat(64) }]), /integrity/);
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqliteRulesControlPlaneStore(db);
    store.append(event(RulesEventType.RULE_PUBLISHED, { rule: rule() }, 1));
    store.append(event(RulesEventType.POLICY_PUBLISHED, { policy: policy() }, 2));
    store.append(event(RulesEventType.DECISION_EVALUATED, { trace }, 3));
    store.verify();
    db.connection.prepare("UPDATE rules_state SET ledger_hash=? WHERE id=1").run("0".repeat(64));
    assert.throws(() => store.verify(), /snapshot mismatch/);
  } finally { db.close(); }
});
