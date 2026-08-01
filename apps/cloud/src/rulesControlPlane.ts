import { createHash } from "node:crypto";
import {
  DecisionTableHitPolicy,
  RuleComparator,
  RuleDecision,
  RuleLifecycleState,
  PolicyLifecycleState,
  RulesEventType,
  type BusinessPolicy,
  type BusinessRule,
  type DecisionTrace,
  type DecisionSimulationReport,
  type DecisionSimulationMode,
  type RulesControlPlaneProjection,
  type FormulaDefinition,
  type FormulaEvaluation,
  type FormulaEvaluationRequest,
  type FormulaOperand,
  type PolicyCompositionRequest,
  type PolicyCompositionResult,
  type RuleCondition,
  type RuleEvaluationRequest,
  type RuleExecution,
  type RuleReference,
  type RulesLedgerEvent,
  type RulesLedgerRecord,
  type RuleValue,
  FormulaOperation
} from "../../../packages/contracts/src/rules";

const genesis = "0".repeat(64);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const text = (value: string, name: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
};
const timestamp = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
};
const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const ruleKey = (reference: RuleReference): string => `${reference.ruleId}@${reference.version}`;
const ruleReference = (rule: BusinessRule): RuleReference => Object.freeze({ ruleId: rule.ruleId, version: rule.version });

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (entry == null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return entry;
    if (Array.isArray(entry)) return entry.map(normalize);
    if (typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
    }
    throw new Error("canonical serialization rejected unsupported value");
  };
  return JSON.stringify(normalize(value));
}

function validateRuleValue(value: unknown, name: string): RuleValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${name} must be a finite scalar value`);
}

function normalizeCondition(condition: RuleCondition): RuleCondition {
  const comparator = condition.comparator;
  const value = comparator === RuleComparator.IN
    ? freezeArray((Array.isArray(condition.value) ? condition.value : []).map(item => validateRuleValue(item, "condition value")))
    : validateRuleValue(condition.value, "condition value");
  if (comparator === RuleComparator.IN && !Array.isArray(condition.value)) throw new Error("IN condition requires an array value");
  if ((comparator === RuleComparator.GREATER_THAN || comparator === RuleComparator.LESS_THAN) && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("numeric condition requires a finite number");
  return Object.freeze({ input: text(condition.input, "condition input"), comparator, value });
}

export function createBusinessRule(rule: BusinessRule): BusinessRule {
  timestamp(rule.effectiveFrom, "rule effectiveFrom");
  if (rule.expiresAt != null && timestamp(rule.expiresAt, "rule expiresAt") <= rule.effectiveFrom) throw new Error("rule expiresAt must follow effectiveFrom");
  if (!Number.isSafeInteger(rule.priority) || !Number.isSafeInteger(rule.salience)) throw new Error("rule priority and salience must be safe integers");
  if (!validHash(rule.evidenceHash)) throw new Error("rule evidenceHash must be sha256");
  if (!rule.allowedOutputs.includes(rule.outputExpression)) throw new Error("rule output is not allowed by output schema");
  return Object.freeze({
    ...rule,
    ruleId: text(rule.ruleId, "ruleId"), canonicalName: text(rule.canonicalName, "canonicalName"), displayName: text(rule.displayName, "displayName"), description: text(rule.description, "description"), category: text(rule.category, "category"), domain: text(rule.domain, "domain"), owner: text(rule.owner, "owner"), approver: text(rule.approver, "approver"), policyId: text(rule.policyId, "policyId"), version: text(rule.version, "version"), certificationState: text(rule.certificationState, "certificationState"),
    activationConditions: freezeArray(rule.activationConditions.map(normalizeCondition)),
    mandatoryInputs: freezeArray(rule.mandatoryInputs.map(value => text(value, "mandatory input"))),
    allowedOutputs: freezeArray(rule.allowedOutputs),
    dependencies: freezeArray(rule.dependencies.map(value => Object.freeze({ ruleId: text(value.ruleId, "dependency ruleId"), version: text(value.version, "dependency version") })))
  });
}

export function createBusinessPolicy(policy: BusinessPolicy): BusinessPolicy {
  timestamp(policy.effectiveFrom, "policy effectiveFrom");
  if (policy.expiresAt != null && timestamp(policy.expiresAt, "policy expiresAt") <= policy.effectiveFrom) throw new Error("policy expiresAt must follow effectiveFrom");
  if (!Number.isSafeInteger(policy.hierarchy) || !validHash(policy.evidenceHash)) throw new Error("policy hierarchy or evidenceHash is invalid");
  const references = policy.ruleReferences.map(value => Object.freeze({ ruleId: text(value.ruleId, "policy ruleId"), version: text(value.version, "policy ruleVersion") }));
  if (new Set(references.map(ruleKey)).size !== references.length) throw new Error("policy rule references must be unique");
  return Object.freeze({ ...policy, policyId: text(policy.policyId, "policyId"), canonicalName: text(policy.canonicalName, "canonicalName"), displayName: text(policy.displayName, "displayName"), description: text(policy.description, "description"), domain: text(policy.domain, "domain"), version: text(policy.version, "version"), ruleReferences: freezeArray(references) });
}

/** Registers a version once. Published versions are immutable and idempotent only for identical content. */
export function registerRuleVersion(existing: ReadonlyMap<string, BusinessRule>, candidate: BusinessRule): BusinessRule {
  const normalized = createBusinessRule(candidate);
  const current = existing.get(ruleKey(normalized));
  if (current == null) return normalized;
  if (canonical(current) === canonical(normalized)) return current;
  throw new Error(current.lifecycleState === RuleLifecycleState.PUBLISHED ? "published rule is immutable" : "rule version conflict");
}

const formulaKey = (formula: FormulaDefinition): string => `${formula.formulaId}@${formula.version}`;

function normalizeOperand(operand: FormulaOperand): FormulaOperand {
  if (operand.kind === "INPUT") return Object.freeze({ kind: "INPUT", key: text(operand.key, "formula input key") });
  if (operand.kind === "LITERAL" && Number.isFinite(operand.value)) return Object.freeze({ kind: "LITERAL", value: operand.value });
  throw new Error("formula operand is invalid");
}

export function createFormulaDefinition(formula: FormulaDefinition): FormulaDefinition {
  timestamp(formula.effectiveFrom, "formula effectiveFrom");
  if (formula.expiresAt != null && timestamp(formula.expiresAt, "formula expiresAt") <= formula.effectiveFrom) throw new Error("formula expiresAt must follow effectiveFrom");
  if (!validHash(formula.evidenceHash)) throw new Error("formula evidenceHash must be sha256");
  if (formula.operands.length < 2) throw new Error("formula requires at least two operands");
  return Object.freeze({ ...formula, formulaId: text(formula.formulaId, "formulaId"), canonicalName: text(formula.canonicalName, "formula canonicalName"), displayName: text(formula.displayName, "formula displayName"), description: text(formula.description, "formula description"), owner: text(formula.owner, "formula owner"), approver: text(formula.approver, "formula approver"), version: text(formula.version, "formula version"), operands: freezeArray(formula.operands.map(normalizeOperand)) });
}

/** Registers a formula version once. Published formula versions are immutable. */
export function registerFormulaVersion(existing: ReadonlyMap<string, FormulaDefinition>, candidate: FormulaDefinition): FormulaDefinition {
  const normalized = createFormulaDefinition(candidate); const current = existing.get(formulaKey(normalized));
  if (current == null) return normalized;
  if (canonical(current) === canonical(normalized)) return current;
  throw new Error(current.lifecycleState === RuleLifecycleState.PUBLISHED ? "published formula is immutable" : "formula version conflict");
}

function unknownFormula(request: FormulaEvaluationRequest, reason: string): FormulaEvaluation {
  const inputs = Object.freeze(Object.fromEntries(Object.keys(request.inputs).sort().map(key => [key, request.inputs[key]!])) as Record<string, number>);
  const formula = request.formula == null ? undefined : Object.freeze({ ruleId: request.formula.formulaId, version: request.formula.version });
  const evidenceHash = request.formula?.evidenceHash ?? genesis;
  const seed = { evaluationId: request.evaluationId, formula, inputs, reason, status: "UNKNOWN" };
  return Object.freeze({ evaluationId: request.evaluationId, formula, inputHash: hash(canonical(inputs)), result: undefined, status: "UNKNOWN", reasonCodes: freezeArray([reason]), evidenceHash, replayHash: hash(canonical(seed)), productionMutationAllowed: false });
}

export function evaluateFormula(request: FormulaEvaluationRequest): FormulaEvaluation {
  text(request.evaluationId, "formula evaluationId"); timestamp(request.evaluatedAt, "formula evaluatedAt");
  for (const [key, value] of Object.entries(request.inputs)) { text(key, "formula input key"); if (!Number.isFinite(value)) return unknownFormula(request, "INPUT_INVALID"); }
  const formula = request.formula == null ? undefined : createFormulaDefinition(request.formula);
  if (formula == null || formula.lifecycleState !== RuleLifecycleState.PUBLISHED || !active(formula.effectiveFrom, formula.expiresAt, request.evaluatedAt)) return unknownFormula(request, "FORMULA_UNAVAILABLE");
  const values: number[] = [];
  for (const operand of formula.operands) {
    if (operand.kind === "LITERAL") values.push(operand.value);
    else {
      const value = request.inputs[operand.key];
      if (value == null || !Number.isFinite(value)) return unknownFormula(request, `MANDATORY_INPUT_MISSING:${operand.key}`);
      values.push(value);
    }
  }
  let result: number;
  if (formula.operation === FormulaOperation.ADD) result = values.reduce((total, value) => total + value, 0);
  else if (formula.operation === FormulaOperation.SUBTRACT) result = values.slice(1).reduce((total, value) => total - value, values[0]!);
  else if (formula.operation === FormulaOperation.MULTIPLY) result = values.reduce((total, value) => total * value, 1);
  else if (formula.operation === FormulaOperation.DIVIDE) {
    if (values.slice(1).some(value => value === 0)) return unknownFormula(request, "DIVISION_BY_ZERO");
    result = values.slice(1).reduce((total, value) => total / value, values[0]!);
  } else if (formula.operation === FormulaOperation.MIN) result = Math.min(...values);
  else result = Math.max(...values);
  if (!Number.isFinite(result)) return unknownFormula(request, "RESULT_INVALID");
  const inputs = Object.freeze(Object.fromEntries(Object.keys(request.inputs).sort().map(key => [key, request.inputs[key]!])) as Record<string, number>);
  const reference = Object.freeze({ ruleId: formula.formulaId, version: formula.version });
  const seed = { evaluationId: request.evaluationId, formula: reference, inputs, result, evidenceHash: formula.evidenceHash };
  return Object.freeze({ evaluationId: request.evaluationId, formula: reference, inputHash: hash(canonical(inputs)), result, status: "CALCULATED", reasonCodes: freezeArray(["FORMULA_CALCULATED"]), evidenceHash: formula.evidenceHash, replayHash: hash(canonical(seed)), productionMutationAllowed: false });
}

function matches(condition: RuleCondition, inputs: Readonly<Record<string, RuleValue>>): boolean {
  if (!Object.hasOwn(inputs, condition.input)) return false;
  const actual = inputs[condition.input];
  if (condition.comparator === RuleComparator.EQUALS) return actual === condition.value;
  if (condition.comparator === RuleComparator.NOT_EQUALS) return actual !== condition.value;
  if (condition.comparator === RuleComparator.GREATER_THAN) {
    const expected = condition.value;
    return typeof actual === "number" && typeof expected === "number" && actual > expected;
  }
  if (condition.comparator === RuleComparator.LESS_THAN) {
    const expected = condition.value;
    return typeof actual === "number" && typeof expected === "number" && actual < expected;
  }
  return (condition.value as readonly RuleValue[]).includes(actual);
}

const decisionRank: Readonly<Record<RuleDecision, number>> = Object.freeze({
  [RuleDecision.BLOCK]: 0, [RuleDecision.DENY]: 1, [RuleDecision.REQUIRE_REVIEW]: 2, [RuleDecision.ESCALATE]: 3,
  [RuleDecision.LIMIT]: 4, [RuleDecision.DEFER]: 5, [RuleDecision.RECOMMEND]: 6, [RuleDecision.CALCULATE]: 7,
  [RuleDecision.APPROVE]: 8, [RuleDecision.UNKNOWN]: 9
});

function unknownTrace(request: RuleEvaluationRequest, reason: string): DecisionTrace {
  const inputs = Object.freeze({ ...request.inputs });
  const policy = request.policy == null ? undefined : Object.freeze({ policyId: request.policy.policyId, version: request.policy.version });
  const seed = { evaluationId: request.evaluationId, policy, inputs, reason, decision: RuleDecision.UNKNOWN };
  const replayHash = hash(canonical(seed));
  return Object.freeze({ evaluationId: request.evaluationId, policy, ruleVersions: freezeArray([]), inputsHash: hash(canonical(inputs)), normalizedInputs: inputs, matchedRules: freezeArray([]), skippedRules: freezeArray([Object.freeze({ rule: Object.freeze({ ruleId: "UNVERIFIED", version: "UNVERIFIED" }), matched: false, reason })]), rejectedRules: freezeArray([]), executionOrder: freezeArray([]), decision: RuleDecision.UNKNOWN, explanation: `Decision blocked: ${reason}.`, durationMs: 0, evidenceHash: request.policy?.evidenceHash ?? genesis, replayHash, productionMutationAllowed: false });
}

function active(effectiveFrom: number, expiresAt: number | undefined, evaluatedAt: number): boolean {
  return effectiveFrom <= evaluatedAt && (expiresAt == null || evaluatedAt < expiresAt);
}

export function evaluatePolicy(request: RuleEvaluationRequest): DecisionTrace {
  text(request.evaluationId, "evaluationId"); timestamp(request.evaluatedAt, "evaluatedAt");
  for (const [key, value] of Object.entries(request.inputs)) { text(key, "input key"); validateRuleValue(value, "input value"); }
  const policy = request.policy == null ? undefined : createBusinessPolicy(request.policy);
  if (policy == null || policy.lifecycleState !== PolicyLifecycleState.PUBLISHED || !active(policy.effectiveFrom, policy.expiresAt, request.evaluatedAt)) return unknownTrace(request, "POLICY_UNAVAILABLE");
  const supplied = new Map<string, BusinessRule>();
  for (const rule of request.rules) {
    const normalized = createBusinessRule(rule);
    const key = ruleKey(normalized);
    if (supplied.has(key)) return unknownTrace(request, "DUPLICATE_RULE_VERSION");
    supplied.set(key, normalized);
  }
  const ordered = [...policy.ruleReferences].sort((left, right) => {
    const a = supplied.get(ruleKey(left)); const b = supplied.get(ruleKey(right));
    if (a == null || b == null) return ruleKey(left).localeCompare(ruleKey(right));
    return b.priority - a.priority || b.salience - a.salience || a.ruleId.localeCompare(b.ruleId) || a.version.localeCompare(b.version);
  });
  const executions: RuleExecution[] = [];
  const matched: BusinessRule[] = [];
  for (const reference of ordered) {
    const rule = supplied.get(ruleKey(reference));
    if (rule == null || rule.policyId !== policy.policyId || rule.lifecycleState !== RuleLifecycleState.PUBLISHED || !active(rule.effectiveFrom, rule.expiresAt, request.evaluatedAt)) return unknownTrace(request, "RULE_UNAVAILABLE");
    const missing = rule.mandatoryInputs.filter(input => !Object.hasOwn(request.inputs, input));
    if (missing.length > 0) return unknownTrace(request, `MANDATORY_INPUT_MISSING:${missing.sort().join(",")}`);
    const didMatch = rule.activationConditions.every(condition => matches(condition, request.inputs));
    executions.push(Object.freeze({ rule: ruleReference(rule), matched: didMatch, reason: didMatch ? "CONDITIONS_MATCHED" : "CONDITIONS_NOT_MET" }));
    if (didMatch) matched.push(rule);
  }
  let decision = RuleDecision.UNKNOWN;
  if (matched.length > 0) {
    const outcomes = matched.map(rule => rule.outputExpression);
    if (policy.hitPolicy === DecisionTableHitPolicy.UNIQUE && outcomes.length !== 1) decision = RuleDecision.UNKNOWN;
    else if (policy.hitPolicy === DecisionTableHitPolicy.ANY && new Set(outcomes).size !== 1) decision = RuleDecision.UNKNOWN;
    else if (policy.hitPolicy === DecisionTableHitPolicy.COLLECT) decision = [...outcomes].sort((a, b) => decisionRank[a] - decisionRank[b] || a.localeCompare(b))[0]!;
    else decision = outcomes[0]!;
  }
  const inputs = Object.freeze(Object.fromEntries(Object.keys(request.inputs).sort().map(key => [key, request.inputs[key]!])) as Record<string, RuleValue>);
  const references = freezeArray(ordered);
  const matchedReferences = freezeArray(matched.map(ruleReference));
  const rejected = freezeArray(executions.filter(entry => !entry.matched));
  const evidenceHash = hash(canonical({ policy: policy.evidenceHash, rules: matched.map(rule => rule.evidenceHash).sort() }));
  const explanation = decision === RuleDecision.UNKNOWN ? "Decision blocked: no unambiguous published rule outcome." : `Decision ${decision} selected by ${matchedReferences.map(ruleKey).join(", ")}.`;
  const seed = { evaluationId: request.evaluationId, policy: { policyId: policy.policyId, version: policy.version }, references, inputs, matchedReferences, decision, evidenceHash };
  return Object.freeze({ evaluationId: request.evaluationId, policy: Object.freeze({ policyId: policy.policyId, version: policy.version }), ruleVersions: references, inputsHash: hash(canonical(inputs)), normalizedInputs: inputs, matchedRules: matchedReferences, skippedRules: freezeArray([]), rejectedRules: rejected, executionOrder: references, decision, explanation, durationMs: 0, evidenceHash, replayHash: hash(canonical(seed)), productionMutationAllowed: false });
}

/**
 * Produces a typed, immutable observation for simulation or Shadow reporting. The
 * underlying policy evaluator remains the only decision source; this wrapper adds no
 * execution path and deliberately carries an immutable production hard block.
 */
export function simulatePolicy(request: RuleEvaluationRequest & { readonly mode: DecisionSimulationMode }): DecisionSimulationReport {
  const trace = evaluatePolicy(request);
  const simulationHash = hash(canonical({ evaluationId: trace.evaluationId, mode: request.mode, replayHash: trace.replayHash, decision: trace.decision }));
  return Object.freeze({ evaluationId: trace.evaluationId, mode: request.mode, trace, simulationHash, productionMutationAllowed: false as const });
}

function unknownComposition(request: PolicyCompositionRequest, reason: string): PolicyCompositionResult {
  const seed = { evaluationId: request.evaluationId, reason, decision: RuleDecision.UNKNOWN };
  return Object.freeze({ evaluationId: request.evaluationId, policyTraces: freezeArray([]), decision: RuleDecision.UNKNOWN, selectedPolicy: undefined, reasonCodes: freezeArray([reason]), replayHash: hash(canonical(seed)), productionMutationAllowed: false });
}

/**
 * Combines independent policy recommendations. All policies are evaluated from
 * the same explicit input/clock; an unknown result blocks the composition.
 * Restrictive outcomes win before hierarchy breaks equal-severity ties.
 */
export function composePolicies(request: PolicyCompositionRequest): PolicyCompositionResult {
  text(request.evaluationId, "composition evaluationId"); timestamp(request.evaluatedAt, "composition evaluatedAt");
  const policyKeys = request.policies.map(policy => `${policy.policyId}@${policy.version}`);
  if (policyKeys.length === 0) return unknownComposition(request, "POLICY_UNAVAILABLE");
  if (new Set(policyKeys).size !== policyKeys.length) return unknownComposition(request, "DUPLICATE_POLICY_VERSION");
  const policies = [...request.policies].map(createBusinessPolicy).sort((a, b) => b.hierarchy - a.hierarchy || a.policyId.localeCompare(b.policyId) || a.version.localeCompare(b.version));
  const traces = policies.map(policy => evaluatePolicy({ evaluationId: `${request.evaluationId}:${policy.policyId}@${policy.version}`, evaluatedAt: request.evaluatedAt, policy, rules: request.rules, inputs: request.inputs }));
  if (traces.some(trace => trace.decision === RuleDecision.UNKNOWN)) return Object.freeze({ evaluationId: request.evaluationId, policyTraces: freezeArray(traces), decision: RuleDecision.UNKNOWN, selectedPolicy: undefined, reasonCodes: freezeArray(["POLICY_COMPOSITION_UNKNOWN"]), replayHash: hash(canonical({ evaluationId: request.evaluationId, traces: traces.map(trace => trace.replayHash), decision: RuleDecision.UNKNOWN })), productionMutationAllowed: false });
  const ranked = traces.map((trace, index) => ({ trace, policy: policies[index]! })).sort((a, b) => decisionRank[a.trace.decision] - decisionRank[b.trace.decision] || b.policy.hierarchy - a.policy.hierarchy || a.policy.policyId.localeCompare(b.policy.policyId) || a.policy.version.localeCompare(b.policy.version));
  const winner = ranked[0]!;
  const selectedPolicy = Object.freeze({ policyId: winner.policy.policyId, version: winner.policy.version });
  const seed = { evaluationId: request.evaluationId, traces: traces.map(trace => trace.replayHash), selectedPolicy, decision: winner.trace.decision };
  return Object.freeze({ evaluationId: request.evaluationId, policyTraces: freezeArray(traces), decision: winner.trace.decision, selectedPolicy, reasonCodes: freezeArray(["POLICY_COMPOSITION_RESOLVED"]), replayHash: hash(canonical(seed)), productionMutationAllowed: false });
}

function normalizeEvent(event: RulesLedgerEvent): RulesLedgerEvent {
  text(event.eventId, "eventId"); timestamp(event.occurredAt, "occurredAt");
  if (!validHash(event.evidenceHash)) throw new Error("rules event evidenceHash must be sha256");
  return Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) });
}
const recordHash = (sequence: number, previousHash: string, event: RulesLedgerEvent): string => hash(`${sequence}\n${previousHash}\n${canonical(event)}`);

export interface RulesReplayState {
  readonly hash: string;
  readonly rules: ReadonlyMap<string, BusinessRule>;
  readonly policies: ReadonlyMap<string, BusinessPolicy>;
  readonly formulas: ReadonlyMap<string, FormulaDefinition>;
  readonly traces: ReadonlyMap<string, DecisionTrace>;
}

export function replayRulesLedger(records: readonly RulesLedgerRecord[]): RulesReplayState {
  const rules = new Map<string, BusinessRule>(); const policies = new Map<string, BusinessPolicy>(); const formulas = new Map<string, FormulaDefinition>(); const traces = new Map<string, DecisionTrace>();
  let previousHash = genesis; let previousTime = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!; const event = normalizeEvent(record.event);
    if (record.sequence !== index + 1 || record.previousHash !== previousHash || record.hash !== recordHash(record.sequence, record.previousHash, event)) throw new Error("rules ledger integrity violation");
    if (event.occurredAt < previousTime) throw new Error("rules ledger timestamp regression");
    if (event.type === RulesEventType.RULE_REGISTERED || event.type === RulesEventType.RULE_PUBLISHED) {
      const rule = createBusinessRule(event.payload.rule as BusinessRule); const key = ruleKey(rule); const current = rules.get(key);
      if (current != null && canonical(current) !== canonical(rule)) throw new Error("rules ledger rule version conflict");
      if (event.type === RulesEventType.RULE_PUBLISHED && rule.lifecycleState !== RuleLifecycleState.PUBLISHED) throw new Error("published event requires published rule");
      rules.set(key, rule);
    }
    if (event.type === RulesEventType.POLICY_REGISTERED || event.type === RulesEventType.POLICY_PUBLISHED) {
      const policy = createBusinessPolicy(event.payload.policy as BusinessPolicy); const key = `${policy.policyId}@${policy.version}`; const current = policies.get(key);
      if (current != null && canonical(current) !== canonical(policy)) throw new Error("rules ledger policy version conflict");
      if (event.type === RulesEventType.POLICY_PUBLISHED && policy.lifecycleState !== PolicyLifecycleState.PUBLISHED) throw new Error("published event requires published policy");
      policies.set(key, policy);
    }
    if (event.type === RulesEventType.FORMULA_REGISTERED || event.type === RulesEventType.FORMULA_PUBLISHED) {
      const formula = createFormulaDefinition(event.payload.formula as FormulaDefinition); const key = formulaKey(formula); const current = formulas.get(key);
      if (current != null && canonical(current) !== canonical(formula)) throw new Error("rules ledger formula version conflict");
      if (event.type === RulesEventType.FORMULA_PUBLISHED && formula.lifecycleState !== RuleLifecycleState.PUBLISHED) throw new Error("published event requires published formula");
      formulas.set(key, formula);
    }
    if (event.type === RulesEventType.DECISION_EVALUATED || event.type === RulesEventType.DECISION_SIMULATED || event.type === RulesEventType.DECISION_REPLAYED) {
      const trace = event.payload.trace as DecisionTrace;
      if (trace == null || !validHash(trace.replayHash) || trace.productionMutationAllowed !== false || traces.has(trace.evaluationId)) throw new Error("invalid rules decision trace");
      traces.set(trace.evaluationId, Object.freeze({ ...trace, ruleVersions: freezeArray(trace.ruleVersions), matchedRules: freezeArray(trace.matchedRules), skippedRules: freezeArray(trace.skippedRules), rejectedRules: freezeArray(trace.rejectedRules), executionOrder: freezeArray(trace.executionOrder), normalizedInputs: Object.freeze({ ...trace.normalizedInputs }) }));
    }
    previousHash = record.hash; previousTime = event.occurredAt;
  }
  return Object.freeze({ hash: previousHash, rules, policies, formulas, traces });
}

/** Projects the verified ledger for operators without exposing mutable storage. */
export function projectRulesLedger(records: readonly RulesLedgerRecord[]): RulesControlPlaneProjection {
  const replay = replayRulesLedger(records);
  const decisionCounts = Object.fromEntries(Object.values(RuleDecision).map((decision) => [decision, 0])) as Record<RuleDecision, number>;
  for (const trace of replay.traces.values()) decisionCounts[trace.decision] += 1;
  return Object.freeze({
    ledgerHash: replay.hash,
    eventCount: records.length,
    ruleVersionCount: replay.rules.size,
    policyVersionCount: replay.policies.size,
    formulaVersionCount: replay.formulas.size,
    decisionTraceCount: replay.traces.size,
    decisionCounts: Object.freeze(decisionCounts),
    latestEventType: records.at(-1)?.event.type
  });
}

export function appendRulesEvent(records: readonly RulesLedgerRecord[], event: RulesLedgerEvent): readonly RulesLedgerRecord[] {
  replayRulesLedger(records); const normalized = normalizeEvent(event); const previousHash = records.at(-1)?.hash ?? genesis;
  const record = Object.freeze({ sequence: records.length + 1, previousHash, event: normalized, hash: recordHash(records.length + 1, previousHash, normalized) });
  const next = Object.freeze([...records, record]); replayRulesLedger(next); return next;
}
