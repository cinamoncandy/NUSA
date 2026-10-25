import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { createResearchCandidateSpecification, type ResearchCandidateSpecification } from "../../../packages/contracts/src/researchCandidateSpecification";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
import { SqlitePersistedPaperPeriodStore } from "../../../packages/storage/src/persistedPaperPeriodStore";
import { SqliteResearchFactoryDecisionHistoryRepository } from "../../../packages/storage/src/researchFactoryDecisionHistoryRepository";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { ResearchFactoryDecisionHistoryRecord } from "../../../packages/contracts/src/researchFactoryDecisionHistory";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { createEvolutionLearningRecord } from "../../autopilot/src/evolveLearningMemory";
import type { EvolutionLearningRecord } from "../../autopilot/src/evolveLearningMemory";
import { buildLearningInputSet } from "./learningInputSet";
import { LearningInputSetLedger } from "./learningInputSetLedger";
import { createLearningEvidenceAuthorityFromReaders } from "./learningEvidenceAuthority";
import { StrategyFamilyRegistry } from "./strategyFamilyRegistry";
import { ExplorationError, EXPLORATION_ALLOTMENT_PER_CYCLE, FAMILY_REPETITION_CEILING, GATES_STILL_REQUIRED, assertExplorationHistory } from "./exploration";
import { LearningExplorationLedger } from "./explorationLedger";

const TIME = Date.parse("2026-10-23T03:00:00.000Z");
const HASH = (value: string) => createHash("sha256").update(value).digest("hex");
const FINGERPRINT = HASH("dataset-content");

function dbPath(): string {
  return join(mkdtempSync(join(process.cwd(), ".nusa-exploration-")), "learning.sqlite");
}

function cleanup(filename: string): void {
  rmSync(dirname(filename), { recursive: true, force: true });
}

function inputSet(cutoffTimestamp = TIME) {
  return buildLearningInputSet({
    cutoffTimestamp,
    researchEvidence: [{ recordId: "trial-a", recordedAt: TIME - 10_000 }],
    paperEvidence: [{ recordId: "period-a", recordedAt: TIME - 5_000 }],
    policies: { learningPolicyVersion: "learning-v1", researchPolicyVersion: "research-v1", riskPolicyVersion: "risk-v1", governancePolicyVersion: "governance-v1" },
  });
}

function candidate(overrides: Partial<ResearchCandidateSpecification> = {}): ResearchCandidateSpecification {
  return createResearchCandidateSpecification({
    candidateId: "candidate-a",
    hypothesisId: "hypothesis-a",
    familyId: "momentum",
    lineageId: "lineage-a",
    strategyId: "strategy-a",
    strategyVersion: "1.0.0",
    parametersCanonicalJson: "{\"fast\":3,\"slow\":9}",
    codeSha: "a".repeat(40),
    datasetId: "dataset-a",
    datasetContentSha256: FINGERPRINT,
    costModel: { feeBps: 5, slippageBps: 2, spreadBps: 1, turnoverAssumption: 0.5 },
    createdAt: "2026-10-23T02:00:00.000Z",
    evaluationWindowStart: "2026-01-01T00:00:00.000Z",
    evaluationWindowEnd: "2026-06-30T00:00:00.000Z",
    ...overrides,
  });
}

function familyRegistry(): StrategyFamilyRegistry {
  const registry = new StrategyFamilyRegistry();
  registry.registerFamily({ familyId: "momentum", name: "Momentum", category: "TREND", thesis: "Registered canonical research family", lifecycle: "RESEARCHING" });
  registry.registerMember({ strategyId: "strategy-a", version: "1.0.0", familyId: "momentum", role: "RESEARCH_CANDIDATE" });
  return registry;
}

function seedResearchRecord(): ResearchFactoryDecisionHistoryRecord {
  return {
    candidateId: "candidate-a",
    evaluationId: "trial-a",
    outcome: "REJECTED",
    reasons: ["canonical research fixture"],
    observedAt: TIME - 10_000,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function seedPaperPeriod(): PersistedPaperPeriodEnvelope {
  const periodStartAt = TIME - 6_000;
  const periodEndAt = TIME - 5_000;
  return {
    record: {
      recordId: "period-a",
      periodIndex: 0,
      periodStartAt,
      periodEndAt,
      advisory: {
        schemaVersion: 1,
        generatedAt: "1970-01-01T00:00:00.000Z",
        policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
        entries: [],
        excludedCandidateIds: [],
        reasons: [],
        provenance: { sourceDatasetIds: ["dataset-a"] },
      },
      realizedReturns: {},
      benchmarkReturn: 0,
      turnoverCostRate: 0,
      costEvidence: {
        evidenceId: "cost-period-a",
        source: "PAPER_EXECUTION_RECEIPT",
        evidenceKind: "OBSERVED",
        evidenceFingerprintSha256: "a".repeat(64),
        observedAt: periodEndAt,
        feeRate: 0,
        spreadRate: 0,
        slippageRate: 0,
      },
      status: "COMPLETED",
    },
    candidateProvenance: [],
  };
}

function evidenceAuthority(
  researchHistory: SqliteResearchFactoryDecisionHistoryRepository,
  paperPeriods: SqlitePersistedPaperPeriodStore,
) {
  const readResearchSnapshot = () => researchHistory.list().map((record) => ({ recordId: record.evaluationId, recordedAt: record.observedAt }));
  const readPaperSnapshot = () => paperPeriods.listRecords().map((record) => ({ recordId: record.recordId, recordedAt: record.periodEndAt }));
  return createLearningEvidenceAuthorityFromReaders({
    readResearch: (recordId) => readResearchSnapshot().find((record) => record.recordId === recordId),
    readPaper: (recordId) => readPaperSnapshot().find((record) => record.recordId === recordId),
    readResearchSnapshot,
    readPaperSnapshot,
  });
}

function setup(filename: string, now: () => number = () => TIME) {
  const db = new SqliteDatabase(filename);
  const paperPeriods = new SqlitePersistedPaperPeriodStore(db);
  const researchHistory = new SqliteResearchFactoryDecisionHistoryRepository(db);
  researchHistory.append(seedResearchRecord());
  paperPeriods.append(seedPaperPeriod());
  const evolution = new SqliteEvolutionLearningLedger(db);
  const inputSets = new LearningInputSetLedger(evolution, evidenceAuthority(researchHistory, paperPeriods), now);
  const input = inputSets.append(inputSet());
  const exploration = new LearningExplorationLedger(evolution, inputSets, familyRegistry(), now);
  return { db, evolution, input, inputSets, exploration };
}

describe("A6 durable exploration contract", () => {
  it("derives candidate and family identities from a validated, registered canonical specification", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const first = state.exploration.propose(state.input.fingerprint, candidate());
      const renamed = state.exploration.propose(state.input.fingerprint, candidate({ candidateId: "candidate-renamed", hypothesisId: "hypothesis-renamed", lineageId: "lineage-renamed" }));
      assert.equal(first.experimentIdentity, first.configurationIdentity);
      assert.equal(renamed.experimentIdentity, first.experimentIdentity);
      assert.equal(renamed.verdict, "ALLOTTED", "same-config replay returns the immutable original receipt");
      assert.equal(state.exploration.list().length, 1);
      assert.throws(() => state.exploration.propose(state.input.fingerprint, candidate({ familyId: "renamed-family" })), (error: unknown) => error instanceof ExplorationError && error.code === "UNREGISTERED_FAMILY_MEMBER");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("requires an existing durable A2 set and stores the A6 receipt in the existing hash-chain ledger", () => {
    const filename = dbPath();
    const db = new SqliteDatabase(filename);
    try {
      const paperPeriods = new SqlitePersistedPaperPeriodStore(db);
      const researchHistory = new SqliteResearchFactoryDecisionHistoryRepository(db);
      const evolution = new SqliteEvolutionLearningLedger(db);
      const inputSets = new LearningInputSetLedger(evolution, evidenceAuthority(researchHistory, paperPeriods), () => TIME);
      const ledger = new LearningExplorationLedger(evolution, inputSets, familyRegistry(), () => TIME);
      assert.throws(() => ledger.propose(HASH("missing"), candidate()), (error: unknown) => error instanceof ExplorationError && error.code === "A2_INPUT_NOT_DURABLE");
      assert.equal(evolution.size(), 0);
    } finally {
      db.close();
      cleanup(filename);
    }
  });

  it("suppresses near duplicates even when dataset, evaluation window, and caller labels change", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const first = state.exploration.propose(state.input.fingerprint, candidate());
      const near = state.exploration.propose(state.input.fingerprint, candidate({
        candidateId: "candidate-b", hypothesisId: "hypothesis-b", datasetId: "dataset-b", datasetContentSha256: HASH("dataset-b"),
        evaluationWindowStart: "2026-02-01T00:00:00.000Z", evaluationWindowEnd: "2026-07-30T00:00:00.000Z",
      }));
      assert.equal(first.verdict, "ALLOTTED");
      assert.equal(near.verdict, "SUPPRESSED_NEAR_DUPLICATE");
      assert.equal(near.allotmentRemaining, EXPLORATION_ALLOTMENT_PER_CYCLE - 1);
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("keeps exact and near-duplicate diversity history across A2 cycles while resetting only the cycle allotment", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const first = state.exploration.propose(state.input.fingerprint, candidate());
      const nextCycle = state.inputSets.append(inputSet(TIME + 1_000));
      const exactRepeat = state.exploration.propose(nextCycle.fingerprint, candidate({ candidateId: "candidate-next-cycle" }));
      assert.equal(first.verdict, "ALLOTTED");
      assert.equal(exactRepeat.verdict, "SUPPRESSED_EXACT_DUPLICATE");
      assert.equal(exactRepeat.allotmentRemaining, EXPLORATION_ALLOTMENT_PER_CYCLE, "the new cycle retains its full allotment");

      const secondFamilyAttempt = state.exploration.propose(state.input.fingerprint, candidate({
        candidateId: "candidate-second-family-attempt",
        parametersCanonicalJson: "{\"fast\":5,\"slow\":11}",
      }));
      assert.equal(secondFamilyAttempt.verdict, "ALLOTTED");

      const nearRepeat = state.exploration.propose(nextCycle.fingerprint, candidate({
        candidateId: "candidate-near-next-cycle",
        parametersCanonicalJson: "{\"fast\":4,\"slow\":10}",
        datasetId: "dataset-next-cycle",
        datasetContentSha256: HASH("dataset-next-cycle"),
        evaluationWindowStart: "2026-02-01T00:00:00.000Z",
        evaluationWindowEnd: "2026-07-30T00:00:00.000Z",
      }));
      assert.equal(nearRepeat.verdict, "ALLOTTED", "a genuinely different configuration may use the new cycle allotment");
      const familyCeiling = state.exploration.propose(nextCycle.fingerprint, candidate({
        candidateId: "candidate-family-ceiling",
        parametersCanonicalJson: "{\"fast\":6,\"slow\":12}",
      }));
      assert.equal(familyCeiling.verdict, "SUPPRESSED_FAMILY_CEILING", "family repetition also uses durable cross-cycle diversity history");
      assert.equal(familyCeiling.familyRepetitionCount, FAMILY_REPETITION_CEILING);
      assert.equal(familyCeiling.allotmentRemaining, EXPLORATION_ALLOTMENT_PER_CYCLE - 1, "family suppression does not spend another new-cycle slot");
      assert.equal(state.exploration.list().length, 5, "both cycles remain replayable from the canonical ledger");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("canonicalizes equivalent ISO timestamp spellings before configuration identity hashing", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const canonical = state.exploration.propose(state.input.fingerprint, candidate());
      const equivalent = state.exploration.propose(state.input.fingerprint, candidate({
        evaluationWindowStart: "2026-01-01T00:00:00Z",
        evaluationWindowEnd: "2026-06-30T00:00:00Z",
      }));
      assert.equal(equivalent.configurationIdentity, canonical.configurationIdentity);
      assert.equal(equivalent.configurationDescriptor.evaluationWindowStart, "2026-01-01T00:00:00.000Z");
      assert.equal(equivalent.configurationDescriptor.evaluationWindowEnd, "2026-06-30T00:00:00.000Z");
      assert.equal(state.exploration.list().length, 1, "equivalent timestamps replay the original durable attempt");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("verifies each preceding A2 evidence snapshot once when replaying several A6 receipts in one cycle", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      for (let index = 1; index <= 3; index += 1) {
        state.exploration.propose(state.input.fingerprint, candidate({
          candidateId: `candidate-${index}`,
          parametersCanonicalJson: canonicalResearchJson({ fast: index + 10, slow: index + 20 }),
        }));
      }
      const checked: string[] = [];
      const countedInputSets = {
        getByFingerprint: (fingerprint: string, snapshot?: Parameters<typeof state.inputSets.getByFingerprint>[1]) => {
          checked.push(fingerprint);
          return state.inputSets.getByFingerprint(fingerprint, snapshot);
        },
      };
      const replay = new LearningExplorationLedger(state.evolution, countedInputSets, familyRegistry(), () => TIME);
      assert.equal(replay.list().length, 3);
      assert.deepEqual(checked, [state.input.fingerprint], "all same-cycle A6 receipts share one verified A2 lookup");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("enforces the family ceiling and cycle allotment from durable history", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const proposals = [1, 2, 3, 4].map((index) => state.exploration.propose(state.input.fingerprint, candidate({
        candidateId: `candidate-${index}`, hypothesisId: `hypothesis-${index}`, lineageId: `lineage-${index}`,
        parametersCanonicalJson: canonicalResearchJson({ fast: index, slow: index + 8 }),
      })));
      assert.deepEqual(proposals.map(({ verdict }) => verdict), ["ALLOTTED", "ALLOTTED", "ALLOTTED", "SUPPRESSED_FAMILY_CEILING"]);
      assert.equal(proposals[3].familyRepetitionCount, FAMILY_REPETITION_CEILING);
      assert.equal(proposals[3].allotmentRemaining, EXPLORATION_ALLOTMENT_PER_CYCLE - FAMILY_REPETITION_CEILING);
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("survives an actual SQLite close/reopen and replay does not add a second attempt", () => {
    const filename = dbPath();
    let state = setup(filename);
    let expected;
    try {
      expected = state.exploration.propose(state.input.fingerprint, candidate());
      state.db.close();
      state = setupAfterRestart(filename);
      const replayed = state.exploration.propose(state.input.fingerprint, candidate({ candidateId: "renamed" }));
      assert.deepEqual(replayed, expected);
      assert.equal(state.exploration.list().length, 1);
      assert.equal(state.evolution.replay().headHash, state.evolution.headHash());
    } finally {
      try { state.db.close(); } catch { /* already closed */ }
      cleanup(filename);
    }
  });

  it("rejects tampered rehydration counters, verdicts, and gate lists", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const stored = state.exploration.propose(state.input.fingerprint, candidate());
      assert.throws(() => assertExplorationHistory([{ ...stored, allotmentRemaining: 4 }]), /deterministic replay/);
      assert.throws(() => assertExplorationHistory([{ ...stored, verdict: "QUALIFIED" } as never]), /verdict/);
      assert.throws(() => assertExplorationHistory([{ ...stored, gatesStillRequired: ["governance"] }]), /required gates/);
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("replay rejects exploration history without its canonical A2 input set", () => {
    const filename = dbPath();
    const state = setup(filename);
    const orphanFilename = dbPath();
    const orphanDb = new SqliteDatabase(orphanFilename);
    try {
      state.exploration.propose(state.input.fingerprint, candidate());
      const record = state.evolution.list().find((entry) => entry.validationStatus === "LEARNING_EXPLORATION");
      assert.ok(record);
      const orphanPaperPeriods = new SqlitePersistedPaperPeriodStore(orphanDb);
      const orphanResearchHistory = new SqliteResearchFactoryDecisionHistoryRepository(orphanDb);
      const orphanEvolution = new SqliteEvolutionLearningLedger(orphanDb);
      const emptyInputSets = new LearningInputSetLedger(orphanEvolution, evidenceAuthority(orphanResearchHistory, orphanPaperPeriods), () => TIME);
      const replay = new LearningExplorationLedger({
        list: () => [record],
        appendWithValidation: () => { throw new Error("append must not run during replay"); },
      }, emptyInputSets, familyRegistry(), () => TIME);
      assert.throws(() => replay.list(), (error: unknown) => error instanceof ExplorationError && error.code === "A2_INPUT_NOT_DURABLE");
    } finally {
      state.db.close();
      orphanDb.close();
      cleanup(filename);
      cleanup(orphanFilename);
    }
  });

  it("replay rejects an A6 receipt that precedes its canonical A2 authority record", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      state.exploration.propose(state.input.fingerprint, candidate());
      const records = state.evolution.list();
      const a2 = records.find((record) => record.opportunityId === `learning-input-set:${state.input.fingerprint}`);
      const a6 = records.find((record) => record.validationStatus === "LEARNING_EXPLORATION");
      assert.ok(a2);
      assert.ok(a6);
      const reordered = new LearningExplorationLedger({
        list: () => [a6, a2],
        appendWithValidation: () => { throw new Error("append must not run during replay"); },
      }, state.inputSets, familyRegistry(), () => TIME);
      assert.throws(reordered.list.bind(reordered), (error: unknown) => error instanceof ExplorationError && error.code === "A2_INPUT_NOT_DURABLE");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("replay revalidates strategy-family membership instead of trusting a durable-shaped receipt", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      state.exploration.propose(state.input.fingerprint, candidate());
      const familiesWithoutMember = new StrategyFamilyRegistry();
      familiesWithoutMember.registerFamily({ familyId: "momentum", name: "Momentum", category: "TREND", thesis: "Registered family without this strategy member", lifecycle: "RESEARCHING" });
      const replay = new LearningExplorationLedger(state.evolution, state.inputSets, familiesWithoutMember, () => TIME);
      assert.throws(replay.list.bind(replay), (error: unknown) => error instanceof ExplorationError && error.code === "UNREGISTERED_FAMILY_MEMBER");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("persists only the exact validated cost-model fields", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const extraCostCandidate = candidate({
        costModel: { ...candidate().costModel, callerClaim: true } as ResearchCandidateSpecification["costModel"],
      });
      const attempt = state.exploration.propose(state.input.fingerprint, extraCostCandidate);
      assert.deepEqual(Object.keys(attempt.configurationDescriptor.costModel).sort(), ["feeBps", "slippageBps", "spreadBps", "turnoverAssumption"]);
      assert.equal(state.exploration.list().length, 1, "post-append replay remains valid after caller extras are excluded");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("rejects a hash-chain-shaped A6 receipt with a noncanonical Evolution envelope", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      state.exploration.propose(state.input.fingerprint, candidate());
      const original = state.evolution.list().find((record) => record.validationStatus === "LEARNING_EXPLORATION");
      assert.ok(original);
      const corruptions: readonly ((record: EvolutionLearningRecord) => EvolutionLearningRecord)[] = [
        (record) => createEvolutionLearningRecord({ ...record, outcome: "SUCCESS" }),
        (record) => createEvolutionLearningRecord({ ...record, reusable: true }),
        (record) => createEvolutionLearningRecord({ ...record, evidenceReferences: ["unrelated-evidence"] }),
        (record) => createEvolutionLearningRecord({ ...record, problem: "unrelated learning record" }),
        (record) => createEvolutionLearningRecord({ ...record, changeReference: "different-policy" }),
        (record) => createEvolutionLearningRecord({ ...record, recordedAt: "2026-10-23T03:00:00Z" }),
      ];
      for (const corrupt of corruptions) {
        const forged = corrupt(original);
        const forgedLedger = {
          list: () => [forged],
          appendWithValidation: () => { throw new Error("append must not run during replay"); },
        };
        const replay = new LearningExplorationLedger(forgedLedger, state.inputSets, familyRegistry(), () => TIME);
        assert.throws(() => replay.list(), (error: unknown) => error instanceof ExplorationError && ["MALFORMED_RECEIPT", "IDENTITY_CONFLICT"].includes(error.code));
      }
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("fails closed when a competing process consumes the stale allotment before append", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const competing = new LearningExplorationLedger(state.evolution, state.inputSets, familyRegistry(), () => TIME);
      const racingPort = {
        list: () => state.evolution.list(),
        appendWithValidation: (record: Parameters<typeof state.evolution.appendWithValidation>[0], validateCurrent: Parameters<typeof state.evolution.appendWithValidation>[1]) => {
          competing.propose(state.input.fingerprint, candidate({ candidateId: "racer", parametersCanonicalJson: "{\"fast\":4,\"slow\":12}" }));
          return state.evolution.appendWithValidation(record, validateCurrent);
        },
      };
      const stale = new LearningExplorationLedger(racingPort, state.inputSets, familyRegistry(), () => TIME);
      assert.throws(() => stale.propose(state.input.fingerprint, candidate()), (error: unknown) => error instanceof ExplorationError && error.code === "CONCURRENT_CHANGE");
      assert.equal(state.exploration.list().length, 1, "losing stale writer appends no receipt");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });

  it("states every downstream gate for an allotted assessment", () => {
    const filename = dbPath();
    const state = setup(filename);
    try {
      const attempt = state.exploration.propose(state.input.fingerprint, candidate());
      assert.deepEqual(attempt.gatesStillRequired, GATES_STILL_REQUIRED);
      assert.equal(attempt.verdict, "ALLOTTED", "allotment is evaluation permission only");
    } finally {
      state.db.close();
      cleanup(filename);
    }
  });
});

function setupAfterRestart(filename: string) {
  const db = new SqliteDatabase(filename);
  const paperPeriods = new SqlitePersistedPaperPeriodStore(db);
  const researchHistory = new SqliteResearchFactoryDecisionHistoryRepository(db);
  const evolution = new SqliteEvolutionLearningLedger(db);
  const inputSets = new LearningInputSetLedger(evolution, evidenceAuthority(researchHistory, paperPeriods), () => TIME);
  const input = inputSets.summary().latest;
  assert.ok(input, "the canonical A2 receipt survives restart");
  return {
    db,
    evolution,
    input,
    inputSets,
    exploration: new LearningExplorationLedger(evolution, inputSets, familyRegistry(), () => TIME + 1_000),
  };
}
