import type { ResearchFactoryDecision } from "./researchFactoryOutcome";

export interface ResearchFactoryDecisionHistoryRecord {
  readonly candidateId: string;
  readonly evaluationId: string;
  readonly outcome: ResearchFactoryDecision["outcome"];
  readonly reasons: readonly string[];
  readonly observedAt: number;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ResearchFactoryDecisionHistoryState {
  readonly records: readonly ResearchFactoryDecisionHistoryRecord[];
  readonly totalDecisions: number;
  readonly rejected: number;
  readonly insufficient: number;
  readonly qualifiedForLeague: number;
}

export interface AppendResearchFactoryDecisionHistoryInput {
  readonly history: ResearchFactoryDecisionHistoryState;
  readonly decision: ResearchFactoryDecision;
  readonly observedAt: number;
}

export interface AppendResearchFactoryDecisionHistoryResult {
  readonly history: ResearchFactoryDecisionHistoryState;
  readonly appended: boolean;
}

function freezeRecord(record: ResearchFactoryDecisionHistoryRecord): ResearchFactoryDecisionHistoryRecord {
  return Object.freeze({ ...record, reasons: Object.freeze([...record.reasons]) });
}

function sameRecord(left: ResearchFactoryDecisionHistoryRecord, right: ResearchFactoryDecisionHistoryRecord): boolean {
  return left.candidateId === right.candidateId &&
    left.evaluationId === right.evaluationId &&
    left.outcome === right.outcome &&
    left.observedAt === right.observedAt &&
    left.authority === right.authority &&
    left.liveAuthority === right.liveAuthority &&
    left.productionMutationAllowed === right.productionMutationAllowed &&
    left.aiAuthority === right.aiAuthority &&
    left.reasons.length === right.reasons.length &&
    left.reasons.every((reason, index) => reason === right.reasons[index]);
}

function assertCanonicalDecision(decision: ResearchFactoryDecision): void {
  if (!decision || typeof decision !== "object") throw new Error("RESEARCH_FACTORY_HISTORY_DECISION_INVALID");
  if (decision.authority !== "PAPER_ONLY" ||
      decision.liveAuthority !== "NONE" ||
      decision.productionMutationAllowed !== false ||
      decision.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("RESEARCH_FACTORY_HISTORY_AUTHORITY_INVALID");
  }
}

export function emptyResearchFactoryDecisionHistory(): ResearchFactoryDecisionHistoryState {
  return Object.freeze({
    records: Object.freeze([]),
    totalDecisions: 0,
    rejected: 0,
    insufficient: 0,
    qualifiedForLeague: 0,
  });
}

/**
 * Append-only denominator/history for canonical Research Factory decisions.
 *
 * Every terminal research outcome is retained, including REJECTED and INSUFFICIENT. Replaying the
 * exact same evaluation is idempotent; reusing an evaluationId with different content fails closed.
 * No mutation, deletion, promotion, broker or LIVE authority is provided by this contract.
 */
export function appendResearchFactoryDecisionHistory(
  input: AppendResearchFactoryDecisionHistoryInput,
): AppendResearchFactoryDecisionHistoryResult {
  if (!input || typeof input !== "object") throw new Error("RESEARCH_FACTORY_HISTORY_INPUT_INVALID");
  if (!input.history || !Array.isArray(input.history.records)) throw new Error("RESEARCH_FACTORY_HISTORY_STATE_INVALID");
  assertCanonicalDecision(input.decision);
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) throw new Error("RESEARCH_FACTORY_HISTORY_TIME_INVALID");

  const nextRecord = freezeRecord({
    candidateId: input.decision.candidateId,
    evaluationId: input.decision.evaluationId,
    outcome: input.decision.outcome,
    reasons: input.decision.reasons,
    observedAt: input.observedAt,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });

  const existing = input.history.records.find((record) => record.evaluationId === nextRecord.evaluationId);
  if (existing) {
    if (!sameRecord(existing, nextRecord)) throw new Error("RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH");
    return Object.freeze({ history: input.history, appended: false });
  }

  const records = Object.freeze([...input.history.records.map(freezeRecord), nextRecord]);
  const history = Object.freeze({
    records,
    totalDecisions: records.length,
    rejected: records.filter((record) => record.outcome === "REJECTED").length,
    insufficient: records.filter((record) => record.outcome === "INSUFFICIENT").length,
    qualifiedForLeague: records.filter((record) => record.outcome === "QUALIFIED_FOR_LEAGUE").length,
  });
  return Object.freeze({ history, appended: true });
}
