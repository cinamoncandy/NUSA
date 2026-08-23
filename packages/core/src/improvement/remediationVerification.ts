import { createHash } from "node:crypto";
import type {
  ImprovementDiagnosticEvidence,
  RemediationProposal,
  RemediationProposalChangeSurface
} from "./improvementTypes";

export type RemediationVerificationStatus =
  | "PASS"
  | "BLOCKED"
  | "INSUFFICIENT"
  | "CONTRADICTED"
  | "INVALID";

export type RemediationVerificationReasonCode =
  | "PROPOSAL_MISSING"
  | "PROPOSAL_MALFORMED"
  | "PROPOSAL_BLOCKED"
  | "PROPOSAL_STALE"
  | "PROPOSAL_FUTURE"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_MALFORMED"
  | "EVIDENCE_DUPLICATE_CONFLICT"
  | "EVIDENCE_STALE"
  | "EVIDENCE_FUTURE"
  | "EVIDENCE_FINGERPRINT_MISMATCH"
  | "EVIDENCE_ID_NOT_REFERENCED"
  | "RATIONALE_EVIDENCE_MISMATCH"
  | "CHANGE_SURFACE_OUT_OF_SCOPE"
  | "RISK_CLASS_OUT_OF_SCOPE"
  | "REVERSIBILITY_INCOMPLETE"
  | "VERIFICATION_PLAN_INCOMPLETE"
  | "UNVERIFIABLE_CONTEXT";

export interface RemediationVerificationContext {
  /** The caller supplies the observation boundary; the verifier never reads a clock. */
  readonly asOfTimestamp: number;
  readonly evidence: readonly ImprovementDiagnosticEvidence[];
  readonly maxEvidenceAgeMs?: number;
  readonly maxEvidence?: number;
  readonly allowedChangeSurfaces?: readonly RemediationProposalChangeSurface[];
}

export interface RemediationVerificationResult {
  readonly id: string;
  readonly proposalId: string;
  readonly status: RemediationVerificationStatus;
  readonly reasonCodes: readonly RemediationVerificationReasonCode[];
  readonly checkedEvidenceIds: readonly string[];
  readonly replayable: true;
  readonly dryRun: true;
  readonly executable: false;
  readonly canonicalHash: string;
}

const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_EVIDENCE = 32;
const DEFAULT_ALLOWED_SURFACES: readonly RemediationProposalChangeSurface[] = ["OBSERVABILITY"];
const NON_EMPTY = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const SAFE_TIME = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

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

function validEvidence(value: unknown): value is ImprovementDiagnosticEvidence {
  if (value === null || typeof value !== "object") return false;
  const evidence = value as Partial<ImprovementDiagnosticEvidence>;
  return NON_EMPTY(evidence.id)
    && NON_EMPTY(evidence.fingerprint)
    && evidence.type === "MARKET_RECONNECT_INSTABILITY"
    && evidence.source === "MarketConnectionSupervisor"
    && SAFE_TIME(evidence.observedAt)
    && (evidence.state === "RECONNECTING" || evidence.state === "FAILED")
    && SAFE_TIME(evidence.reconnectAttempt)
    && SAFE_TIME(evidence.reconnectAttemptLimit)
    && SAFE_TIME(evidence.downtimeMs)
    && (evidence.failureReason === null || evidence.failureReason === "MAX_ATTEMPTS_EXCEEDED" || evidence.failureReason === "MAX_RECONNECT_TIME_EXCEEDED");
}

function validProposal(value: unknown): value is RemediationProposal {
  if (value === null || typeof value !== "object") return false;
  const proposal = value as Partial<RemediationProposal>;
  return NON_EMPTY(proposal.id)
    && NON_EMPTY(proposal.hypothesisId)
    && NON_EMPTY(proposal.candidateFingerprint)
    && (proposal.status === "PROPOSED" || proposal.status === "BLOCKED")
    && NON_EMPTY(proposal.title)
    && NON_EMPTY(proposal.rationale)
    && Array.isArray(proposal.supportingEvidenceIds)
    && proposal.supportingEvidenceIds.every(NON_EMPTY)
    && Array.isArray(proposal.unresolvedAssumptions)
    && proposal.unresolvedAssumptions.every(NON_EMPTY)
    && (proposal.expectedImpact === "UNVERIFIED_OBSERVABILITY_IMPROVEMENT" || proposal.expectedImpact === "UNVERIFIED")
    && (proposal.changeSurface === "OBSERVABILITY" || proposal.changeSurface === "RECOVERY_CONFIGURATION" || proposal.changeSurface === "PERSISTENCE" || proposal.changeSurface === "UNKNOWN")
    && (proposal.riskClass === "LOW" || proposal.riskClass === "MEDIUM" || proposal.riskClass === "HIGH" || proposal.riskClass === "BLOCKED")
    && typeof proposal.reversible === "boolean"
    && NON_EMPTY(proposal.reversibilityPlan)
    && Array.isArray(proposal.verificationPlan)
    && proposal.verificationPlan.every(NON_EMPTY)
    && proposal.requiresHumanReview === true
    && proposal.executable === false
    && Array.isArray(proposal.reasonCodes)
    && proposal.reasonCodes.every(NON_EMPTY)
    && SAFE_TIME(proposal.generatedAt);
}

function result(proposalId: string, status: RemediationVerificationStatus, reasonCodes: readonly RemediationVerificationReasonCode[], checkedEvidenceIds: readonly string[], evidenceFacts: readonly unknown[] = []): RemediationVerificationResult {
  const orderedReasons = Object.freeze([...new Set(reasonCodes)].sort());
  const orderedEvidence = Object.freeze([...new Set(checkedEvidenceIds)].sort());
  const identity = { proposalId, status, reasonCodes: orderedReasons, checkedEvidenceIds: orderedEvidence, evidenceFacts, replayable: true, dryRun: true, executable: false };
  return Object.freeze({
    id: `remediation-verification:${hash(identity)}`,
    proposalId,
    status,
    reasonCodes: orderedReasons,
    checkedEvidenceIds: orderedEvidence,
    replayable: true,
    dryRun: true,
    executable: false,
    canonicalHash: hash(identity)
  });
}

/**
 * Deterministically validates an advisory proposal. It reads only supplied facts and
 * never applies a proposal, persists state, calls a broker, or mutates its inputs.
 */
export function verifyRemediationProposal(
  proposalInput: RemediationProposal | null | undefined,
  context: RemediationVerificationContext
): RemediationVerificationResult {
  if (!SAFE_TIME(context?.asOfTimestamp)) return result("unknown", "INVALID", ["UNVERIFIABLE_CONTEXT"], []);
  if (!Array.isArray(context.evidence)) return result("unknown", "INVALID", ["UNVERIFIABLE_CONTEXT"], []);
  const proposalId = typeof proposalInput?.id === "string" ? proposalInput.id : "unknown";
  if (!validProposal(proposalInput)) return result(proposalId, "INVALID", [proposalInput == null ? "PROPOSAL_MISSING" : "PROPOSAL_MALFORMED"], []);
  if (proposalInput.status === "BLOCKED" || proposalInput.executable !== false) return result(proposalInput.id, "BLOCKED", ["PROPOSAL_BLOCKED"], []);

  const maxAge = context.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
  const maxEvidence = context.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  if (!SAFE_TIME(maxAge) || maxAge < 1 || !Number.isSafeInteger(maxEvidence) || maxEvidence < 1 || maxEvidence > DEFAULT_MAX_EVIDENCE) {
    return result(proposalInput.id, "INVALID", ["UNVERIFIABLE_CONTEXT"], []);
  }
  if (proposalInput.generatedAt > context.asOfTimestamp) return result(proposalInput.id, "CONTRADICTED", ["PROPOSAL_FUTURE"], []);
  if (context.evidence.length > maxEvidence) return result(proposalInput.id, "INSUFFICIENT", ["EVIDENCE_MISSING"], []);

  const reasons: RemediationVerificationReasonCode[] = [];
  if (context.asOfTimestamp - proposalInput.generatedAt > maxAge) reasons.push("PROPOSAL_STALE");
  const byId = new Map<string, ImprovementDiagnosticEvidence>();
  for (const candidate of context.evidence) {
    if (!validEvidence(candidate)) { reasons.push("EVIDENCE_MALFORMED"); continue; }
    const previous = byId.get(candidate.id);
    if (previous !== undefined) {
      if (stableJson(previous) !== stableJson(candidate)) reasons.push("EVIDENCE_DUPLICATE_CONFLICT");
      continue;
    }
    byId.set(candidate.id, candidate);
  }
  const checked = proposalInput.supportingEvidenceIds;
  if (checked.length === 0) reasons.push("EVIDENCE_MISSING");
  for (const id of checked) {
    const evidence = byId.get(id);
    if (evidence === undefined) { reasons.push("EVIDENCE_MISSING"); continue; }
    if (evidence.fingerprint !== proposalInput.candidateFingerprint) reasons.push("EVIDENCE_FINGERPRINT_MISMATCH");
    if (evidence.observedAt > context.asOfTimestamp || evidence.observedAt > proposalInput.generatedAt) reasons.push("EVIDENCE_FUTURE");
    if (context.asOfTimestamp - evidence.observedAt > maxAge) reasons.push("EVIDENCE_STALE");
    if (!proposalInput.rationale.includes(id)) reasons.push("RATIONALE_EVIDENCE_MISMATCH");
  }
  for (const id of byId.keys()) if (!checked.includes(id)) reasons.push("EVIDENCE_ID_NOT_REFERENCED");
  if (proposalInput.changeSurface !== (context.allowedChangeSurfaces ?? DEFAULT_ALLOWED_SURFACES).find((surface) => surface === proposalInput.changeSurface)) reasons.push("CHANGE_SURFACE_OUT_OF_SCOPE");
  if (proposalInput.riskClass !== "LOW") reasons.push("RISK_CLASS_OUT_OF_SCOPE");
  const rollbackText = proposalInput.reversibilityPlan.toLowerCase();
  if (!proposalInput.reversible || !(rollbackText.includes("rollback") || rollbackText.includes("revert") || rollbackText.includes("remov"))) reasons.push("REVERSIBILITY_INCOMPLETE");
  const plan = proposalInput.verificationPlan.join(" ").toLowerCase();
  if (proposalInput.verificationPlan.length < 2 || !(plan.includes("replay") || plan.includes("determin")) || !(plan.includes("test") || plan.includes("verif")) || !(plan.includes("authority") || plan.includes("mutation"))) reasons.push("VERIFICATION_PLAN_INCOMPLETE");

  const evidenceFacts = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (reasons.includes("EVIDENCE_MALFORMED")) return result(proposalInput.id, "INVALID", reasons, checked, evidenceFacts);
  if (reasons.includes("EVIDENCE_DUPLICATE_CONFLICT") || reasons.includes("EVIDENCE_FINGERPRINT_MISMATCH") || reasons.includes("EVIDENCE_FUTURE")) return result(proposalInput.id, "CONTRADICTED", reasons, checked, evidenceFacts);
  if (reasons.includes("PROPOSAL_STALE") || reasons.includes("EVIDENCE_MISSING") || reasons.includes("EVIDENCE_STALE") || reasons.includes("EVIDENCE_ID_NOT_REFERENCED")) return result(proposalInput.id, "INSUFFICIENT", reasons, checked, evidenceFacts);
  if (reasons.length > 0) return result(proposalInput.id, "BLOCKED", reasons, checked, evidenceFacts);
  return result(proposalInput.id, "PASS", [], checked, evidenceFacts);
}

export const replayRemediationProposal = verifyRemediationProposal;
