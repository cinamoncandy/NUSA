import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperChallengerDeploymentRuntime, type QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import type { PaperResearchLineage } from "./paperResearchLineage";

type EvolutionRecord = Parameters<SqliteEvolutionLearningLedger["append"]>[0];
const HASH = "a".repeat(64);

class MemoryLedger {
  public readonly records: EvolutionRecord[] = [];
  public append(record: EvolutionRecord): EvolutionRecord {
    const prior = this.records.find((item) => item.opportunityId === record.opportunityId);
    if (prior != null) return prior;
    this.records.push(Object.freeze(record));
    return record;
  }
  public list(): readonly EvolutionRecord[] { return this.records; }
}

const advisory: LeagueCapitalAllocationAdvisory = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date(1_000).toISOString(),
  policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
  entries: Object.freeze([{ id: "challenger-a", familyId: "sma", rank: 1, leagueScore: 1, evidenceBreadth: 5, researchWeight: 1, reasons: Object.freeze(["qualified"]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
  excludedCandidateIds: Object.freeze([]),
  reasons: Object.freeze(["research-only allocation"]),
  provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
});

const researchLineage: PaperResearchLineage = Object.freeze({
  schemaVersion: 1,
  candidateId: "challenger-a",
  candidateVersion: "immutable-v9",
  originalRunFingerprintSha256: "b".repeat(64),
  replayRunFingerprintSha256: "c".repeat(64),
  researchDecisionReference: "research-decision:1",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const artifact: QualifiedPaperChallengerArtifact = Object.freeze({
  schemaVersion: 1,
  candidateId: "challenger-a",
  candidateVersion: "immutable-v9",
  market: "KRW-BTC",
  advisory,
  candidateProvenance: Object.freeze([{ candidateId: "challenger-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
  researchDecisionReference: "research-decision:1",
  researchLineage,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const decision = Object.freeze({
  decisionId: "decision-1",
  outcome: "QUALIFIED_FOR_LEAGUE" as const,
  candidateId: "challenger-a",
  candidateVersion: "immutable-v9",
  decisionReference: "research-decision:1",
  reasons: Object.freeze(["qualified"]),
});

function account(updatedAt = 2_000): PaperAccountState {
  return { version: 1, updatedAt } as PaperAccountState;
}

describe("PaperChallengerDeploymentRuntime", () => {
  it("persists exact Research lineage with the canonical PAPER binding and opens the period", () => {
    const ledger = new MemoryLedger();
    const bindings = new PaperChallengerBindingLedger(ledger);
    const opens: unknown[] = [];
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => artifact },
      bindings,
      periods: {
        listRealizedPeriods: () => Object.freeze([]),
        openPeriodFromCanonicalAccount: (input) => {
          opens.push(input);
          return Object.freeze({ ...input, schemaVersion: 1 as const, observationIds: Object.freeze([]), observations: Object.freeze([]) });
        },
      },
      readCanonicalPaperAccount: () => account(),
    });

    const receipt = runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
    assert.equal(receipt.candidateId, "challenger-a");
    assert.equal(receipt.liveAuthority, "NONE");
    assert.equal(receipt.productionMutationAllowed, false);
    assert.equal(receipt.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(opens.length, 1);
    const active = bindings.current("KRW-BTC", 2_000);
    assert.equal(active?.binding.candidateId, "challenger-a");
    assert.equal(active?.binding.datasetContentSha256, HASH);
    assert.deepEqual(active?.researchLineage, researchLineage);
    assert.deepEqual(new PaperChallengerBindingLedger(ledger).lineage("KRW-BTC", 2_000), researchLineage);
  });

  it("fails closed when the qualified decision cannot resolve its immutable Research/League artifact", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => undefined },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
    });
    assert.throws(() => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /artifact is unavailable/);
  });

  it("fails closed when Research decision provenance differs from the persisted artifact", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => Object.freeze({ ...artifact, researchDecisionReference: "different" }) },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
    });
    assert.throws(() => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /decision provenance conflict/);
  });

  it("fails closed on a legacy artifact that cannot identify the original Research snapshot", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => Object.freeze({ ...artifact, researchLineage: undefined }) },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
    });
    assert.throws(() => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /Research lineage is unavailable/);
  });

  it("fails closed if a replay finds the same active binding with different Research lineage", () => {
    const ledger = new MemoryLedger();
    const bindings = new PaperChallengerBindingLedger(ledger);
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => artifact },
      bindings,
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: (input) => Object.freeze({ ...input, schemaVersion: 1 as const, observationIds: Object.freeze([]), observations: Object.freeze([]) }) },
      readCanonicalPaperAccount: () => account(),
    });
    runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
    const conflicting = Object.freeze({ ...artifact, researchLineage: Object.freeze({ ...researchLineage, replayRunFingerprintSha256: "d".repeat(64) }) });
    const replay = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => conflicting },
      bindings,
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
    });
    assert.throws(() => replay.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /Research lineage conflict/);
  });
});
