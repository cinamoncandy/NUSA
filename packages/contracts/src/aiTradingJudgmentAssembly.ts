/**
 * Assembles an AiTradingJudgment from the existing multi-agent DecisionResult (decision.ts)
 * rather than from a new, separate decision path.
 *
 * The DecisionResult already votes over evidence per agent (DecisionBallot: memberId, action,
 * support, evidenceRefs, stale/failed flags). This module maps that real vote into
 * AiTradingJudgment's evidence/counterEvidence/confidence/uncertainty fields honestly:
 *
 * - evidence: ballots that agree with the decision's final action.
 * - counterEvidence: ballots that voted a different, non-ABSTAIN action.
 * - confidence: the decision's own agreementRatio -- not a separately invented number.
 * - uncertainty: the larger of (1 - agreementRatio) and the stale/failed ballot share, so neither
 *   pure disagreement nor pure evidence degradation can be hidden by the other.
 *
 * What this module deliberately does NOT do: synthesize scenarios, expectedReturn, downside,
 * riskBudget, invalidationCondition, or thesis text. A DecisionResult carries none of those
 * (ballots are numeric votes, not market-outcome scenarios), so a caller must supply them --
 * fabricating them here would be exactly the "AI output = Evidence" violation the charter
 * prohibits (AI output = Proposal, never Evidence; a proposal's scenario/return/risk framing must
 * come from an actual analysis step, not be invented by this assembler).
 */
import { DecisionAction, type DecisionResult } from "./decision";
import type { MarketRegime } from "./marketRegime";
import {
  validateAiTradingJudgment,
  type AiEpistemicStatus,
  type AiTradingEvidenceItem,
  type AiTradingJudgment,
  type AiTradingScenario,
} from "./aiTradingJudgment";

export class AiTradingJudgmentAssemblyInvalidError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`Assembled AI trading judgment is invalid: ${errors.join(",")}`);
    this.name = "AiTradingJudgmentAssemblyInvalidError";
    this.errors = Object.freeze([...errors]);
  }
}

export interface AssembleAiTradingJudgmentInput {
  readonly judgmentId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly generatedAt: string;
  readonly thesis: string;
  readonly decision: DecisionResult;
  /** Human-readable narrative per ballot, keyed by memberId. A ballot with no entry here is
   * dropped from evidence/counterEvidence (there is no text to show for it). */
  readonly ballotNarratives: Readonly<Record<string, string>>;
  /** Epistemic status per ballot, keyed by memberId; defaults to "ESTIMATE" for any ballot without
   * an explicit entry, since a model vote is an estimate, never directly a KNOWN fact. */
  readonly ballotEpistemicStatus?: Readonly<Record<string, AiEpistemicStatus>>;
  readonly marketRegime: MarketRegime;
  readonly scenarios: readonly AiTradingScenario[];
  readonly expectedReturn: number;
  readonly downside: number;
  readonly riskBudget: number;
  readonly timeHorizonMs: number;
  readonly invalidationCondition: string;
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

/**
 * Builds the evidence/counterEvidence/confidence/uncertainty fields of an AiTradingJudgment from a
 * real DecisionResult. Does not itself produce a full AiTradingJudgment (the caller still supplies
 * scenarios/expectedReturn/downside/riskBudget/invalidationCondition/thesis) -- see module doc for
 * why those are never fabricated here.
 */
export function assembleAiTradingJudgment(input: AssembleAiTradingJudgmentInput): AiTradingJudgment {
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

  const judgment: AiTradingJudgment = {
    schemaVersion: 1,
    judgmentId: input.judgmentId,
    strategyId: input.strategyId,
    market: input.market,
    generatedAt: input.generatedAt,
    thesis: input.thesis,
    evidence,
    counterEvidence,
    confidence: decision.agreementRatio,
    uncertainty,
    marketRegime: input.marketRegime,
    scenarios: input.scenarios,
    expectedReturn: input.expectedReturn,
    downside: input.downside,
    riskBudget: input.riskBudget,
    timeHorizonMs: input.timeHorizonMs,
    invalidationCondition: input.invalidationCondition,
    action: decision.action,
  };

  const validation = validateAiTradingJudgment(judgment);
  if (!validation.valid) throw new AiTradingJudgmentAssemblyInvalidError(validation.errors);
  return judgment;
}
