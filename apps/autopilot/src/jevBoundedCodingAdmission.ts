import { JevShadowProvider } from "../../cloud/src/ai/jevShadowProvider";
import { validateJevShadowDecision, type JevRequiredModel, type JevRootCause } from "../../cloud/src/ai/jevShadowRouter";

export type JevCodingAdmissionAction = "PROCEED_EXISTING" | "ABSTAIN_EXPENSIVE_INFERENCE";
export type JevCodingAdmissionReason =
  | "DISABLED"
  | "NOT_ELIGIBLE"
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
}

export interface JevCodingAdmissionDecision {
  readonly action: JevCodingAdmissionAction;
  readonly reasonCode: JevCodingAdmissionReason;
  readonly rootCause: JevRootCause | null;
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
const ELIGIBLE_REASON = /(?:audit[-_: ]?recovery|workflow[-_: ]?failure|ci[-_: ]?failure|failure[-_: ]?repair|retry|recovery)/i;
const NON_CODE_ROOT_CAUSES = new Set<JevRootCause>(["INFRA", "AUTH", "RUNNER", "FLAKY"]);
const MIN_ACTIVE_CONFIDENCE = 0.9;

function decision(
  action: JevCodingAdmissionAction,
  reasonCode: JevCodingAdmissionReason,
  rootCause: JevRootCause | null = null,
  requiredModel: JevRequiredModel | null = null,
  confidence = 0,
  provider: "jev" | null = null,
): JevCodingAdmissionDecision {
  return Object.freeze({
    action,
    reasonCode,
    rootCause,
    requiredModel,
    confidence,
    provider,
    aiAuthority: "ZERO_AUTHORITY",
    productionMutationAllowed: false,
    liveAuthority: "NONE",
  });
}

export async function decideJevBoundedCodingAdmission(
  request: JevCodingAdmissionRequest,
  env: JevBoundedCodingAdmissionEnv,
  dependencies: JevAdmissionDependencies = {},
): Promise<JevCodingAdmissionDecision> {
  if (!enabled(env.NUSA_JEV_SHADOW_ENABLED) || !enabled(env.NUSA_JEV_BOUNDED_ROUTING_ENABLED)) {
    return decision("PROCEED_EXISTING", "DISABLED");
  }
  if (!ELIGIBLE_REASON.test(request.reason)) return decision("PROCEED_EXISTING", "NOT_ELIGIBLE");

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
      requestedDecision: "whether-expensive-coding-inference-is-actionable",
    }));
    const routed = validateJevShadowDecision(raw);
    if (routed.confidence < MIN_ACTIVE_CONFIDENCE) {
      return decision("PROCEED_EXISTING", "LOW_CONFIDENCE", routed.rootCause, routed.requiredModel, routed.confidence, "jev");
    }
    if (routed.safeToAutofix === "NO" && NON_CODE_ROOT_CAUSES.has(routed.rootCause)) {
      return decision("ABSTAIN_EXPENSIVE_INFERENCE", "NON_CODE_AUTOFIX_FORBIDDEN", routed.rootCause, routed.requiredModel, routed.confidence, "jev");
    }
    return decision("PROCEED_EXISTING", "JEV_ADMITTED", routed.rootCause, routed.requiredModel, routed.confidence, "jev");
  } catch {
    return decision("PROCEED_EXISTING", "PROVIDER_UNAVAILABLE");
  }
}
