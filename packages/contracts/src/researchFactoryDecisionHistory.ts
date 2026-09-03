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

const OUTCOMES = new Set<ResearchFactoryDecision["outcome"]>([
  "REJECTED",
  "INSUFFICIENT",
  "QUALIFIED_FOR_LEAGUE",
]);

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

function assertSafetyMetadata(value: {
  readonly authority: unknown;
  readonly liveAuthority: unknown;
  readonly productionMutationAllowed: unknown;
  readonly aiAuthority: unknown;
}): void {
  if (value.authority !== "PAPER_ONLY" ||
      value.liveAuthority !== "NONE" ||
      value.productionMutationAllowed !== false ||
      value.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("RESEARCH_FACTORY_HISTORY_AUTHORITY_INVALID");
  }
}

function assertCanonicalDecision(decision: ResearchFactoryDecision): void {
  if (!decision || typeof decision !== "object") throw new Error("RESEARCH_FACTORY_HISTORY_DECISION_INVALID");
  assertSafetyMetadata(decision);
}

function assertHistoryState(history: ResearchFactoryDecisionHistoryState): void {
  if (!history || !Array.isArray(history.records)) throw new Error("RESEARCH_FACTORY_HISTORY_STATE_INVALID");
  const evaluationIds = new Set<string>();
  for (const record of history.records) {
    if (!record || typeof record !== "object" ||
        typeof record.candidateId !== "string" || record.candidateId.length === 0 ||
        typeof record.evaluationId !== "string" || record.evaluationId.length === 0 ||
        !OUTCOMES.has(record.outcome) ||
        !Array.isArray(record.reasons) || !record.reasons.every((reason: unknown) => typeof reason === "string") ||
        !Number.isSafeInteger(record.observedAt) || record.observedAt < 0) {
      throw new Error("RESEARCH_FACTORY_HISTORY_STATE_INVALID");
    }
    assertSafetyMetadata(record);
    if (evaluationIds.has(record.evaluationId)) throw new Error("RESEARCH_FACTORY_HISTORY_DUPLICATE_EVALUATION");
    evaluationIds.add(record.evaluationId);
  }

  const rejected = history.records.filter((record) => record.outcome === "REJECTED").length;
  const insufficient = history.records.filter((record) => record.outcome === "INSUFFICIENT").length;
  const qualifiedForLeague = history.records.filter((record) => record.outcome === "QUALIFIED_FOR_LEAGUE").length;
  if (history.totalDecisions !== history.records.length ||
      history.rejected !== rejected ||
      history.insufficient !== insufficient ||
      history.qualifiedForLeague !== qualifiedForLeague) {
    throw new Error("RESEARCH_FACTORY_HISTORY_COUNT_MISMATCH");
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
  assertHistoryState(input.history);
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