/**
 * Derives AiTradingJudgment's evidence/counterEvidence/confidence/uncertainty fields from a real
 * multi-agent DecisionResult (decision.ts), for composing with buildAiTradingJudgment
 * (aiTradingJudgmentBridge.ts) -- the canonical, evidence-bundle-verified judgment constructor.
 *
 * This module intentionally does NOT construct or validate a full AiTradingJudgment itself.
 * aiTradingJudgmentBridge.ts already owns that responsibility, and it enforces a safety property
 * this module cannot: every evidence reference must exist in a verified EvidenceBundle. A second,
 * independent full-construction path that skipped that check would be worse than no path at all,
 * so it does not exist here -- this module only derives ballot-based *inputs* to the one canonical
 * builder.
 *
 * DecisionResult already carries a per-agent vote (DecisionBallot: memberId, action, support,
 * evidenceRefs, stale/failed flags), mapped here honestly:
 *
 * - evidence: ballots that agree with the decision's final action.
 * - counterEvidence: ballots that voted a different, non-ABSTAIN action.
 * - confidence: the decision's own agreementRatio -- not a separately invented number.
 * - uncertainty: the larger of (1 - agreementRatio) and the stale/failed ballot share, so neither
 *   pure disagreement nor pure evidence degradation can be hidden by the other.
 */
import { DecisionAction, type DecisionResult } from "../../../../packages/contracts/src/decision";
import type { AiEpistemicStatus, AiTradingEvidenceItem } from "../../../../packages/contracts/src/aiTradingJudgment";

export interface DeriveAiTradingJudgmentFieldsInput {
  readonly decision: DecisionResult;
  /** Human-readable narrative per ballot, keyed by memberId. A ballot with no entry here is
   * dropped from evidence/counterEvidence (there is no text to show for it). */
  readonly ballotNarratives: Readonly<Record<string, string>>;
  /** Epistemic status per ballot, keyed by memberId; defaults to "ESTIMATE" for any ballot without
   * an explicit entry, since a model vote is an estimate, never directly a KNOWN fact. */
  readonly ballotEpistemicStatus?: Readonly<Record<string, AiEpistemicStatus>>;
}

export interface DerivedAiTradingJudgmentFields {
  readonly evidence: readonly AiTradingEvidenceItem[];
  readonly counterEvidence: readonly AiTradingEvidenceItem[];
  readonly confidence: number;
  readonly uncertainty: number;
}

function toEvidenceItem(
  ballot: DecisionResult["ballots"][number],
  narratives: Readonly<Record<string, string>>,
  statuses: Readonly<Record<string, AiEpistemicStatus>> | undefined,
): AiTradingEvidenceItem | null {
  const statement = narratives[ballot.memberId];
  if (!statement) return null;
  const status: AiEpistemicStatus = ballot.stale || ballot.failed ? "RISK" : (statuses?.[ballot.memberId] ?? "ESTIMATE");
  return {
    id: ballot.memberId,
    statement,
    status,
    evidenceRefs: ballot.evidenceRefs,
  };
}

/** Pure derivation -- no validation, no EvidenceBundle binding. Feed the result into
 * buildAiTradingJudgment, which validates the full judgment and binds every evidenceRef to a
 * verified EvidenceBundle before anything is returned. */
export function deriveAiTradingJudgmentFieldsFromDecision(input: DeriveAiTradingJudgmentFieldsInput): DerivedAiTradingJudgmentFields {
  const { decision } = input;
  const evidence: AiTradingEvidenceItem[] = [];
  const counterEvidence: AiTradingEvidenceItem[] = [];
  let staleOrFailedCount = 0;

  for (const ballot of decision.ballots) {
    if (ballot.stale || ballot.failed) staleOrFailedCount += 1;
    const item = toEvidenceItem(ballot, input.ballotNarratives, input.ballotEpistemicStatus);
    if (!item) continue;
    if (ballot.action === decision.action) evidence.push(item);
    else if (ballot.action !== DecisionAction.ABSTAIN) counterEvidence.push(item);
  }

  const degradedShare = decision.respondingMembers > 0 ? staleOrFailedCount / decision.respondingMembers : 0;
  const disagreementShare = 1 - decision.agreementRatio;
  const uncertainty = Math.min(1, Math.max(disagreementShare, degradedShare));

  return {
    evidence: Object.freeze(evidence),
    counterEvidence: Object.freeze(counterEvidence),
    confidence: decision.agreementRatio,
    uncertainty,
  };
}
