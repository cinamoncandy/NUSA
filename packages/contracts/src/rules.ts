/**
 * Declarative, side-effect-free rule contracts. These outputs are policy
 * recommendations only; an authorization boundary must decide any mutation.
 */
export type RuleValue = string | number | boolean | null;

export enum RuleLifecycleState {
  DRAFT = "DRAFT",
  VALIDATING = "VALIDATING",
  REVIEW_PENDING = "REVIEW_PENDING",
  APPROVED = "APPROVED",
  PUBLISHED = "PUBLISHED",
  DEPRECATED = "DEPRECATED",
  RETIRED = "RETIRED",
  UNKNOWN = "UNKNOWN"
}

export enum PolicyLifecycleState {
  DRAFT = "DRAFT",
  VALIDATING = "VALIDATING",
  REVIEW_PENDING = "REVIEW_PENDING",
  APPROVED = "APPROVED",
  PUBLISHED = "PUBLISHED",
  DEPRECATED = "DEPRECATED",
  RETIRED = "RETIRED",
  UNKNOWN = "UNKNOWN"
}

export enum RuleDecision {
  APPROVE = "APPROVE",
  DENY = "DENY",
  REQUIRE_REVIEW = "REQUIRE_REVIEW",
  ESCALATE = "ESCALATE",
  RECOMMEND = "RECOMMEND",
  DEFER = "DEFER",
  CALCULATE = "CALCULATE",
  LIMIT = "LIMIT",
  BLOCK = "BLOCK",
  UNKNOWN = "UNKNOWN"
}

export enum DecisionTableHitPolicy {
  FIRST_MATCH = "FIRST_MATCH",
  COLLECT = "COLLECT",
  PRIORITY = "PRIORITY",
  UNIQUE = "UNIQUE",
  ANY = "ANY",
  OUTPUT_ORDER = "OUTPUT_ORDER"
}

export enum RuleComparator {
  EQUALS = "EQUALS",
  NOT_EQUALS = "NOT_EQUALS",
  GREATER_THAN = "GREATER_THAN",
  LESS_THAN = "LESS_THAN",
  IN = "IN"
}

export interface RuleCondition {
  readonly input: string;
  readonly comparator: RuleComparator;
  readonly value: RuleValue | readonly RuleValue[];
}

export interface RuleReference {
  readonly ruleId: string;
  readonly version: string;
}

export interface PolicyReference {
  readonly policyId: string;
  readonly version: string;
}

export interface BusinessRule {
  readonly ruleId: string;
  readonly canonicalName: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly domain: string;
  readonly owner: string;
  readonly approver: string;
  readonly policyId: string;
  readonly version: string;
  readonly priority: number;
  readonly salience: number;
  readonly activationConditions: readonly RuleCondition[];
  readonly evaluationExpression: "DECLARATIVE_CONJUNCTION";
  readonly outputExpression: RuleDecision;
  readonly mandatoryInputs: readonly string[];
  readonly allowedOutputs: readonly RuleDecision[];
  readonly dependencies: readonly RuleReference[];
  readonly effectiveFrom: number;
  readonly expiresAt?: number;
  readonly lifecycleState: RuleLifecycleState;
  readonly certificationState: string;
  readonly evidenceHash: string;
}

export interface BusinessPolicy {
  readonly policyId: string;
  readonly canonicalName: string;
  readonly displayName: string;
  readonly description: string;
  readonly domain: string;
  readonly version: string;
  readonly hierarchy: number;
  readonly hitPolicy: DecisionTableHitPolicy;
  readonly ruleReferences: readonly RuleReference[];
  readonly effectiveFrom: number;
  readonly expiresAt?: number;
  readonly lifecycleState: PolicyLifecycleState;
  readonly evidenceHash: string;
}

export enum FormulaOperation {
  ADD = "ADD",
  SUBTRACT = "SUBTRACT",
  MULTIPLY = "MULTIPLY",
  DIVIDE = "DIVIDE",
  MIN = "MIN",
  MAX = "MAX"
}

export type FormulaOperand =
  | { readonly kind: "INPUT"; readonly key: string }
  | { readonly kind: "LITERAL"; readonly value: number };

/** A formula is declarative data, never executable source code. */
export interface FormulaDefinition {
  readonly formulaId: string;
  readonly canonicalName: string;
  readonly displayName: string;
  readonly description: string;
  readonly owner: string;
  readonly approver: string;
  readonly version: string;
  readonly operation: FormulaOperation;
  readonly operands: readonly FormulaOperand[];
  readonly effectiveFrom: number;
  readonly expiresAt?: number;
  readonly lifecycleState: RuleLifecycleState;
  readonly evidenceHash: string;
}

export interface FormulaEvaluationRequest {
  readonly evaluationId: string;
  readonly evaluatedAt: number;
  readonly formula: FormulaDefinition | undefined;
  readonly inputs: Readonly<Record<string, number>>;
}

export interface FormulaEvaluation {
  readonly evaluationId: string;
  readonly formula: RuleReference | undefined;
  readonly inputHash: string;
  readonly result: number | undefined;
  readonly status: "CALCULATED" | "UNKNOWN";
  readonly reasonCodes: readonly string[];
  readonly evidenceHash: string;
  readonly replayHash: string;
  readonly productionMutationAllowed: false;
}

export interface RuleEvaluationRequest {
  readonly evaluationId: string;
  /** Explicit clock supplied by the caller; evaluation never reads wall time. */
  readonly evaluatedAt: number;
  readonly policy: BusinessPolicy | undefined;
  readonly rules: readonly BusinessRule[];
  readonly inputs: Readonly<Record<string, RuleValue>>;
}

export interface RuleExecution {
  readonly rule: RuleReference;
  readonly matched: boolean;
  readonly reason: string;
}

export interface DecisionTrace {
  readonly evaluationId: string;
  readonly policy: PolicyReference | undefined;
  readonly ruleVersions: readonly RuleReference[];
  readonly inputsHash: string;
  readonly normalizedInputs: Readonly<Record<string, RuleValue>>;
  readonly matchedRules: readonly RuleReference[];
  readonly skippedRules: readonly RuleExecution[];
  readonly rejectedRules: readonly RuleExecution[];
  readonly executionOrder: readonly RuleReference[];
  readonly decision: RuleDecision;
  readonly explanation: string;
  /** A logical value to preserve deterministic replay; never wall-clock elapsed time. */
  readonly durationMs: 0;
  readonly evidenceHash: string;
  readonly replayHash: string;
  readonly productionMutationAllowed: false;
}

export enum RulesEventType {
  RULE_REGISTERED = "RULE_REGISTERED",
  RULE_VALIDATED = "RULE_VALIDATED",
  RULE_APPROVED = "RULE_APPROVED",
  RULE_PUBLISHED = "RULE_PUBLISHED",
  RULE_DEPRECATED = "RULE_DEPRECATED",
  RULE_RETIRED = "RULE_RETIRED",
  POLICY_REGISTERED = "POLICY_REGISTERED",
  POLICY_PUBLISHED = "POLICY_PUBLISHED",
  DECISION_EVALUATED = "DECISION_EVALUATED",
  DECISION_SIMULATED = "DECISION_SIMULATED",
  DECISION_REPLAYED = "DECISION_REPLAYED",
  FORMULA_REGISTERED = "FORMULA_REGISTERED",
  FORMULA_PUBLISHED = "FORMULA_PUBLISHED",
  DECISION_EVIDENCE_GENERATED = "DECISION_EVIDENCE_GENERATED",
  DECISION_CERTIFICATION_ISSUED = "DECISION_CERTIFICATION_ISSUED"
}

export interface RulesLedgerEvent {
  readonly eventId: string;
  readonly type: RulesEventType;
  readonly occurredAt: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidenceHash: string;
}

export interface RulesLedgerRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: RulesLedgerEvent;
  readonly hash: string;
}
