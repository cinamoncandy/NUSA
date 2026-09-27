import { JevShadowProvider } from "../../cloud/src/ai/jevShadowProvider";
import { validateJevShadowDecision, type JevRequiredModel, type JevRootCause } from "../../cloud/src/ai/jevShadowRouter";

export type JevCodingAdmissionAction = "PROCEED_EXISTING" | "ABSTAIN_EXPENSIVE_INFERENCE";
export type JevCodingAdmissionReason =
  | "DISABLED"
  | "NOT_ELIGIBLE"
  | "REPAIR_ATTEMPT_REUSES_INITIAL_ADMISSION"
  | "FAILURE_EVIDENCE_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "LOW_CONFIDENCE"
  | "JEV_ADMITTED"
  | "NON_CODE_AUTOFIX_FORBIDDEN";

export interface JevBoundedCodingAdmissionEnv {
  readonly NUSA_JEV_SHADOW_ENABLED?: string;
  readonly NUSA_JEV_BOUNDED_ROUTING_ENABLED?: string;
  readonly NUSA_JEV_API_KEY?: string;
  readonly NUSA_JEV_ENDPOINT?: string;
  readonly NUSA_JEV_TIMEOUT_MS?: string;
}

export interface JevCodingAdmissionRequest {
  readonly headSha: string;
  readonly workflowRunId: number;
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly reason: string;
  readonly proposalFeedback?: string;
  readonly proposalContext?: unknown;
}

export interface JevCodingFailureEvidence {
  readonly workflowRunId: number;
  readonly headSha: string;
  readonly workflowName: string | null;
  readonly workflowEvent: string | null;
  readonly workflowConclusion: "failure" | "cancelled" | "timed_out";
  readonly failedJobs: readonly string[];
  readonly failedSteps: readonly string[];
}

export interface JevCodingAdmissionDecision {
  readonly action: JevCodingAdmissionAction;
  readonly reasonCode: JevCodingAdmissionReason;
  readonly rootCause: JevRootCause | null;
  readonly safeToAutofix: "YES" | "NO" | null;
  readonly severity: 1 | 2 | 3 | 4 | 5 | null;
  readonly requiredModel: JevRequiredModel | null;
  readonly confidence: number;
  readonly provider: "jev" | null;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
}

interface JevAdmissionDependencies {
  readonly classify?: (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";
const CANONICAL_GHA_FAILURE = /^gha:(\d+):([0-9a-f]{40}):(failure|cancelled|timed_out)$/i;
const LEGACY_ELIGIBLE_REASON = /(?:workflow[-_: ]?failure|ci[-_: ]?failure|failure[-_: ]?repair|retry|recovery)/i;
const SAFE_EVIDENCE_LABEL = /^[A-Za-z0-9_.:/ ()\[\]-]{1,128}$/;
const NON_CODE_ROOT_CAUSES = new Set<JevRootCause>(["INFRA", "AUTH", "RUNNER", "FLAKY"]);
const MIN_ACTIVE_CONFIDENCE = 0.9;
const MAX_FAILED_JOBS = 8;
const MAX_FAILED_STEPS = 16;

function decision(
  action: JevCodingAdmissionAction,
  reasonCode: JevCodingAdmissionReason,
  rootCause: JevRootCause | null = null,
  requiredModel: JevRequiredModel | null = null,
  confidence = 0,
  provider: "jev" | null = null,
  safeToAutofix: "YES" | "NO" | null = null,
  severity: 1 | 2 | 3 | 4 | 5 | null = null,
): JevCodingAdmissionDecision {
  return Object.freeze({
    action,
    reasonCode,
    rootCause,
    safeToAutofix,
    severity,
    requiredModel,
    confidence,
    provider,
    aiAuthority: "ZERO_AUTHORITY",
    productionMutationAllowed: false,
    liveAuthority: "NONE",
  });
}

function reasonEligible(request: JevCodingAdmissionRequest): boolean {
  const canonical = request.reason.match(CANONICAL_GHA_FAILURE);
  if (canonical) {
    return Number(canonical[1]) === request.workflowRunId
      && canonical[2].toLowerCase() === request.headSha.toLowerCase();
  }
  return LEGACY_ELIGIBLE_REASON.test(request.reason);
}

export function isJevBoundedCodingAdmissionCandidate(
  request: JevCodingAdmissionRequest,
  env: JevBoundedCodingAdmissionEnv,
): boolean {
  return enabled(env.NUSA_JEV_SHADOW_ENABLED)
    && enabled(env.NUSA_JEV_BOUNDED_ROUTING_ENABLED)
    && request.proposalFeedback == null
    && request.proposalContext == null
    && reasonEligible(request);
}

function validateFailureEvidence(
  evidence: JevCodingFailureEvidence | null | undefined,
  request: JevCodingAdmissionRequest,
): JevCodingFailureEvidence | null {
  if (!evidence
    || evidence.workflowRunId !== request.workflowRunId
    || evidence.headSha.toLowerCase() !== request.headSha.toLowerCase()
    || !["failure", "cancelled", "timed_out"].includes(evidence.workflowConclusion)) {
    return null;
  }
  const failedJobs = evidence.failedJobs
    .filter((value) => SAFE_EVIDENCE_LABEL.test(value))
    .slice(0, MAX_FAILED_JOBS);
  const failedSteps = evidence.failedSteps
    .filter((value) => SAFE_EVIDENCE_LABEL.test(value))
    .slice(0, MAX_FAILED_STEPS);
  if (failedJobs.length === 0 && failedSteps.length === 0) return null;
  return Object.freeze({
    workflowRunId: evidence.workflowRunId,
    headSha: evidence.headSha.toLowerCase(),
    workflowName: evidence.workflowName && SAFE_EVIDENCE_LABEL.test(evidence.workflowName) ? evidence.workflowName : null,
    workflowEvent: evidence.workflowEvent && SAFE_EVIDENCE_LABEL.test(evidence.workflowEvent) ? evidence.workflowEvent : null,
    workflowConclusion: evidence.workflowConclusion,
    failedJobs: Object.freeze(failedJobs),
    failedSteps: Object.freeze(failedSteps),
  });
}

export async function decideJevBoundedCodingAdmission(
  request: JevCodingAdmissionRequest,
  env: JevBoundedCodingAdmissionEnv,
  dependencies: JevAdmissionDependencies = {},
  failureEvidence?: JevCodingFailureEvidence | null,
): Promise<JevCodingAdmissionDecision> {
  if (!enabled(env.NUSA_JEV_SHADOW_ENABLED) || !enabled(env.NUSA_JEV_BOUNDED_ROUTING_ENABLED)) {
    return decision("PROCEED_EXISTING", "DISABLED");
  }
  if (request.proposalFeedback != null || request.proposalContext != null) {
    return decision("PROCEED_EXISTING", "REPAIR_ATTEMPT_REUSES_INITIAL_ADMISSION");
  }
  if (!reasonEligible(request)) return decision("PROCEED_EXISTING", "NOT_ELIGIBLE");

  const evidence = validateFailureEvidence(failureEvidence, request);
  if (!evidence) return decision("PROCEED_EXISTING", "FAILURE_EVIDENCE_REQUIRED");

  let classify = dependencies.classify;
  if (!classify) {
    const apiKey = env.NUSA_JEV_API_KEY?.trim();
    const endpoint = env.NUSA_JEV_ENDPOINT?.trim();
    if (!apiKey || !endpoint) return decision("PROCEED_EXISTING", "PROVIDER_NOT_CONFIGURED");
    const rawTimeout = env.NUSA_JEV_TIMEOUT_MS?.trim();
    const timeoutMs = rawTimeout ? Number(rawTimeout) : undefined;
    try {
      const provider = new JevShadowProvider({ apiKey, endpoint, timeoutMs });
      classify = (input) => provider.classifyBounded(input);
    } catch {
      return decision("PROCEED_EXISTING", "PROVIDER_NOT_CONFIGURED");
    }
  }

  try {
    const raw = await classify(Object.freeze({
      taskType: "AUTOPILOT_CODING_ADMISSION",
      repository: "cinamoncandy/NUSA",
      headSha: request.headSha.toLowerCase(),
      workflowRunId: request.workflowRunId,
      executionId: request.executionId,
      dedupeKey: request.dedupeKey,
      reason: request.reason.slice(0, 512),
      failureEvidence: Object.freeze({
        workflowRunId: evidence.workflowRunId,
        workflowName: evidence.workflowName,
        workflowEvent: evidence.workflowEvent,
        workflowConclusion: evidence.workflowConclusion,
        failedJobs: evidence.failedJobs,
        failedSteps: evidence.failedSteps,
      }),
      requestedDecision: "whether-expensive-coding-inference-is-actionable",
    }));
    const routed = validateJevShadowDecision(raw);
    if (routed.confidence < MIN_ACTIVE_CONFIDENCE) {
      return decision("PROCEED_EXISTING", "LOW_CONFIDENCE", routed.rootCause, routed.requiredModel, routed.confidence, "jev", routed.safeToAutofix, routed.severity);
    }
    if (routed.safeToAutofix === "NO" && NON_CODE_ROOT_CAUSES.has(routed.rootCause)) {
      return decision("ABSTAIN_EXPENSIVE_INFERENCE", "NON_CODE_AUTOFIX_FORBIDDEN", routed.rootCause, routed.requiredModel, routed.confidence, "jev", routed.safeToAutofix, routed.severity);
    }
    return decision("PROCEED_EXISTING", "JEV_ADMITTED", routed.rootCause, routed.requiredModel, routed.confidence, "jev", routed.safeToAutofix, routed.severity);
  } catch {
    return decision("PROCEED_EXISTING", "PROVIDER_UNAVAILABLE");
  }
}
