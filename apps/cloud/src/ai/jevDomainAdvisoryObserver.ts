import {
  createJevDomainObservation,
  getJevTaskTypePolicy,
  type JevDomainObservation,
  type JevDomainTaskType,
  type JevStructuredDecision,
} from "./jevDomainObservation";

export type JevDomainEvidencePrimitive = string | number | boolean | null;
export type JevDomainEvidenceMetadata = Readonly<Record<string, JevDomainEvidencePrimitive>>;

export interface JevDomainAdvisoryObservationRequest {
  readonly taskType: JevDomainTaskType;
  readonly inputFingerprint: string;
  readonly sourceIdentity: string;
  readonly sourceVersion: string;
  readonly evidence: JevDomainEvidenceMetadata;
  readonly providerId: string;
  readonly modelIdentity: string;
  readonly providerModelVersion: string;
  readonly timeoutApplied: boolean;
  readonly correlationId: string;
  readonly traceId: string;
  readonly timestamp?: string;
}

export interface JevDomainAdvisoryObserverOptions {
  readonly minConfidence?: number;
  readonly enabled?: boolean;
}

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SENSITIVE_FIELD = /authorization|password|secret|token|apikey|api_key|privatekey|private_key|cookie|credential|recoverycode|recovery_code/i;
const SENSITIVE_VALUE =
  /bearer\s+[A-Za-z0-9._~+\/-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9-]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/i;

function safeEvidence(input: JevDomainEvidenceMetadata): JevDomainEvidenceMetadata {
  const entries = Object.entries(input);
  if (entries.length === 0 || entries.length > 32) throw new Error("JEV_DOMAIN_EVIDENCE_INVALID");
  const output: Record<string, JevDomainEvidencePrimitive> = {};
  for (const [key, value] of entries) {
    if (!FIELD.test(key) || SENSITIVE_FIELD.test(key)) throw new Error("JEV_DOMAIN_EVIDENCE_SENSITIVE_FIELD");
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error("JEV_DOMAIN_EVIDENCE_VALUE_INVALID");
    }
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("JEV_DOMAIN_EVIDENCE_VALUE_INVALID");
    if (typeof value === "string" && (
      value.length > 512
      || SENSITIVE_VALUE.test(value)
      || /[\u0000-\u001f\u007f]/.test(value)
    )) {
      throw new Error("JEV_DOMAIN_EVIDENCE_VALUE_INVALID");
    }
    output[key] = value;
  }
  return Object.freeze(output);
}

function fallbackClassification(taskType: JevDomainTaskType): string {
  const policy = getJevTaskTypePolicy(taskType);
  if (policy.classificationValues == null || policy.classificationValues.length === 0) {
    throw new Error("JEV_DOMAIN_ADVISORY_POLICY_REQUIRED");
  }
  if (policy.classificationValues.includes("UNKNOWN")) return "UNKNOWN";
  if (taskType === "TEST_SCOPE_RECOMMENDATION" && policy.classificationValues.includes("FULL")) return "FULL";
  throw new Error("JEV_DOMAIN_ADVISORY_SAFE_FALLBACK_MISSING");
}

function fallbackDecision(
  taskType: JevDomainTaskType,
  reasonCode: string,
): JevStructuredDecision {
  return Object.freeze({
    classification: fallbackClassification(taskType),
    severity: 5,
    requiredModel: "HUMAN",
    reasonCode,
    confidence: 0,
  });
}

export class JevDomainAdvisoryShadowObserver {
  private readonly minConfidence: number;
  private readonly enabled: boolean;

  public constructor(
    private readonly classify: (input: Readonly<Record<string, unknown>>) => Promise<unknown>,
    options: JevDomainAdvisoryObserverOptions = {},
  ) {
    this.minConfidence = options.minConfidence ?? 0.5;
    this.enabled = options.enabled ?? true;
    if (!Number.isFinite(this.minConfidence) || this.minConfidence < 0 || this.minConfidence > 1) {
      throw new Error("JEV_DOMAIN_OBSERVER_CONFIDENCE_INVALID");
    }
  }

  public async observe(request: JevDomainAdvisoryObservationRequest): Promise<JevDomainObservation> {
    const policy = getJevTaskTypePolicy(request.taskType);
    if (policy.decisionSchema !== "DOMAIN_ADVISORY_V1") {
      throw new Error("JEV_DOMAIN_ADVISORY_POLICY_REQUIRED");
    }
    const evidence = safeEvidence(request.evidence);
    const createFallback = (reasonCode: string, timeoutApplied = request.timeoutApplied) =>
      createJevDomainObservation({
        taskType: request.taskType,
        inputFingerprint: request.inputFingerprint,
        sourceIdentity: request.sourceIdentity,
        sourceVersion: request.sourceVersion,
        decision: fallbackDecision(request.taskType, reasonCode),
        requiredModel: "HUMAN",
        reasonCode,
        confidence: 0,
        providerId: request.providerId,
        modelIdentity: request.modelIdentity,
        providerModelVersion: request.providerModelVersion,
        timeoutApplied,
        fallbackApplied: true,
        correlationId: request.correlationId,
        traceId: request.traceId,
        ...(request.timestamp == null ? {} : { timestamp: request.timestamp }),
      });

    // Validate every common envelope field before any metadata leaves the process.
    void createFallback("PREFLIGHT");

    if (!this.enabled) return createFallback("DISABLED_FALLBACK");

    let raw: unknown;
    try {
      raw = await this.classify(Object.freeze({
        decisionType: request.taskType,
        taskType: request.taskType,
        domain: policy.domain,
        canonicalOwner: policy.canonicalOwner,
        allowedClassifications: policy.classificationValues,
        evidence,
        sourceIdentity: request.sourceIdentity,
        sourceVersion: request.sourceVersion,
        rolloutStage: "SHADOW",
        usableForRouting: false,
        aiAuthority: "ZERO_AUTHORITY",
        productionMutationAllowed: false,
        liveAuthority: "NONE",
      }));
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      if (name === "TimeoutError" || name === "AbortError") return createFallback("TIMEOUT_FALLBACK", true);
      if (name === "JevProviderUnavailableError") return createFallback("PROVIDER_UNAVAILABLE_FALLBACK");
      return createFallback("SHADOW_FAILURE_FALLBACK");
    }

    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return createFallback("MALFORMED_RESPONSE_FALLBACK");
    }
    const value = raw as Record<string, unknown>;
    const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? value.confidence
      : -1;
    if (confidence < this.minConfidence) return createFallback("LOW_CONFIDENCE_FALLBACK");

    try {
      const requiredModel = typeof value.requiredModel === "string" ? value.requiredModel : "";
      const reasonCode = typeof value.reasonCode === "string" ? value.reasonCode : "";
      return createJevDomainObservation({
        taskType: request.taskType,
        inputFingerprint: request.inputFingerprint,
        sourceIdentity: request.sourceIdentity,
        sourceVersion: request.sourceVersion,
        decision: value,
        requiredModel: requiredModel as never,
        reasonCode,
        confidence,
        providerId: request.providerId,
        modelIdentity: request.modelIdentity,
        providerModelVersion: request.providerModelVersion,
        timeoutApplied: request.timeoutApplied,
        fallbackApplied: false,
        correlationId: request.correlationId,
        traceId: request.traceId,
        ...(request.timestamp == null ? {} : { timestamp: request.timestamp }),
      });
    } catch {
      return createFallback("MALFORMED_RESPONSE_FALLBACK");
    }
  }
}
