import { createHash } from "node:crypto";
import type { RemediationProposal } from "./improvementTypes";
import type { RemediationVerificationResult } from "./remediationVerification";

export type RemediationPlanEvaluationStatus = "ACCEPTED" | "REJECTED";

export type RemediationPlanRejectionCode =
  | "CANDIDATE_MISSING"
  | "CANDIDATE_MALFORMED"
  | "UPSTREAM_VERIFICATION_MISSING"
  | "UPSTREAM_VERIFICATION_REJECTED"
  | "UPSTREAM_VERIFICATION_MISMATCH"
  | "UPSTREAM_VERIFICATION_STALE"
  | "PROPOSAL_MISSING"
  | "PROPOSAL_BLOCKED"
  | "PROPOSAL_SCOPE_MISMATCH"
  | "SCOPE_OUT_OF_SCOPE"
  | "PROTECTED_SURFACE"
  | "RISK_BOUND_EXCEEDED"
  | "DEPENDENCY_MISSING"
  | "DEPENDENCY_CYCLE"
  | "DUPLICATE_STEP"
  | "PREREQUISITE_MISSING"
  | "ROLLBACK_MISSING"
  | "ROLLBACK_INCOMPLETE"
  | "ROLLBACK_DEPENDENCY_INVALID"
  | "IRREVERSIBLE_STEP"
  | "VERIFICATION_PLAN_MISSING"
  | "VERIFICATION_COVERAGE_INCOMPLETE"
  | "PROVENANCE_INVALID"
  | "BOUND_EXCEEDED";

export interface RemediationPlanStep {
  readonly id: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly affectedSurfaces: readonly string[];
  readonly reversible: boolean;
  readonly verificationIds: readonly string[];
}

export interface RemediationRollbackStep {
  readonly id: string;
  readonly forStepId: string;
  readonly description: string;
  readonly dependencies: readonly string[];
}

export interface RemediationVerificationPlanEntry {
  readonly id: string;
  readonly stepId: string;
  readonly expectedOutcome: string;
  readonly failureCondition: string;
}

export interface RemediationPlanCandidate {
  readonly id: string;
  readonly proposalId: string;
  readonly verificationId: string;
  readonly steps: readonly RemediationPlanStep[];
  readonly declaredScope: readonly string[];
  readonly prerequisites: readonly string[];
  readonly riskClass: "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
  readonly riskScore: number;
  readonly riskBound: number;
  readonly rollbackSteps: readonly RemediationRollbackStep[];
  readonly verificationPlan: readonly RemediationVerificationPlanEntry[];
  readonly affectedSurfaces: readonly string[];
  readonly provenanceFingerprint: string;
}

export interface RemediationPlanEvaluation {
  readonly planId: string;
  readonly status: RemediationPlanEvaluationStatus;
  readonly accepted: boolean;
  readonly rejectionReasons: readonly RemediationPlanRejectionCode[];
  readonly validatedPreconditions: readonly string[];
  readonly dependencyOrder: readonly string[];
  readonly dependencyValid: boolean;
  readonly scopeValid: boolean;
  readonly blastRadius: readonly string[];
  readonly blastRadiusValid: boolean;
  readonly rollbackValid: boolean;
  readonly verificationCoverageValid: boolean;
  readonly rankingTuple: readonly (number | string)[];
  readonly provenanceFingerprint: string;
  readonly evaluationFingerprint: string;
}

export interface RemediationPlanEvaluationResult {
  readonly evaluatedCandidates: readonly RemediationPlanEvaluation[];
  readonly acceptedCandidates: readonly RemediationPlanEvaluation[];
  readonly rejectedCandidates: readonly RemediationPlanEvaluation[];
  readonly bestCandidateId: string | null;
  readonly failClosed: boolean;
  readonly canonicalHash: string;
}

export interface RemediationPlanEvaluationContext {
  readonly proposals: readonly RemediationProposal[];
  readonly verifications: readonly RemediationVerificationResult[];
  /** Optional caller-supplied observation boundary; the evaluator never reads a clock. */
  readonly asOfTimestamp?: number;
  readonly maxVerificationAgeMs?: number;
  readonly maxCandidates?: number;
  readonly maxStepsPerCandidate?: number;
  readonly maxAffectedSurfaces?: number;
}

const MAX_CANDIDATES = 32;
const MAX_STEPS = 64;
const MAX_SURFACES = 64;
const NON_EMPTY = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const SAFE_INT = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const PROTECTED = /(^|[^a-z])(live|real|broker|order|risk|credential|secret|production|authority|withdraw|transfer)([^a-z]|$)/i;
const compareStable = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStable);
}

function validStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(NON_EMPTY);
}

function validCandidate(value: unknown, maxSteps: number, maxSurfaces: number): value is RemediationPlanCandidate {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Partial<RemediationPlanCandidate>;
  if (!NON_EMPTY(candidate.id) || !NON_EMPTY(candidate.proposalId) || !NON_EMPTY(candidate.verificationId)) return false;
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0 || candidate.steps.length > maxSteps) return false;
  if (!validStringList(candidate.declaredScope) || candidate.declaredScope.length === 0) return false;
  if (!validStringList(candidate.prerequisites) || candidate.prerequisites.length === 0) return false;
  if (!["LOW", "MEDIUM", "HIGH", "BLOCKED"].includes(candidate.riskClass ?? "")) return false;
  if (!SAFE_INT(candidate.riskScore) || !SAFE_INT(candidate.riskBound) || candidate.riskScore > candidate.riskBound) return false;
  if (!Array.isArray(candidate.rollbackSteps) || !Array.isArray(candidate.verificationPlan)) return false;
  if (!validStringList(candidate.affectedSurfaces) || candidate.affectedSurfaces.length === 0 || candidate.affectedSurfaces.length > maxSurfaces) return false;
  if (!NON_EMPTY(candidate.provenanceFingerprint)) return false;
  return candidate.steps.every((step) => step != null && typeof step === "object"
    && NON_EMPTY(step.id) && NON_EMPTY(step.description) && validStringList(step.dependencies)
    && validStringList(step.affectedSurfaces) && typeof step.reversible === "boolean" && validStringList(step.verificationIds))
    && candidate.rollbackSteps.every((step) => step != null && typeof step === "object"
      && NON_EMPTY(step.id) && NON_EMPTY(step.forStepId) && NON_EMPTY(step.description) && validStringList(step.dependencies))
    && candidate.verificationPlan.every((entry) => entry != null && typeof entry === "object"
      && NON_EMPTY(entry.id) && NON_EMPTY(entry.stepId) && NON_EMPTY(entry.expectedOutcome) && NON_EMPTY(entry.failureCondition));
}

function topologicalOrder(nodes: readonly { readonly id: string; readonly dependencies: readonly string[] }[]): { order: string[]; reasons: RemediationPlanRejectionCode[] } {
  const ids = new Set(nodes.map((node) => node.id));
  const reasons: RemediationPlanRejectionCode[] = [];
  if (ids.size !== nodes.length) reasons.push("DUPLICATE_STEP");
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  for (const node of nodes) for (const dependency of node.dependencies) if (!ids.has(dependency)) reasons.push("DEPENDENCY_MISSING");
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const node of nodes) for (const dependency of uniqueSorted(node.dependencies)) {
    if (!byId.has(dependency)) continue;
    indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
    outgoing.get(dependency)!.push(node.id);
  }
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareStable);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of (outgoing.get(id) ?? []).sort(compareStable)) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
    ready.sort((a, b) => a.localeCompare(b));
  }
  if (order.length !== nodes.length) reasons.push("DEPENDENCY_CYCLE");
  return { order, reasons: uniqueSorted(reasons) as RemediationPlanRejectionCode[] };
}

function evaluateCandidate(candidate: RemediationPlanCandidate | null | undefined, context: RemediationPlanEvaluationContext, limits: { maxSteps: number; maxSurfaces: number }): RemediationPlanEvaluation {
  if (candidate == null || typeof candidate !== "object") {
    const rejectionReasons = Object.freeze(["CANDIDATE_MALFORMED"] as const);
    const identity = { planId: "unknown", status: "REJECTED", rejectionReasons, dependencyOrder: [], rankingTuple: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0, "unknown"], provenanceFingerprint: "" };
    return Object.freeze({ planId: "unknown", status: "REJECTED", accepted: false, rejectionReasons, validatedPreconditions: Object.freeze([]), dependencyOrder: Object.freeze([]), dependencyValid: false, scopeValid: false, blastRadius: Object.freeze([]), blastRadiusValid: false, rollbackValid: false, verificationCoverageValid: false, rankingTuple: identity.rankingTuple, provenanceFingerprint: "", evaluationFingerprint: hash(identity) });
  }
  const input = candidate as Partial<RemediationPlanCandidate>;
  const steps: readonly RemediationPlanStep[] = Array.isArray(input.steps) ? input.steps as readonly RemediationPlanStep[] : [];
  const declaredScope: readonly string[] = Array.isArray(input.declaredScope) ? input.declaredScope as readonly string[] : [];
  const prerequisites: readonly string[] = Array.isArray(input.prerequisites) ? input.prerequisites as readonly string[] : [];
  const rollbackSteps: readonly RemediationRollbackStep[] = Array.isArray(input.rollbackSteps) ? input.rollbackSteps as readonly RemediationRollbackStep[] : [];
  const verificationPlan: readonly RemediationVerificationPlanEntry[] = Array.isArray(input.verificationPlan) ? input.verificationPlan as readonly RemediationVerificationPlanEntry[] : [];
  const affectedSurfaces: readonly string[] = Array.isArray(input.affectedSurfaces) ? input.affectedSurfaces as readonly string[] : [];
  const reasons: RemediationPlanRejectionCode[] = [];
  const proposal = context.proposals.find((item) => item.id === input.proposalId);
  const verification = context.verifications.find((item) => item.proposalId === input.proposalId);
  if (!validCandidate(candidate, limits.maxSteps, limits.maxSurfaces)) reasons.push("CANDIDATE_MALFORMED");
  if (proposal === undefined) reasons.push("PROPOSAL_MISSING");
  else if (proposal.status !== "PROPOSED" || proposal.executable !== false) reasons.push("PROPOSAL_BLOCKED");
  if (verification === undefined) reasons.push("UPSTREAM_VERIFICATION_MISSING");
  else {
    if (verification.id !== input.verificationId || verification.proposalId !== input.proposalId || verification.executable !== false || verification.dryRun !== true || verification.replayable !== true) reasons.push("UPSTREAM_VERIFICATION_MISMATCH");
    if (verification.status !== "PASS") reasons.push("UPSTREAM_VERIFICATION_REJECTED");
    if (verification.canonicalHash !== input.provenanceFingerprint) reasons.push("PROVENANCE_INVALID");
    const verifiedAt = (verification as RemediationVerificationResult & { readonly verifiedAt?: unknown }).verifiedAt;
    if (context.asOfTimestamp !== undefined) {
      if (!SAFE_INT(context.asOfTimestamp) || verifiedAt === undefined || !SAFE_INT(verifiedAt)) reasons.push("UPSTREAM_VERIFICATION_STALE");
      else if (verifiedAt > context.asOfTimestamp || context.asOfTimestamp - verifiedAt > (context.maxVerificationAgeMs ?? 24 * 60 * 60 * 1_000)) reasons.push("UPSTREAM_VERIFICATION_STALE");
    }
  }
  if (proposal !== undefined && (declaredScope.length !== 1 || declaredScope[0] !== proposal.changeSurface)) reasons.push("PROPOSAL_SCOPE_MISMATCH");
  if (declaredScope.some((surface) => surface !== "OBSERVABILITY")) reasons.push("SCOPE_OUT_OF_SCOPE");
  const declaredScopeSet = new Set(declaredScope.map((surface) => surface.toUpperCase()));
  const candidateSurfaces = [...affectedSurfaces, ...steps.flatMap((step) => step?.affectedSurfaces ?? [])];
  if (candidateSurfaces.some((surface) => !declaredScopeSet.has(surface.toUpperCase()))) reasons.push("SCOPE_OUT_OF_SCOPE");
  if (declaredScope.some((surface) => PROTECTED.test(surface)) || affectedSurfaces.some((surface) => PROTECTED.test(surface)) || steps.some((step) => step?.affectedSurfaces?.some((surface) => PROTECTED.test(surface)))) reasons.push("PROTECTED_SURFACE");
  if (input.riskClass !== "LOW" || input.riskScore !== undefined && input.riskBound !== undefined && input.riskScore > input.riskBound) reasons.push("RISK_BOUND_EXCEEDED");
  const forward = topologicalOrder(steps);
  reasons.push(...forward.reasons);
  if (prerequisites.length === 0) reasons.push("PREREQUISITE_MISSING");
  if (rollbackSteps.length === 0) reasons.push("ROLLBACK_MISSING");
  const rollbackIds = new Set(rollbackSteps.map((step) => step?.forStepId));
  if (steps.some((step) => !rollbackIds.has(step?.id))) reasons.push("ROLLBACK_INCOMPLETE");
  const rollback = topologicalOrder(rollbackSteps.map((step) => ({ id: step.id, dependencies: step.dependencies })));
  if (rollback.reasons.length > 0) reasons.push("ROLLBACK_DEPENDENCY_INVALID");
  if (steps.some((step) => !step?.reversible)) reasons.push("IRREVERSIBLE_STEP");
  if (verificationPlan.length === 0) reasons.push("VERIFICATION_PLAN_MISSING");
  const verificationIds = new Set(verificationPlan.map((entry) => entry?.id));
  if (verificationIds.size !== verificationPlan.length
    || verificationPlan.some((entry) => !steps.some((step) => step?.id === entry?.stepId))
    || steps.some((step) => !step?.verificationIds || step.verificationIds.length === 0 || step.verificationIds.some((id) => !verificationIds.has(id)))) reasons.push("VERIFICATION_COVERAGE_INCOMPLETE");
  const blastRadius = uniqueSorted([...affectedSurfaces, ...steps.flatMap((step) => step?.affectedSurfaces ?? [])]);
  const coverage = steps.filter((step) => step?.verificationIds && step.verificationIds.length > 0).length;
  const rankingTuple: readonly (number | string)[] = [input.riskScore ?? Number.MAX_SAFE_INTEGER, blastRadius.length, steps.length, -coverage, input.id ?? "unknown"];
  const orderedReasons = Object.freeze(uniqueSorted(reasons) as RemediationPlanRejectionCode[]);
  const accepted = orderedReasons.length === 0;
  const identity = { planId: input.id ?? "unknown", status: accepted ? "ACCEPTED" : "REJECTED", rejectionReasons: orderedReasons, dependencyOrder: forward.order, rankingTuple, provenanceFingerprint: input.provenanceFingerprint ?? "" };
  return Object.freeze({
    planId: input.id ?? "unknown",
    status: accepted ? "ACCEPTED" as const : "REJECTED" as const,
    accepted,
    rejectionReasons: orderedReasons,
    validatedPreconditions: Object.freeze(uniqueSorted(prerequisites)),
    dependencyOrder: Object.freeze(forward.order),
    dependencyValid: forward.reasons.length === 0,
    scopeValid: !orderedReasons.includes("PROPOSAL_SCOPE_MISMATCH") && !orderedReasons.includes("SCOPE_OUT_OF_SCOPE"),
    blastRadius: Object.freeze(blastRadius),
    blastRadiusValid: !orderedReasons.includes("PROTECTED_SURFACE"),
    rollbackValid: !orderedReasons.some((reason) => ["ROLLBACK_MISSING", "ROLLBACK_INCOMPLETE", "ROLLBACK_DEPENDENCY_INVALID", "IRREVERSIBLE_STEP"].includes(reason)),
    verificationCoverageValid: !orderedReasons.includes("VERIFICATION_PLAN_MISSING") && !orderedReasons.includes("VERIFICATION_COVERAGE_INCOMPLETE"),
    rankingTuple,
    provenanceFingerprint: input.provenanceFingerprint ?? "",
    evaluationFingerprint: hash(identity)
  });
}

/** Evaluates advisory plans only. This function has no filesystem, git, shell, broker, or runtime mutation capability. */
export function evaluateRemediationPlans(candidates: readonly RemediationPlanCandidate[], context: RemediationPlanEvaluationContext): RemediationPlanEvaluationResult {
  const maxCandidates = context.maxCandidates ?? MAX_CANDIDATES;
  const maxSteps = context.maxStepsPerCandidate ?? MAX_STEPS;
  const maxSurfaces = context.maxAffectedSurfaces ?? MAX_SURFACES;
  if (!Array.isArray(candidates) || !Array.isArray(context?.proposals) || !Array.isArray(context?.verifications)
    || !SAFE_INT(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_CANDIDATES
    || !SAFE_INT(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS
    || !SAFE_INT(maxSurfaces) || maxSurfaces < 1 || maxSurfaces > MAX_SURFACES
    || candidates.length > maxCandidates) {
    const empty = Object.freeze([]) as readonly RemediationPlanEvaluation[];
    return Object.freeze({ evaluatedCandidates: empty, acceptedCandidates: empty, rejectedCandidates: empty, bestCandidateId: null, failClosed: true, canonicalHash: hash({ candidates: [], failClosed: true }) });
  }
  const sorted = [...candidates].sort((left, right) => String(left?.id ?? "").localeCompare(String(right?.id ?? "")));
  const evaluated = sorted.map((candidate) => evaluateCandidate(candidate, context, { maxSteps, maxSurfaces }));
  const accepted = evaluated.filter((item) => item.accepted).sort((left, right) => {
    for (let index = 0; index < left.rankingTuple.length; index += 1) {
      const l = left.rankingTuple[index]; const r = right.rankingTuple[index];
      if (l === r) continue;
      if (typeof l === "number" && typeof r === "number") return l - r;
      return String(l).localeCompare(String(r));
    }
      return compareStable(left.planId, right.planId);
  });
  const rejected = evaluated.filter((item) => !item.accepted);
  const all = Object.freeze([...accepted, ...rejected]);
  return Object.freeze({
    evaluatedCandidates: all,
    acceptedCandidates: Object.freeze(accepted),
    rejectedCandidates: Object.freeze(rejected),
    bestCandidateId: accepted[0]?.planId ?? null,
    failClosed: accepted.length === 0,
    canonicalHash: hash({ evaluatedCandidates: all, bestCandidateId: accepted[0]?.planId ?? null, failClosed: accepted.length === 0 })
  });
}

export const evaluateRemediationPlanCandidates = evaluateRemediationPlans;
