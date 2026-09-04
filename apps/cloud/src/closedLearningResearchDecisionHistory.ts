import type { ResearchFactoryDecisionHistoryRecord, ResearchFactoryDecisionHistoryState } from "../../../packages/contracts/src/researchFactoryDecisionHistory";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteResearchFactoryDecisionHistoryRepository } from "../../../packages/storage/src/researchFactoryDecisionHistoryRepository";
import type { ClosedLearningResearchReplayResult } from "./closedLearningResearchWorkerClient";

export interface ClosedLearningResearchDecisionHistoryPersistResult {
  readonly appended: number;
  readonly state: ResearchFactoryDecisionHistoryState;
}

const SHA256 = /^[a-f0-9]{64}$/;

function sameReasons(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((reason, index) => reason === right[index]);
}

function assertReplayResult(result: ClosedLearningResearchReplayResult): void {
  if (
    result.schemaVersion !== 1
    || result.operation !== "REPLAY_PAPER_EVIDENCE"
    || !SHA256.test(result.originalRunFingerprintSha256)
    || !SHA256.test(result.replayRunFingerprintSha256)
    || result.liveAuthority !== "NONE"
    || result.productionMutationAllowed !== false
    || result.aiAuthority !== "ZERO_AUTHORITY"
    || result.qualification.schemaVersion !== 1
    || result.qualification.liveAuthority !== "NONE"
    || result.qualification.productionMutationAllowed !== false
    || result.qualification.aiAuthority !== "ZERO_AUTHORITY"
  ) {
    throw new Error("CLOSED_LEARNING_RESEARCH_HISTORY_RESULT_INVALID");
  }
  const candidates = result.qualification.candidates;
  const ids = new Set(candidates.map((candidate) => candidate.candidateId));
  if (ids.size !== candidates.length || result.qualification.coverage.candidateCount !== candidates.length) {
    throw new Error("CLOSED_LEARNING_RESEARCH_HISTORY_COVERAGE_INVALID");
  }
  const counts = candidates.reduce(
    (value, candidate) => {
      value[candidate.outcome] += 1;
      return value;
    },
    { REJECTED: 0, INSUFFICIENT: 0, QUALIFIED_FOR_LEAGUE: 0 },
  );
  if (
    counts.REJECTED !== result.qualification.coverage.rejectedCount
    || counts.INSUFFICIENT !== result.qualification.coverage.insufficientCount
    || counts.QUALIFIED_FOR_LEAGUE !== result.qualification.coverage.qualifiedCount
  ) {
    throw new Error("CLOSED_LEARNING_RESEARCH_HISTORY_COVERAGE_INVALID");
  }
}

/**
 * Durable production sink for the complete Research Factory denominator returned by the
 * process-isolated canonical Research/League replay worker. The first observation time is kept
 * across identical replay; a changed payload under the same replay identity fails closed.
 */
export class ClosedLearningResearchDecisionHistory {
  private readonly repository: SqliteResearchFactoryDecisionHistoryRepository;

  public constructor(database: SqliteDatabase) {
    this.repository = new SqliteResearchFactoryDecisionHistoryRepository(database);
  }

  public persist(result: ClosedLearningResearchReplayResult, observedAt: number): ClosedLearningResearchDecisionHistoryPersistResult {
    assertReplayResult(result);
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("CLOSED_LEARNING_RESEARCH_HISTORY_TIME_INVALID");

    const existingById = new Map(this.repository.list().map((record) => [record.evaluationId, record] as const));
    let appended = 0;
    for (const candidate of result.qualification.candidates) {
      const evaluationId = `closed-learning-replay:${result.replayRunFingerprintSha256}:${candidate.candidateId}`;
      const existing = existingById.get(evaluationId);
      if (existing != null) {
        if (
          existing.candidateId !== candidate.candidateId
          || existing.outcome !== candidate.outcome
          || !sameReasons(existing.reasons, candidate.reasons)
          || existing.authority !== "PAPER_ONLY"
          || existing.liveAuthority !== "NONE"
          || existing.productionMutationAllowed !== false
          || existing.aiAuthority !== "ZERO_AUTHORITY"
        ) {
          throw new Error("RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH");
        }
        continue;
      }
      const record: ResearchFactoryDecisionHistoryRecord = Object.freeze({
        candidateId: candidate.candidateId,
        evaluationId,
        outcome: candidate.outcome,
        reasons: Object.freeze([...candidate.reasons]),
        observedAt,
        authority: "PAPER_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
      const write = this.repository.append(record);
      if (write.appended) appended += 1;
    }
    return Object.freeze({ appended, state: this.repository.state() });
  }

  public state(): ResearchFactoryDecisionHistoryState {
    return this.repository.state();
  }
}
