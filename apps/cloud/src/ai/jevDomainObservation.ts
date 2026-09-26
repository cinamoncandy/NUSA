import {
  validateJevShadowDecision,
  type JevRequiredModel,
  type JevShadowDecision,
} from "./jevShadowRouter";
import {
  validateJevResearchAttentionShadowDecision,
  type JevResearchAttentionModelOutput,
} from "./jevResearchAttentionShadow";

export const JEV_DOMAIN_OBSERVATION_SCHEMA_VERSION = 1 as const;

export type JevRolloutStage =
  | "SHADOW"
  | "CALIBRATED_ASSIST"
  | "ACTIVE_ROUTING_ADVISORY";

export type JevDomain =
  | "CORE_EVOLVE"
  | "AUTOPILOT_DEVELOPMENT"
  | "DATA_RESEARCH_INTEGRITY"
  | "MARKET_DATA"
  | "AXIOM_RESEARCH"
  | "STRATEGY_FAMILY"
  | "STRATEGY_GOVERNANCE"
  | "PORTFOLIO_RISK"
  | "PAPER_EXECUTION"
  | "PAPER_LEDGER"
  | "PERFORMANCE_EVIDENCE"
  | "OBSERVABILITY_SRE"
  | "INFRASTRUCTURE_RUNTIME"
  | "SECURITY_IDENTITY"
  | "RELEASE_AUDIT"
  | "INTEGRATION_E2E"
  | "UI_MOBILE";

export type JevDomainTaskType =
  | "WORKFLOW_FAILURE_CLASSIFICATION"
  | "RESEARCH_INTELLIGENCE_ATTENTION_SHADOW"
  | "DUPLICATE_TASK_CLASSIFICATION"
  | "STALE_WIP_CLASSIFICATION"
  | "TEST_SCOPE_RECOMMENDATION"
  | "DATA_INTEGRITY_ANOMALY_CLASSIFICATION"
  | "MARKET_DATA_INCIDENT_CLASSIFICATION"
  | "HYPOTHESIS_DUPLICATE_CLASSIFICATION"
  | "STRATEGY_FAMILY_MATCH_CLASSIFICATION"
  | "GOVERNANCE_EVIDENCE_READINESS_CLASSIFICATION"
  | "RISK_EVENT_CLASSIFICATION"
  | "PAPER_EXECUTION_INCIDENT_CLASSIFICATION"
  | "LEDGER_RECONCILIATION_INCIDENT_CLASSIFICATION"
  | "PERFORMANCE_EVIDENCE_READINESS_CLASSIFICATION"
  | "OBSERVABILITY_INCIDENT_CLASSIFICATION"
  | "RUNTIME_RECOVERY_ELIGIBILITY"
  | "SECURITY_EVENT_CLASSIFICATION"
  | "RELEASE_AUDIT_BLOCKER_CLASSIFICATION"
  | "INTEGRATION_MISMATCH_CLASSIFICATION"
  | "UI_REGRESSION_CLASSIFICATION";

export type JevAdvisoryAction =
  | "OBSERVE"
  | "ESCALATE"
  | "CLASSIFY"
  | "SUMMARIZE"
  | "RECOMMEND_ROUTE"
  | "RECOMMEND_TEST_SCOPE"
  | "RECOMMEND_ESCALATION"
  | "RECOMMEND_AUTOFIX_ELIGIBILITY";

export type JevForbiddenAction =
  | "PROTECTED_TRANSITION"
  | "CANONICAL_TRUTH_MUTATION"
  | "SECRET_ACCESS"
  | "LIVE_MUTATION"
  | "AUDIT_VERDICT"
  | "RELEASE_AUTHORIZATION"
  | "MERGE";

export type JevDecisionSchema =
  | "WORKFLOW_FAILURE_V1"
  | "RESEARCH_ATTENTION_V1"
  | "UNAVAILABLE";

export type JevDecisionPrimitive = string | number | boolean | null;
export type JevStructuredDecision = Readonly<Record<string, JevDecisionPrimitive>>;

export interface JevTaskTypePolicy {
  readonly taskType: JevDomainTaskType;
  readonly domain: JevDomain;
  readonly canonicalOwner: string;
  readonly maxStage: JevRolloutStage;
  readonly calibrationEvidenceVersion: string | null;
  readonly decisionSchema: JevDecisionSchema;
  readonly allowedActions: readonly JevAdvisoryAction[];
  readonly forbiddenActions: readonly JevForbiddenAction[];
}

export interface JevDomainObservation {
  readonly schemaVersion: typeof JEV_DOMAIN_OBSERVATION_SCHEMA_VERSION;
  readonly decisionType: JevDomainTaskType;
  readonly taskType: JevDomainTaskType;
  readonly domain: JevDomain;
  readonly canonicalOwner: string;
  readonly rolloutStage: JevRolloutStage;
  readonly inputFingerprint: string;
  readonly sourceIdentity: string;
  readonly sourceVersion: string;
  readonly decision: JevStructuredDecision;
  readonly requiredModel: JevRequiredModel;
  readonly reasonCode: string;
  readonly confidence: number;
  readonly providerId: string;
  readonly modelIdentity: string;
  readonly providerModelVersion: string;
  readonly timeoutApplied: boolean;
  readonly fallbackApplied: boolean;
  readonly correlationId: string;
  readonly traceId: string;
  readonly timestamp: string;
  readonly usableForRouting: boolean;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
}

export interface CreateJevDomainObservationInput {
  readonly taskType: JevDomainTaskType;
  readonly rolloutStage?: JevRolloutStage;
  readonly inputFingerprint: string;
  readonly sourceIdentity: string;
  readonly sourceVersion: string;
  readonly decision: Readonly<Record<string, unknown>>;
  readonly requiredModel: JevRequiredModel;
  readonly reasonCode: string;
  readonly confidence: number;
  readonly providerId: string;
  readonly modelIdentity: string;
  readonly providerModelVersion: string;
  readonly timeoutApplied: boolean;
  readonly fallbackApplied: boolean;
  readonly correlationId: string;
  readonly traceId: string;
  readonly timestamp?: string;
}

const FORBIDDEN_ACTIONS = Object.freeze([
  "PROTECTED_TRANSITION",
  "CANONICAL_TRUTH_MUTATION",
  "SECRET_ACCESS",
  "LIVE_MUTATION",
  "AUDIT_VERDICT",
  "RELEASE_AUTHORIZATION",
  "MERGE",
] as const);

const OBSERVE_CLASSIFY_ESCALATE = Object.freeze([
  "OBSERVE",
  "CLASSIFY",
  "RECOMMEND_ESCALATION",
] as const);

const OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE = Object.freeze([
  "OBSERVE",
  "CLASSIFY",
  "SUMMARIZE",
  "RECOMMEND_ESCALATION",
] as const);

const STAGE_RANK: Readonly<Record<JevRolloutStage, number>> = Object.freeze({
  SHADOW: 0,
  CALIBRATED_ASSIST: 1,
  ACTIVE_ROUTING_ADVISORY: 2,
});

function policy(
  taskType: JevDomainTaskType,
  domain: JevDomain,
  canonicalOwner: string,
  allowedActions: readonly JevAdvisoryAction[],
  decisionSchema: JevDecisionSchema = "UNAVAILABLE",
): JevTaskTypePolicy {
  return Object.freeze({
    taskType,
    domain,
    canonicalOwner,
    maxStage: "SHADOW" as const,
    calibrationEvidenceVersion: null,
    decisionSchema,
    allowedActions: Object.freeze([...allowedActions]),
    forbiddenActions: FORBIDDEN_ACTIONS,
  });
}

export const JEV_TASK_TYPE_POLICIES: readonly JevTaskTypePolicy[] = Object.freeze([
  policy(
    "WORKFLOW_FAILURE_CLASSIFICATION",
    "AUTOPILOT_DEVELOPMENT",
    "Autopilot deterministic failure/recovery state machine",
    Object.freeze(["OBSERVE", "ESCALATE"]),
    "WORKFLOW_FAILURE_V1",
  ),
  policy(
    "RESEARCH_INTELLIGENCE_ATTENTION_SHADOW",
    "AXIOM_RESEARCH",
    "Research Intelligence Scout and AXIOM deterministic handoff",
    Object.freeze(["OBSERVE", "ESCALATE"]),
    "RESEARCH_ATTENTION_V1",
  ),
  policy(
    "DUPLICATE_TASK_CLASSIFICATION",
    "CORE_EVOLVE",
    "Core/Evolve canonical work orchestration",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "STALE_WIP_CLASSIFICATION",
    "CORE_EVOLVE",
    "Core/Evolve canonical work orchestration",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "TEST_SCOPE_RECOMMENDATION",
    "AUTOPILOT_DEVELOPMENT",
    "Development deterministic validation policy",
    Object.freeze(["OBSERVE", "RECOMMEND_TEST_SCOPE", "RECOMMEND_ESCALATION"]),
  ),
  policy(
    "DATA_INTEGRITY_ANOMALY_CLASSIFICATION",
    "DATA_RESEARCH_INTEGRITY",
    "Data & Research Integrity deterministic validators",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "MARKET_DATA_INCIDENT_CLASSIFICATION",
    "MARKET_DATA",
    "Market Data deterministic connectivity and freshness state",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "HYPOTHESIS_DUPLICATE_CLASSIFICATION",
    "AXIOM_RESEARCH",
    "AXIOM deterministic research/evidence lifecycle",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "STRATEGY_FAMILY_MATCH_CLASSIFICATION",
    "STRATEGY_FAMILY",
    "Strategy Family canonical registry",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "GOVERNANCE_EVIDENCE_READINESS_CLASSIFICATION",
    "STRATEGY_GOVERNANCE",
    "Strategy Governance deterministic lifecycle",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "RISK_EVENT_CLASSIFICATION",
    "PORTFOLIO_RISK",
    "Portfolio/Risk deterministic limits and allocation advisory",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "PAPER_EXECUTION_INCIDENT_CLASSIFICATION",
    "PAPER_EXECUTION",
    "PAPER Execution deterministic order lifecycle",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "LEDGER_RECONCILIATION_INCIDENT_CLASSIFICATION",
    "PAPER_LEDGER",
    "PAPER Ledger canonical accounting and reconciliation",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "PERFORMANCE_EVIDENCE_READINESS_CLASSIFICATION",
    "PERFORMANCE_EVIDENCE",
    "Performance/Evidence canonical measurement layer",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "OBSERVABILITY_INCIDENT_CLASSIFICATION",
    "OBSERVABILITY_SRE",
    "Observability/SRE deterministic health and recovery verification",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "RUNTIME_RECOVERY_ELIGIBILITY",
    "INFRASTRUCTURE_RUNTIME",
    "Infrastructure/Runtime deterministic recovery controller",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "SECURITY_EVENT_CLASSIFICATION",
    "SECURITY_IDENTITY",
    "Security/Identity deterministic policy and incident handling",
    OBSERVE_CLASSIFY_ESCALATE,
  ),
  policy(
    "RELEASE_AUDIT_BLOCKER_CLASSIFICATION",
    "RELEASE_AUDIT",
    "Independent Audit and canonical Release authority",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "INTEGRATION_MISMATCH_CLASSIFICATION",
    "INTEGRATION_E2E",
    "Integration/E2E independent acceptance verifier",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
  policy(
    "UI_REGRESSION_CLASSIFICATION",
    "UI_MOBILE",
    "UI/UX and Mobile deterministic product validation",
    OBSERVE_CLASSIFY_SUMMARIZE_ESCALATE,
  ),
]);

const POLICY_BY_TASK = new Map<JevDomainTaskType, JevTaskTypePolicy>(
  JEV_TASK_TYPE_POLICIES.map((entry) => [entry.taskType, entry]),
);

const FINGERPRINT = /^(?:sha256:)?([a-f0-9]{64})$/i;
const REASON_CODE = /^[A-Z0-9_]{1,64}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CANONICAL_ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENSITIVE_FIELD =
  /authorization|password|secret|token|apikey|api_key|privatekey|private_key|cookie|credential|recoverycode|recovery_code/i;
const SENSITIVE_VALUE =
  /bearer\s+[A-Za-z0-9._~+\/-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

function boundedText(value: string, field: string, maxLength = 256): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    SENSITIVE_VALUE.test(normalized)
  ) {
    throw new Error(`JEV_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function safeDecision(value: Readonly<Record<string, unknown>>): JevStructuredDecision {
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 32) {
    throw new Error("JEV_DECISION_INVALID");
  }
  const output: Record<string, JevDecisionPrimitive> = {};
  for (const [key, raw] of entries) {
    if (!FIELD_NAME.test(key) || SENSITIVE_FIELD.test(key)) {
      throw new Error("JEV_DECISION_SENSITIVE_FIELD");
    }
    if (
      raw !== null &&
      typeof raw !== "string" &&
      typeof raw !== "number" &&
      typeof raw !== "boolean"
    ) {
      throw new Error("JEV_DECISION_VALUE_INVALID");
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      throw new Error("JEV_DECISION_VALUE_INVALID");
    }
    if (
      typeof raw === "string" &&
      (raw.length > 512 ||
        SENSITIVE_VALUE.test(raw) ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw))
    ) {
      throw new Error("JEV_DECISION_VALUE_INVALID");
    }
    output[key] = raw as JevDecisionPrimitive;
  }
  return Object.freeze(output);
}

function normalizeFingerprint(value: string): string {
  const match = value.match(FINGERPRINT);
  if (match == null) throw new Error("JEV_INPUT_FINGERPRINT_INVALID");
  return `sha256:${match[1].toLowerCase()}`;
}

function canonicalTimestamp(value: string | undefined): string {
  const timestamp = value ?? new Date().toISOString();
  if (!CANONICAL_ISO_UTC.test(timestamp)) throw new Error("JEV_TIMESTAMP_INVALID");
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error("JEV_TIMESTAMP_INVALID");
  }
  return timestamp;
}

function validateTaskDecision(
  policy: JevTaskTypePolicy,
  value: Readonly<Record<string, unknown>>,
): JevStructuredDecision {
  let validated: JevShadowDecision | JevResearchAttentionModelOutput;
  if (policy.decisionSchema === "WORKFLOW_FAILURE_V1") {
    validated = validateJevShadowDecision(value);
  } else if (policy.decisionSchema === "RESEARCH_ATTENTION_V1") {
    validated = validateJevResearchAttentionShadowDecision(value);
  } else {
    throw new Error("JEV_TASK_DECISION_VALIDATOR_UNAVAILABLE");
  }
  return safeDecision(validated as unknown as Readonly<Record<string, unknown>>);
}

export function getJevTaskTypePolicy(taskType: JevDomainTaskType): JevTaskTypePolicy {
  const entry = POLICY_BY_TASK.get(taskType);
  if (entry == null) throw new Error("JEV_TASK_TYPE_UNREGISTERED");
  return entry;
}

export function assertJevTaskTypeRegistry(): void {
  if (POLICY_BY_TASK.size !== JEV_TASK_TYPE_POLICIES.length) {
    throw new Error("JEV_TASK_TYPE_DUPLICATE");
  }
  for (const entry of JEV_TASK_TYPE_POLICIES) {
    if (!entry.canonicalOwner.trim()) throw new Error("JEV_CANONICAL_OWNER_REQUIRED");
    if (
      entry.maxStage !== "SHADOW" &&
      (entry.calibrationEvidenceVersion == null || !entry.calibrationEvidenceVersion.trim())
    ) {
      throw new Error("JEV_CALIBRATION_EVIDENCE_REQUIRED");
    }
    if (
      entry.allowedActions.some((action) =>
        (FORBIDDEN_ACTIONS as readonly string[]).includes(action),
      )
    ) {
      throw new Error("JEV_PROTECTED_ACTION_REGISTERED");
    }
  }
}

export function createJevDomainObservation(
  input: CreateJevDomainObservationInput,
): JevDomainObservation {
  assertJevTaskTypeRegistry();
  const taskPolicy = getJevTaskTypePolicy(input.taskType);
  const rolloutStage = input.rolloutStage ?? "SHADOW";
  if (!Object.prototype.hasOwnProperty.call(STAGE_RANK, rolloutStage)) {
    throw new Error("JEV_STAGE_INVALID");
  }
  if (STAGE_RANK[rolloutStage] > STAGE_RANK[taskPolicy.maxStage]) {
    throw new Error("JEV_STAGE_NOT_APPROVED");
  }
  if (!REASON_CODE.test(input.reasonCode)) {
    throw new Error("JEV_REASON_CODE_INVALID");
  }
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new Error("JEV_CONFIDENCE_INVALID");
  }

  const decision = validateTaskDecision(taskPolicy, input.decision);
  if (taskPolicy.decisionSchema === "WORKFLOW_FAILURE_V1") {
    if (
      decision.requiredModel !== input.requiredModel ||
      decision.confidence !== input.confidence
    ) {
      throw new Error("JEV_DECISION_ENVELOPE_MISMATCH");
    }
  }
  if (taskPolicy.decisionSchema === "RESEARCH_ATTENTION_V1") {
    if (
      decision.confidence !== input.confidence ||
      decision.reasonCode !== input.reasonCode
    ) {
      throw new Error("JEV_DECISION_ENVELOPE_MISMATCH");
    }
  }

  return Object.freeze({
    schemaVersion: JEV_DOMAIN_OBSERVATION_SCHEMA_VERSION,
    decisionType: input.taskType,
    taskType: input.taskType,
    domain: taskPolicy.domain,
    canonicalOwner: taskPolicy.canonicalOwner,
    rolloutStage,
    inputFingerprint: normalizeFingerprint(input.inputFingerprint),
    sourceIdentity: boundedText(input.sourceIdentity, "source_identity", 512),
    sourceVersion: boundedText(input.sourceVersion, "source_version", 256),
    decision,
    requiredModel: input.requiredModel,
    reasonCode: input.reasonCode,
    confidence: input.confidence,
    providerId: boundedText(input.providerId, "provider_id", 128),
    modelIdentity: boundedText(input.modelIdentity, "model_identity", 128),
    providerModelVersion: boundedText(
      input.providerModelVersion,
      "provider_model_version",
      128,
    ),
    timeoutApplied: input.timeoutApplied,
    fallbackApplied: input.fallbackApplied,
    correlationId: boundedText(input.correlationId, "correlation_id", 256),
    traceId: boundedText(input.traceId, "trace_id", 256),
    timestamp: canonicalTimestamp(input.timestamp),
    usableForRouting: rolloutStage === "ACTIVE_ROUTING_ADVISORY",
    aiAuthority: "ZERO_AUTHORITY",
    productionMutationAllowed: false,
    liveAuthority: "NONE",
  });
}
