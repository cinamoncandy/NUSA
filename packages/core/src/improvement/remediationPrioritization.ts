import { createHash } from "node:crypto";
import type { RemediationProposal } from "./improvementTypes";
import type { RemediationVerificationResult } from "./remediationVerification";

export type RemediationPriorityStatus = "PRIORITIZED" | "INSUFFICIENT" | "REJECTED";
export type RemediationPriorityFactorCode =
  | "IMPACT"
  | "EVIDENCE_STRENGTH"
  | "RISK"
  | "REVERSIBILITY"
  | "IMPLEMENTATION_COST"
  | "REGRESSION_SURFACE"
  | "URGENCY";
export type RemediationPriorityReasonCode =
  | "PROPOSAL_MISSING"
  | "PROPOSAL_MALFORMED"
  | "PROPOSAL_BLOCKED"
  | "VERIFICATION_MISSING"
  | "VERIFICATION_NOT_PASS"
  | "VERIFICATION_MISMATCH"
  | "PROPOSAL_STALE"
  | "PROPOSAL_FUTURE"
  | "EVIDENCE_INSUFFICIENT"
  | "FACTOR_INSUFFICIENT"
  | "IRREVERSIBLE"
  | "PROTECTED_SURFACE"
  | "DUPLICATE_CONFLICT"
  | "BOUND_EXCEEDED"
  | "UNVERIFIABLE_CONTEXT";

export interface RemediationPriorityFactor {
  readonly code: RemediationPriorityFactorCode;
  readonly value: string | number | boolean | null;
  readonly points: number | null;
  readonly reason: string;
}

export interface RemediationPriorityItem {
  readonly id: string;
  readonly proposalId: string;
  readonly status: RemediationPriorityStatus;
  readonly rank: number | null;
  readonly priorityScore: number | null;
  readonly factors: readonly RemediationPriorityFactor[];
  readonly reasonCodes: readonly RemediationPriorityReasonCode[];
  readonly tieBreakReasons: readonly string[];
  readonly provenanceFingerprint: string;
  readonly evaluationFingerprint: string;
  readonly advisoryOnly: true;
  readonly executable: false;
  readonly requiresHumanReview: true;
}

export interface RemediationPrioritizationContext {
  readonly verifications: readonly RemediationVerificationResult[];
  /** The caller supplies the observation boundary; this module never reads a clock. */
  readonly asOfTimestamp?: number;
  readonly maxProposalAgeMs?: number;
  readonly maxQueueSize?: number;
}

export interface RemediationAdvisoryQueue {
  readonly mode: "ADVISORY";
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly items: readonly RemediationPriorityItem[];
  readonly queue: readonly RemediationPriorityItem[];
  readonly rejected: readonly RemediationPriorityItem[];
  readonly failClosed: boolean;
  readonly canonicalHash: string;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_QUEUE = 16;
const MAX_QUEUE = 64;
const NON_EMPTY = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const SAFE_TIME = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const PROTECTED_SURFACE = /(^|[^a-z])(live|real|broker|order|credential|secret|production|withdraw|transfer)([^a-z]|$)/i;
const TIE_BREAK_REASONS = Object.freeze(["PRIORITY_SCORE_DESC", "EVIDENCE_STRENGTH_DESC", "RISK_POINTS_DESC", "PROPOSAL_ID_ASC"]);

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
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
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validProposal(value: unknown): value is RemediationProposal {
  if (value == null || typeof value !== "object") return false;
  const proposal = value as Partial<RemediationProposal>;
  return NON_EMPTY(proposal.id)
    && NON_EMPTY(proposal.hypothesisId)
    && NON_EMPTY(proposal.candidateFingerprint)
    && (proposal.status === "PROPOSED" || proposal.status === "BLOCKED")
    && NON_EMPTY(proposal.title)
    && NON_EMPTY(proposal.rationale)
    && Array.isArray(proposal.supportingEvidenceIds)
    && proposal.supportingEvidenceIds.length > 0
    && proposal.supportingEvidenceIds.every(NON_EMPTY)
    && Array.isArray(proposal.unresolvedAssumptions)
    && proposal.unresolvedAssumptions.every(NON_EMPTY)
    && (proposal.expectedImpact === "UNVERIFIED_OBSERVABILITY_IMPROVEMENT" || proposal.expectedImpact === "UNVERIFIED")
    && (proposal.changeSurface === "OBSERVABILITY" || proposal.changeSurface === "RECOVERY_CONFIGURATION" || proposal.changeSurface === "PERSISTENCE" || proposal.changeSurface === "UNKNOWN")
    && (proposal.riskClass === "LOW" || proposal.riskClass === "MEDIUM" || proposal.riskClass === "HIGH" || proposal.riskClass === "BLOCKED")
    && typeof proposal.reversible === "boolean"
    && NON_EMPTY(proposal.reversibilityPlan)
    && Array.isArray(proposal.verificationPlan)
    && proposal.verificationPlan.length > 0
    && proposal.verificationPlan.every(NON_EMPTY)
    && Array.isArray(proposal.reasonCodes)
    && proposal.reasonCodes.every(NON_EMPTY)
    && proposal.requiresHumanReview === true
    && proposal.executable === false
    && SAFE_TIME(proposal.generatedAt);
}

function validVerification(value: unknown): value is RemediationVerificationResult {
  if (value == null || typeof value !== "object") return false;
  const verification = value as Partial<RemediationVerificationResult>;
  return NON_EMPTY(verification.id)
    && NON_EMPTY(verification.proposalId)
    && verification.status === "PASS"
    && Array.isArray(verification.checkedEvidenceIds)
    && verification.checkedEvidenceIds.every(NON_EMPTY)
    && verification.replayable === true
    && verification.dryRun === true
    && verification.executable === false
    && NON_EMPTY(verification.canonicalHash);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return uniqueSorted(left).join("\u0000") === uniqueSorted(right).join("\u0000");
}

function factor(code: RemediationPriorityFactorCode, value: string | number | boolean | null, points: number | null, reason: string): RemediationPriorityFactor {
  return Object.freeze({ code, value, points, reason });
}

function invalidItem(proposalId: string, reasonCodes: readonly RemediationPriorityReasonCode[]): RemediationPriorityItem {
  const orderedReasons = Object.freeze(uniqueSorted(reasonCodes) as RemediationPriorityReasonCode[]);
  const identity = { proposalId, status: "REJECTED", reasonCodes: orderedReasons };
  const provenanceFingerprint = hash(identity);
  return Object.freeze({
    id: `remediation-priority:${provenanceFingerprint}`,
    proposalId,
    status: "REJECTED",
    rank: null,
    priorityScore: null,
    factors: Object.freeze([]),
    reasonCodes: orderedReasons,
    tieBreakReasons: TIE_BREAK_REASONS,
    provenanceFingerprint,
    evaluationFingerprint: hash({ ...identity, provenanceFingerprint }),
    advisoryOnly: true,
    executable: false,
    requiresHumanReview: true
  });
}

function factorsFor(proposal: RemediationProposal, verification: RemediationVerificationResult, asOfTimestamp: number): readonly RemediationPriorityFactor[] {
  const ageMs = asOfTimestamp - proposal.generatedAt;
  const urgency = ageMs <= 60 * 60 * 1_000
    ? ["IMMEDIATE", 15, "recency bucket: <= 1 hour"] as const
    : ageMs <= 6 * 60 * 60 * 1_000
      ? ["SOON", 10, "recency bucket: <= 6 hours"] as const
      : ["NORMAL", 5, "recency bucket: within the bounded age window"] as const;
  const impact = proposal.expectedImpact === "UNVERIFIED_OBSERVABILITY_IMPROVEMENT"
    ? ["OBSERVABILITY_IMPROVEMENT_UNVERIFIED", 10, "bounded improvement class; no financial outcome is inferred"] as const
    : ["UNVERIFIED", 0, "impact is explicitly unverified; no impact premium is applied"] as const;
  const evidenceCount = verification.checkedEvidenceIds.length;
  const costPoints = proposal.changeSurface === "OBSERVABILITY" ? 10 : proposal.changeSurface === "RECOVERY_CONFIGURATION" ? 5 : proposal.changeSurface === "PERSISTENCE" ? 2 : null;
  const regressionPoints = proposal.changeSurface === "OBSERVABILITY" ? 10 : proposal.changeSurface === "RECOVERY_CONFIGURATION" ? 5 : proposal.changeSurface === "PERSISTENCE" ? 2 : null;
  return Object.freeze([
    factor("IMPACT", impact[0], impact[1], impact[2]),
    factor("EVIDENCE_STRENGTH", evidenceCount, Math.min(20, evidenceCount * 5), `verified evidence references: ${evidenceCount}`),
    factor("RISK", proposal.riskClass, proposal.riskClass === "LOW" ? 20 : proposal.riskClass === "MEDIUM" ? 10 : 0, "lower canonical risk class receives the safer ordering aid"),
    factor("REVERSIBILITY", proposal.reversible, proposal.reversible ? 15 : 0, proposal.reversible ? "proposal declares a reversible path" : "proposal is not reversible"),
    factor("IMPLEMENTATION_COST", proposal.changeSurface, costPoints, "bounded change-surface cost proxy; not an effort estimate"),
    factor("REGRESSION_SURFACE", proposal.changeSurface, regressionPoints, "bounded change-surface regression proxy; not a test guarantee"),
    factor("URGENCY", urgency[0], urgency[1], urgency[2])
  ]);
}

function evaluateProposal(proposal: unknown, verification: RemediationVerificationResult | undefined, context: { asOfTimestamp: number; maxProposalAgeMs: number }): RemediationPriorityItem {
  const proposalId = typeof (proposal as Partial<RemediationProposal> | null)?.id === "string" ? (proposal as RemediationProposal).id : "unknown";
  const proposedSurface = typeof (proposal as Partial<RemediationProposal> | null)?.changeSurface === "string" ? (proposal as RemediationProposal).changeSurface : "";
  if (PROTECTED_SURFACE.test(proposedSurface)) return invalidItem(proposalId, ["PROTECTED_SURFACE"]);
  if (!validProposal(proposal)) return invalidItem(proposalId, [proposal == null ? "PROPOSAL_MISSING" : "PROPOSAL_MALFORMED"]);
  const reasons: RemediationPriorityReasonCode[] = [];
  if (proposal.status === "BLOCKED") reasons.push("PROPOSAL_BLOCKED");
  if (verification === undefined) reasons.push("VERIFICATION_MISSING");
  else {
    if (!validVerification(verification)) reasons.push("VERIFICATION_NOT_PASS");
    if (verification.proposalId !== proposal.id || !sameStrings(verification.checkedEvidenceIds, proposal.supportingEvidenceIds)) reasons.push("VERIFICATION_MISMATCH");
  }
  const ageMs = context.asOfTimestamp - proposal.generatedAt;
  if (ageMs < 0) reasons.push("PROPOSAL_FUTURE");
  else if (ageMs > context.maxProposalAgeMs) reasons.push("PROPOSAL_STALE");
  if (proposal.riskClass === "BLOCKED" || proposal.executable !== false || proposal.requiresHumanReview !== true) reasons.push("PROPOSAL_BLOCKED");
  if (!proposal.reversible) reasons.push("IRREVERSIBLE");
  if (PROTECTED_SURFACE.test(proposal.changeSurface)) reasons.push("PROTECTED_SURFACE");
  if (!proposal.supportingEvidenceIds.length) reasons.push("EVIDENCE_INSUFFICIENT");
  const factors = verification !== undefined && validVerification(verification) ? factorsFor(proposal, verification, context.asOfTimestamp) : Object.freeze([]);
  if (factors.some((item) => item.points === null)) reasons.push("FACTOR_INSUFFICIENT");
  const orderedReasons = Object.freeze(uniqueSorted(reasons) as RemediationPriorityReasonCode[]);
  if (orderedReasons.length > 0) {
    const item = invalidItem(proposal.id, orderedReasons);
    return Object.freeze({ ...item, status: orderedReasons.includes("FACTOR_INSUFFICIENT") ? "INSUFFICIENT" : "REJECTED", factors, provenanceFingerprint: hash({ proposal, verification: verification?.canonicalHash ?? null }) });
  }
  const priorityScore = factors.reduce((sum, item) => sum + (item.points ?? 0), 0);
  const provenanceFingerprint = hash({ proposal, verification: verification!.canonicalHash, factors });
  const identity = { proposalId: proposal.id, priorityScore, factors, provenanceFingerprint };
  return Object.freeze({
    id: `remediation-priority:${hash(identity)}`,
    proposalId: proposal.id,
    status: "PRIORITIZED",
    rank: null,
    priorityScore,
    factors,
    reasonCodes: Object.freeze([]),
    tieBreakReasons: TIE_BREAK_REASONS,
    provenanceFingerprint,
    evaluationFingerprint: hash(identity),
    advisoryOnly: true,
    executable: false,
    requiresHumanReview: true
  });
}

function failClosed(reason: RemediationPriorityReasonCode): RemediationAdvisoryQueue {
  const item = invalidItem("unknown", [reason]);
  const items = Object.freeze([item]);
  return Object.freeze({ mode: "ADVISORY", readOnly: true, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY", items, queue: Object.freeze([]), rejected: items, failClosed: true, canonicalHash: hash({ items, failClosed: true }) });
}

/** Prioritizes verified proposals as a deterministic ordering aid; it never applies or persists remediation. */
function prioritizeVerifiedRemediationProposalsInternal(
  proposals: readonly RemediationProposal[],
  context: RemediationPrioritizationContext
): RemediationAdvisoryQueue {
  const maxQueueSize = context?.maxQueueSize ?? DEFAULT_MAX_QUEUE;
  const maxProposalAgeMs = context?.maxProposalAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!Array.isArray(proposals) || !Array.isArray(context?.verifications) || !SAFE_TIME(context?.asOfTimestamp)
    || !Number.isSafeInteger(maxProposalAgeMs) || maxProposalAgeMs < 1
    || !Number.isSafeInteger(maxQueueSize) || maxQueueSize < 1 || maxQueueSize > MAX_QUEUE) return failClosed("UNVERIFIABLE_CONTEXT");
  if (proposals.length > MAX_QUEUE || context.verifications.length > MAX_QUEUE * 2) return failClosed("BOUND_EXCEEDED");
  const proposalMap = new Map<string, RemediationProposal>();
  let duplicateConflict = false;
  for (const proposal of proposals) {
    const id = typeof (proposal as Partial<RemediationProposal> | null)?.id === "string" ? (proposal as RemediationProposal).id : "unknown";
    const prior = proposalMap.get(id);
    if (prior !== undefined && stableJson(prior) !== stableJson(proposal)) duplicateConflict = true;
    if (prior === undefined) proposalMap.set(id, proposal);
  }
  const verificationMap = new Map<string, RemediationVerificationResult>();
  for (const verification of context.verifications) {
    const prior = verificationMap.get(verification?.proposalId ?? "unknown");
    if (prior !== undefined && stableJson(prior) !== stableJson(verification)) duplicateConflict = true;
    if (prior === undefined && typeof verification?.proposalId === "string") verificationMap.set(verification.proposalId, verification);
  }
  if (duplicateConflict) return failClosed("DUPLICATE_CONFLICT");
  const evaluated = [...proposalMap.values()]
    .sort((left, right) => String(left?.id ?? "").localeCompare(String(right?.id ?? "")))
    .map((proposal) => evaluateProposal(proposal, verificationMap.get(proposal?.id), { asOfTimestamp: context.asOfTimestamp!, maxProposalAgeMs }));
  const ranked = evaluated.filter((item) => item.status === "PRIORITIZED").sort((left, right) => {
    const leftEvidence = left.factors.find((item) => item.code === "EVIDENCE_STRENGTH")?.points ?? -1;
    const rightEvidence = right.factors.find((item) => item.code === "EVIDENCE_STRENGTH")?.points ?? -1;
    const leftRisk = left.factors.find((item) => item.code === "RISK")?.points ?? -1;
    const rightRisk = right.factors.find((item) => item.code === "RISK")?.points ?? -1;
    return (right.priorityScore! - left.priorityScore!) || (rightEvidence - leftEvidence) || (rightRisk - leftRisk) || left.proposalId.localeCompare(right.proposalId);
  });
  const queue = Object.freeze(ranked.slice(0, maxQueueSize).map((item, index) => Object.freeze({ ...item, rank: index + 1 })));
  const queuedIds = new Set(queue.map((item) => item.proposalId));
  const items = Object.freeze(evaluated.map((item) => queuedIds.has(item.proposalId) ? queue.find((queued) => queued.proposalId === item.proposalId)! : item));
  return Object.freeze({ mode: "ADVISORY", readOnly: true, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY", items, queue, rejected: Object.freeze(items.filter((item) => item.status !== "PRIORITIZED")), failClosed: queue.length === 0, canonicalHash: hash({ items, queue, failClosed: queue.length === 0 }) });
}

export function prioritizeVerifiedRemediationProposals(
  proposals: readonly RemediationProposal[],
  context: RemediationPrioritizationContext
): RemediationAdvisoryQueue {
  try {
    return prioritizeVerifiedRemediationProposalsInternal(proposals, context);
  } catch {
    return failClosed("UNVERIFIABLE_CONTEXT");
  }
}

export const prioritizeRemediationProposals = prioritizeVerifiedRemediationProposals;
export const buildRemediationAdvisoryQueue = prioritizeVerifiedRemediationProposals;
