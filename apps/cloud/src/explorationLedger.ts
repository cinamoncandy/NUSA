import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { ResearchCandidateSpecification } from "../../../packages/contracts/src/researchCandidateSpecification";
import { validateResearchCandidateSpecification } from "../../../packages/contracts/src/researchCandidateSpecification";
import type { EvolutionLearningRecord } from "../../autopilot/src/evolveLearningMemory";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { LearningInputSetLedger } from "./learningInputSetLedger";
import { StrategyFamilyRegistry } from "./strategyFamilyRegistry";
import {
  assertExplorationAttempt,
  assertExplorationHistory,
  assessExploration,
  EXPLORATION_POLICY_VERSION,
  ExplorationError,
  sameExplorationAttempt,
  type ExplorationAttempt,
} from "./exploration";

const RECORD_KIND = "LEARNING_EXPLORATION";
const PROBLEM = "NUSA learning exploration assessment receipt; not a candidate, qualification, or application";
const ID_PREFIX = "learning-exploration-v2:";
type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "appendWithValidation" | "list">;
type InputSetPort = Pick<LearningInputSetLedger, "getByFingerprint">;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function opportunityId(attempt: ExplorationAttempt): string {
  return ID_PREFIX + sha256(attempt.learningCycleId) + ":" + attempt.configurationIdentity;
}

function parseAttempt(record: EvolutionLearningRecord): ExplorationAttempt {
  const recordedAt = Date.parse(record.recordedAt);
  if (record.validationStatus !== RECORD_KIND || !record.opportunityId.startsWith(ID_PREFIX)
    || record.problem !== PROBLEM || record.changeReference !== EXPLORATION_POLICY_VERSION
    || record.outcome !== "UNKNOWN" || record.failureReason !== null || record.rollbackReference !== null || record.reusable !== false
    || !Number.isFinite(recordedAt) || new Date(recordedAt).toISOString() !== record.recordedAt) {
    throw new ExplorationError("MALFORMED_RECEIPT", "durable exploration record metadata is inconsistent");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.hypothesis);
  } catch {
    throw new ExplorationError("MALFORMED_RECEIPT", "durable exploration payload is not valid JSON");
  }
  assertExplorationAttempt(parsed);
  const attempt = parsed as ExplorationAttempt;
  const expectedReferences = ["learning-cycle:" + attempt.learningCycleId.slice("learning-cycle:".length), attempt.configurationIdentity].sort();
  if (canonicalResearchJson(attempt) !== record.hypothesis || opportunityId(attempt) !== record.opportunityId
    || record.evidenceReferences.length !== expectedReferences.length
    || record.evidenceReferences.some((reference, index) => reference !== expectedReferences[index])) {
    throw new ExplorationError("IDENTITY_CONFLICT", "durable exploration record differs from canonical identity");
  }
  return Object.freeze({
    ...attempt,
    configurationDescriptor: Object.freeze({
      ...attempt.configurationDescriptor,
      costModel: Object.freeze({ ...attempt.configurationDescriptor.costModel }),
    }),
    gatesStillRequired: Object.freeze([...attempt.gatesStillRequired]),
  });
}

/** A6 persistence adapter over the existing append-only hash-chained A2/A1/A3/A4 ledger. */
export class LearningExplorationLedger {
  public constructor(
    private readonly ledger: EvolutionLedgerPort,
    private readonly inputSets: InputSetPort,
    private readonly families: StrategyFamilyRegistry,
    private readonly now: () => number = Date.now,
  ) {}

  private attemptsFromRecords(records: readonly EvolutionLearningRecord[]): readonly ExplorationAttempt[] {
    const candidates = records.filter((record) => record.validationStatus === RECORD_KIND || record.opportunityId.startsWith(ID_PREFIX));
    const attempts = candidates.map(parseAttempt);
    for (const attempt of attempts) {
      const fingerprint = attempt.learningCycleId.slice("learning-cycle:".length);
      const inputSet = this.inputSets.getByFingerprint(fingerprint, records);
      if (inputSet == null || inputSet.learningCycleId !== attempt.learningCycleId) {
        throw new ExplorationError("A2_INPUT_NOT_DURABLE", "replayed exploration attempt has no matching canonical durable A2 input set");
      }
    }
    assertExplorationHistory(attempts);
    return Object.freeze(attempts);
  }

  public list(): readonly ExplorationAttempt[] {
    return this.attemptsFromRecords(this.ledger.list());
  }

  /**
   * Records one deterministic proposal against a durable A2 input set. The hash-chain transaction
   * replays all A6 history and recomputes this verdict while holding the existing serialized writer.
   * A competing process cannot spend the same cycle allotment from a stale snapshot.
   */
  public propose(inputSetFingerprint: string, candidate: ResearchCandidateSpecification): ExplorationAttempt {
    const errors = validateResearchCandidateSpecification(candidate);
    if (errors.length > 0) throw new ExplorationError("INVALID_CANDIDATE", "candidate specification failed validation: " + errors.join(","));
    const inputSet = this.inputSets.getByFingerprint(inputSetFingerprint);
    if (inputSet == null) throw new ExplorationError("A2_INPUT_NOT_DURABLE", "exploration requires the canonical durable A2 input set");
    const cycleId = inputSet.learningCycleId;
    const history = this.list();
    const assessment = assessExploration(cycleId, candidate, this.families, history);
    const prior = history.find((attempt) => attempt.learningCycleId === cycleId && attempt.configurationIdentity === assessment.configurationIdentity);
    if (prior != null) return prior;

    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(timestamp)) throw new ExplorationError("DURABLE_WRITE_FAILED", "durable record clock is invalid");
    const id = opportunityId(assessment);
    const evidenceReferences = ["learning-cycle:" + inputSetFingerprint, assessment.configurationIdentity].sort();
    const record: EvolutionLearningRecord = Object.freeze({
      opportunityId: id,
      problem: PROBLEM,
      evidenceReferences: Object.freeze(evidenceReferences),
      hypothesis: canonicalResearchJson(assessment),
      changeReference: EXPLORATION_POLICY_VERSION,
      validationStatus: RECORD_KIND,
      // UNKNOWN is intentional: ALLOTTED means evaluation may proceed, never success or qualification.
      outcome: "UNKNOWN",
      failureReason: null,
      rollbackReference: null,
      reusable: false,
      recordedAt: new Date(timestamp).toISOString(),
    });

    try {
      this.ledger.appendWithValidation(record, (records) => {
        const currentHistory = this.attemptsFromRecords(records);
        const currentInputSet = this.inputSets.getByFingerprint(inputSetFingerprint, records);
        if (currentInputSet == null || currentInputSet.learningCycleId !== cycleId) throw new ExplorationError("A2_INPUT_NOT_DURABLE", "A2 identity changed during exploration append");
        const expected = assessExploration(cycleId, candidate, this.families, currentHistory);
        if (!sameExplorationAttempt(expected, assessment)) throw new ExplorationError("CONCURRENT_CHANGE", "exploration history changed before its serialized append");
      });
    } catch (error) {
      const raced = this.list().find((attempt) => attempt.learningCycleId === cycleId && attempt.configurationIdentity === assessment.configurationIdentity);
      if (raced != null) return raced;
      if (error instanceof ExplorationError) throw error;
      throw new ExplorationError("DURABLE_WRITE_FAILED", "exploration assessment could not be durably appended");
    }

    const persisted = this.list().find((attempt) => attempt.learningCycleId === cycleId && attempt.configurationIdentity === assessment.configurationIdentity);
    if (persisted == null || !sameExplorationAttempt(persisted, assessment)) throw new ExplorationError("DURABLE_WRITE_FAILED", "exploration assessment did not survive hash-chain replay");
    return persisted;
  }
}
