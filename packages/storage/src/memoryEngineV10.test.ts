import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { SqliteDatabase } from "./index";
import { SqliteAiOutcomeAttributionMemory } from "./aiOutcomeAttributionMemory";
import { SqliteEvolutionLearningLedger } from "./evolutionLearningLedger";
import { SqliteImprovementCandidateMemory } from "./improvementCandidateMemory";
import { MemoryEngineV10 } from "./memoryEngineV10";
import { SqliteResearchMemoryRepository } from "./researchMemory";

let db: SqliteDatabase | undefined;
let aiOutcome: SqliteAiOutcomeAttributionMemory | undefined;

afterEach(() => {
  aiOutcome?.close();
  db?.close();
  aiOutcome = undefined;
  db = undefined;
});

describe("MemoryEngineV10", () => {
  it("replays every canonical persistent memory before reporting a safe snapshot", () => {
    db = new SqliteDatabase(":memory:");
    aiOutcome = new SqliteAiOutcomeAttributionMemory(":memory:");
    const engine = new MemoryEngineV10({
      research: new SqliteResearchMemoryRepository(db),
      improvement: new SqliteImprovementCandidateMemory(db),
      evolution: new SqliteEvolutionLearningLedger(db),
      aiOutcome
    });

    const snapshot = engine.snapshot();
    assert.equal(snapshot.researchHypotheses, 0);
    assert.equal(snapshot.researchExperiments, 0);
    assert.equal(snapshot.improvementCandidates, 0);
    assert.equal(snapshot.evolutionEvents, 0);
    assert.equal(snapshot.aiOutcomeEvents, 0);
    assert.equal(snapshot.authority, "ADVISORY_ONLY");
    assert.equal(snapshot.liveAuthority, "NONE");
    assert.equal(snapshot.productionMutationAllowed, false);
    assert.match(snapshot.evolutionHeadHash, /^[a-f0-9]{64}$/);
    assert.match(snapshot.aiOutcomeHeadHash, /^[a-f0-9]{64}$/);
  });
});
