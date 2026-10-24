import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { createResearchCandidateSpecification, type ResearchCandidateSpecification } from "../../../packages/contracts/src/researchCandidateSpecification";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
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

function inputSet() {
  return buildLearningInputSet({
    cutoffTimestamp: TIME,
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

function evidenceAuthority() {
  return createLearningEvidenceAuthorityFromReaders({
    readResearch: (recordId: string) => recordId === "trial-a" ? { recordId, recordedAt: TIME - 10_000 } : undefined,
    readPaper: (recordId: string) => recordId === "period-a" ? { recordId, recordedAt: TIME - 5_000 } : undefined,
  });
}

function setup(filename: string, now: () => number = () => TIME) {
  const db = new SqliteDatabase(filename);
  const evolution = new SqliteEvolutionLearningLedger(db);
  const inputSets = new LearningInputSetLedger(evolution, evidenceAuthority(), now);
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
      const evolution = new SqliteEvolutionLearningLedger(db);
      const inputSets = new LearningInputSetLedger(evolution, evidenceAuthority(), () => TIME);
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
      const orphanEvolution = new SqliteEvolutionLearningLedger(orphanDb);
      const emptyInputSets = new LearningInputSetLedger(orphanEvolution, evidenceAuthority(), () => TIME);
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
  const evolution = new SqliteEvolutionLearningLedger(db);
  const inputSets = new LearningInputSetLedger(evolution, evidenceAuthority(), () => TIME);
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
