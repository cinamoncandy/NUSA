import { createHash } from "node:crypto";
import type {
  RemediationProposal,
  RootCauseEvidenceBundle,
  RootCauseHypothesis
} from "./improvementTypes";

export interface RemediationProposalOptions {
  readonly maxProposals?: number;
}

const DEFAULT_MAX_PROPOSALS = 3;
const SUPPORTED_CANDIDATE_PREFIX = "MARKET_RECONNECT_INSTABILITY|MarketConnectionSupervisor|";

const validLimit = (value: number): boolean => Number.isSafeInteger(value) && value >= 1 && value <= DEFAULT_MAX_PROPOSALS;
const validBundle = (bundle: RootCauseEvidenceBundle | null | undefined): bundle is RootCauseEvidenceBundle =>
  bundle != null && typeof bundle === "object"
  && typeof bundle.candidateFingerprint === "string"
  && typeof bundle.generatedAt === "number"
  && Number.isSafeInteger(bundle.generatedAt)
  && Array.isArray(bundle.evidence)
  && Array.isArray(bundle.hypotheses);

function proposalId(candidateFingerprint: string, hypothesisId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ candidateFingerprint, hypothesisId }), "utf8")
    .digest("hex");
  return `remediation:${digest}`;
}

function blockedProposal(bundle: RootCauseEvidenceBundle | null | undefined, reasonCode: string): RemediationProposal {
  const candidateFingerprint = bundle?.candidateFingerprint || "unknown";
  const hypothesisId = bundle?.hypotheses?.[0]?.id || "none";
  return Object.freeze({
    id: proposalId(candidateFingerprint, `${hypothesisId}:${reasonCode}`),
    hypothesisId,
    candidateFingerprint,
    status: "BLOCKED" as const,
    title: "Remediation proposal blocked",
    rationale: "No executable remediation proposal is produced until the evidence contract is satisfied and a human reviews the scope.",
    supportingEvidenceIds: Object.freeze([]),
    unresolvedAssumptions: Object.freeze([reasonCode]),
    expectedImpact: "UNVERIFIED" as const,
    changeSurface: "UNKNOWN" as const,
    riskClass: "BLOCKED" as const,
    reversible: false,
    reversibilityPlan: "Not applicable; no change is authorized or performed.",
    verificationPlan: Object.freeze(["Resolve the blocking evidence condition", "Re-run deterministic evidence validation"]),
    requiresHumanReview: true as const,
    executable: false as const,
    reasonCodes: Object.freeze([reasonCode]),
    generatedAt: bundle?.generatedAt ?? 0
  });
}

function proposalForHypothesis(bundle: RootCauseEvidenceBundle, hypothesis: RootCauseHypothesis): RemediationProposal {
  const evidenceIds = [...new Set(hypothesis.evidenceIds)].sort();
  const evidenceSet = new Set(bundle.evidence.map((evidence) => evidence.id));
  const unresolved = [...new Set(hypothesis.unresolvedCodes)].sort();
  if (hypothesis.status !== "EVIDENCE_BOUND") return blockedProposal(bundle, "HYPOTHESIS_NOT_EVIDENCE_BOUND");
  if (evidenceIds.length === 0 || evidenceIds.some((evidenceId) => !evidenceSet.has(evidenceId))) return blockedProposal(bundle, "HYPOTHESIS_EVIDENCE_UNVERIFIED");
  if (!bundle.candidateFingerprint.startsWith(SUPPORTED_CANDIDATE_PREFIX)) return blockedProposal(bundle, "HYPOTHESIS_OUT_OF_SCOPE");
  return Object.freeze({
    id: proposalId(bundle.candidateFingerprint, hypothesis.id),
    hypothesisId: hypothesis.id,
    candidateFingerprint: bundle.candidateFingerprint,
    status: "PROPOSED" as const,
    title: "Review market reconnect observability",
    rationale: `Evidence-ranked hypothesis ${hypothesis.id} references exact evidence ${evidenceIds.join(", ")}; causal attribution remains unresolved.`,
    supportingEvidenceIds: Object.freeze(evidenceIds),
    unresolvedAssumptions: Object.freeze(["CAUSALITY_UNRESOLVED", ...unresolved].filter((value, index, values) => values.indexOf(value) === index).sort()),
    expectedImpact: "UNVERIFIED_OBSERVABILITY_IMPROVEMENT" as const,
    changeSurface: "OBSERVABILITY" as const,
    riskClass: "LOW" as const,
    reversible: true,
    reversibilityPlan: "Advisory record is removable; any separately approved observability change must have an operator-owned rollback.",
    verificationPlan: Object.freeze([
      "Replay the identical evidence bundle and compare proposal identity and ordering",
      "Run focused improvement and proposal tests",
      "Verify no order, broker, Risk, LIVE, or AI authority state changes"
    ]),
    requiresHumanReview: true as const,
    executable: false as const,
    reasonCodes: Object.freeze(["EVIDENCE_BOUND", "HUMAN_REVIEW_REQUIRED", "NON_EXECUTABLE"]),
    generatedAt: bundle.generatedAt
  });
}

/** Maps evidence-bound hypotheses to advisory records only; it never edits or executes anything. */
export function buildRemediationProposals(
  bundle: RootCauseEvidenceBundle | null | undefined,
  options: RemediationProposalOptions = {}
): readonly RemediationProposal[] {
  if (!validBundle(bundle)) return Object.freeze([blockedProposal(bundle, "BUNDLE_INVALID")]);
  if (bundle.status === "CONTRADICTORY") return Object.freeze([blockedProposal(bundle, "CONTRADICTORY_EVIDENCE")]);
  if (bundle.status === "INSUFFICIENT_EVIDENCE") return Object.freeze([blockedProposal(bundle, "INSUFFICIENT_EVIDENCE")]);
  const maxProposals = options.maxProposals ?? DEFAULT_MAX_PROPOSALS;
  if (!validLimit(maxProposals)) return Object.freeze([blockedProposal(bundle, "MAX_PROPOSALS_INVALID")]);
  if (bundle.hypotheses.length === 0) return Object.freeze([blockedProposal(bundle, "NO_HYPOTHESIS")]);
  const hypotheses = [...new Map(bundle.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const proposals = hypotheses.slice(0, maxProposals).map((hypothesis) => proposalForHypothesis(bundle, hypothesis));
  if (hypotheses.length > maxProposals) {
    const first = proposals[0];
    if (first !== undefined) proposals[0] = Object.freeze({ ...first, reasonCodes: Object.freeze([...first.reasonCodes, "PROPOSAL_FANOUT_BOUNDED"]) });
  }
  return Object.freeze(proposals);
}

export const prepareRemediationProposals = buildRemediationProposals;
