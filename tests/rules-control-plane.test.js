const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionTableHitPolicy,
  FormulaOperation,
  PolicyLifecycleState,
  RuleComparator,
  RuleDecision,
  RuleLifecycleState,
  RulesEventType
} = require("../dist/packages/contracts/src/rules.js");
const {
  appendRulesEvent,
  composePolicies,
  createBusinessPolicy,
  createBusinessRule,
  createFormulaDefinition,
  evaluateFormula,
  evaluatePolicy,
  simulatePolicy,
  registerFormulaVersion,
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
const formula = (overrides = {}) => createFormulaDefinition({ formulaId: "fee", canonicalName: "fee", displayName: "Fee", description: "No-authority fee calculation", owner: "owner", approver: "approver", version: "1.0.0", operation: FormulaOperation.MULTIPLY, operands: [{ kind: "INPUT", key: "notional" }, { kind: "INPUT", key: "rate" }], effectiveFrom: 1, lifecycleState: RuleLifecycleState.PUBLISHED, evidenceHash: evidence, ...overrides });

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

test("published formulas are deterministic, immutable, and fail closed without executable expressions", () => {
  const calculation = evaluateFormula({ evaluationId: "formula-1", evaluatedAt: 10, formula: formula(), inputs: { notional: 100, rate: 0.01 } });
  assert.deepEqual(calculation.result, 1);
  assert.equal(calculation.productionMutationAllowed, false);
  assert.deepEqual(calculation, evaluateFormula({ evaluationId: "formula-1", evaluatedAt: 10, formula: formula(), inputs: { rate: 0.01, notional: 100 } }));
  assert.equal(evaluateFormula({ evaluationId: "formula-zero", evaluatedAt: 10, formula: formula({ operation: FormulaOperation.DIVIDE }), inputs: { notional: 100, rate: 0 } }).status, "UNKNOWN");
  assert.equal(evaluateFormula({ evaluationId: "formula-unpublished", evaluatedAt: 10, formula: formula({ lifecycleState: RuleLifecycleState.APPROVED }), inputs: { notional: 100, rate: 1 } }).status, "UNKNOWN");
  const registry = new Map([["fee@1.0.0", formula()]]);
  assert.throws(() => registerFormulaVersion(registry, formula({ description: "changed" })), /published formula is immutable/);
});

test("policy composition is deterministic, preserves strict outcomes, and blocks unknown policy state", () => {
  const restrictiveRule = rule({ ruleId: "jurisdiction-block", policyId: "regulatory-policy", outputExpression: RuleDecision.BLOCK, activationConditions: [], mandatoryInputs: [] });
  const restrictivePolicy = policy({ policyId: "regulatory-policy", canonicalName: "regulatory-policy", displayName: "Regulatory policy", ruleReferences: [{ ruleId: "jurisdiction-block", version: "1.0.0" }], hierarchy: 1 });
  const first = composePolicies({ evaluationId: "composition-1", evaluatedAt: 10, policies: [policy(), restrictivePolicy], rules: [rule(), restrictiveRule], inputs: { eligible: true } });
  const second = composePolicies({ evaluationId: "composition-1", evaluatedAt: 10, policies: [restrictivePolicy, policy()], rules: [restrictiveRule, rule()], inputs: { eligible: true } });
  assert.equal(first.decision, RuleDecision.BLOCK);
  assert.equal(first.selectedPolicy.policyId, "regulatory-policy");
  assert.deepEqual(first, second);
  assert.equal(first.productionMutationAllowed, false);
  assert.equal(composePolicies({ evaluationId: "composition-unknown", evaluatedAt: 10, policies: [policy(), restrictivePolicy], rules: [rule()], inputs: { eligible: true } }).decision, RuleDecision.UNKNOWN);
});

test("simulation and Shadow reports are typed read-only observations", () => {
  const simulation = simulatePolicy({ ...request(), mode: "SIMULATION" });
  const shadow = simulatePolicy({ ...request(), mode: "SHADOW" });
  assert.equal(simulation.productionMutationAllowed, false);
  assert.equal(shadow.productionMutationAllowed, false);
  assert.equal(simulation.trace.decision, RuleDecision.APPROVE);
  assert.notEqual(simulation.simulationHash, shadow.simulationHash);
  assert.deepEqual(simulation, simulatePolicy({ ...request(), mode: "SIMULATION" }));
});

test("rules events replay exactly and SQLite snapshot tampering fails closed", () => {
  const trace = evaluatePolicy(request());
  const first = appendRulesEvent([], event(RulesEventType.RULE_PUBLISHED, { rule: rule() }, 1));
  const second = appendRulesEvent(first, event(RulesEventType.POLICY_PUBLISHED, { policy: policy() }, 2));
  const third = appendRulesEvent(second, event(RulesEventType.FORMULA_PUBLISHED, { formula: formula() }, 3));
  const records = appendRulesEvent(third, event(RulesEventType.DECISION_EVALUATED, { trace }, 4));
  assert.equal(replayRulesLedger(records).traces.get("evaluation-1").replayHash, trace.replayHash);
  assert.equal(replayRulesLedger(records).formulas.get("fee@1.0.0").canonicalName, "fee");
  assert.throws(() => replayRulesLedger([{ ...records[0], hash: "0".repeat(64) }]), /integrity/);
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqliteRulesControlPlaneStore(db);
    store.append(event(RulesEventType.RULE_PUBLISHED, { rule: rule() }, 1));
    store.append(event(RulesEventType.POLICY_PUBLISHED, { policy: policy() }, 2));
    store.append(event(RulesEventType.FORMULA_PUBLISHED, { formula: formula() }, 3));
    store.append(event(RulesEventType.DECISION_EVALUATED, { trace }, 4));
    store.verify();
    db.connection.prepare("UPDATE rules_state SET ledger_hash=? WHERE id=1").run("0".repeat(64));
    assert.throws(() => store.verify(), /snapshot mismatch/);
  } finally { db.close(); }
});
