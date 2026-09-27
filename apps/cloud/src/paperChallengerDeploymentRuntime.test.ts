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
const SPECIFICATION_HASH = "b".repeat(64);

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
  candidateVersion: SPECIFICATION_HASH,
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
  candidateVersion: SPECIFICATION_HASH,
  market: "KRW-BTC",
  advisory,
  candidateProvenance: Object.freeze([{ candidateId: "challenger-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
  candidateStrategy: Object.freeze({ candidateId: "challenger-a", familyId: "sma-crossover", lineageId: "sma-v1", specificationHash: SPECIFICATION_HASH, codeSha: "c".repeat(40), costModelVersion: "cost-v1", parameters: Object.freeze({ shortPeriod: 2, longPeriod: 3 }) }),
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
  candidateVersion: SPECIFICATION_HASH,
  decisionReference: "research-decision:1",
  reasons: Object.freeze(["qualified"]),
});

function account(updatedAt = 2_000): PaperAccountState {
  return { version: 1, updatedAt } as PaperAccountState;
}

/**
 * Canonical Strategy Governance approval for the one candidate these fixtures deploy. It is exact on
 * purpose: it answers only for this candidate, version, family and binding evidence and throws for
 * anything else, so a test cannot pass against a port that authorizes everything.
 */
const governanceApproval = Object.freeze({
  strategyId: "sma-crossover-strategy",
  candidateId: "challenger-a",
  candidateVersion: SPECIFICATION_HASH,
  familyId: "sma-crossover",
  lifecycle: "CHALLENGER",
  approval: Object.freeze({
    actorType: "HUMAN",
    approvalReference: "owner:challenger:challenger-a",
    approvedAt: 1,
    decisionFingerprint: "d".repeat(64),
  }),
});

const governanceFor = (overrides: Record<string, unknown> = {}) => ({
  requireExecutableChallenger: (request: { candidateId: string; candidateVersion: string; familyId: string; evidenceFingerprintSha256: string }) => {
    if (
      request.candidateId !== governanceApproval.candidateId ||
      request.candidateVersion !== governanceApproval.candidateVersion ||
      request.familyId !== governanceApproval.familyId
    ) throw new Error("PAPER_CHALLENGER_GOVERNANCE_NOT_APPROVED");
    return { ...governanceApproval, evidenceFingerprintSha256: request.evidenceFingerprintSha256, ...overrides };
  },
});

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
      governance: governanceFor(),
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
    assert.deepEqual(active?.binding.candidateStrategy?.parameters, { shortPeriod: 2, longPeriod: 3 });
    assert.deepEqual(active?.researchLineage, researchLineage);
    assert.deepEqual(new PaperChallengerBindingLedger(ledger).lineage("KRW-BTC", 2_000), researchLineage);
  });

  it("fails closed when the qualified decision cannot resolve its immutable Research/League artifact", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => undefined },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
      governance: governanceFor(),
    });
    assert.throws(() => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /artifact is unavailable/);
  });

  it("fails closed when Research decision provenance differs from the persisted artifact", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => Object.freeze({ ...artifact, researchDecisionReference: "different" }) },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
      governance: governanceFor(),
    });
    assert.throws(() => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /decision provenance conflict/);
  });

  it("fails closed when a qualified artifact has no executable strategy semantics", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => Object.freeze({ ...artifact, candidateStrategy: undefined }) },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
      governance: governanceFor(),
    });
    assert.throws(() => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /strategy semantics are unavailable/);
  });

  it("fails closed on a legacy artifact that cannot identify the original Research snapshot", () => {
    const runtime = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => Object.freeze({ ...artifact, researchLineage: undefined }) },
      bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
      governance: governanceFor(),
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
      governance: governanceFor(),
    });
    runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
    const conflicting = Object.freeze({ ...artifact, researchLineage: Object.freeze({ ...researchLineage, replayRunFingerprintSha256: "d".repeat(64) }) });
    const replay = new PaperChallengerDeploymentRuntime({
      artifacts: { read: () => conflicting },
      bindings,
      periods: { listRealizedPeriods: () => [], openPeriodFromCanonicalAccount: () => { throw new Error("must not open"); } },
      readCanonicalPaperAccount: () => account(),
      governance: governanceFor(),
    });
    assert.throws(() => replay.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), /Research lineage conflict/);
  });
});

describe("PaperChallengerDeploymentRuntime Strategy Governance gate", () => {
  const deployWith = (governance: unknown) => {
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
      governance: governance as never,
    });
    const run = () => runtime.deploy({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
    return { run, opens, ledger };
  };

  const expectNoSideEffect = (governance: unknown, pattern: RegExp) => {
    const { run, opens, ledger } = deployWith(governance);
    assert.throws(run, pattern);
    // The gate runs before revoke, activate and period open, so a refusal must leave no binding
    // event and no opened period behind.
    assert.equal(opens.length, 0, "a refused deployment must not open a PAPER period");
    assert.equal(ledger.records.length, 0, "a refused deployment must not append a binding event");
  };

  it("refuses to deploy when no Governance port is wired at all", () => {
    expectNoSideEffect(undefined, /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE/);
  });

  it("refuses an approval for a different candidate, version, family or evidence", () => {
    for (const override of [
      { candidateId: "other-candidate" },
      { candidateVersion: "f".repeat(64) },
      { familyId: "other-family" },
      { evidenceFingerprintSha256: "e".repeat(64) },
    ]) {
      expectNoSideEffect(governanceFor(override), /PAPER_CHALLENGER_GOVERNANCE_IDENTITY_MISMATCH/);
    }
  });

  it("refuses every lifecycle that is not a current CHALLENGER", () => {
    for (const lifecycle of ["PAPER_ACTIVE", "PROMOTION_PENDING", "CHAMPION", "SUSPENDED", "ROLLED_BACK", "RETIRED", "REJECTED", "DRAFT"]) {
      expectNoSideEffect(governanceFor({ lifecycle }), /PAPER_CHALLENGER_GOVERNANCE_LIFECYCLE_INVALID/);
    }
  });

  it("refuses AI or AXIOM self-approval", () => {
    for (const actorType of ["AI", "AXIOM", "SYSTEM", "SERVICE"]) {
      expectNoSideEffect(governanceFor({ approval: { ...governanceApproval.approval, actorType } }), /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID/);
    }
  });

  it("refuses malformed approval provenance", () => {
    for (const approval of [
      { ...governanceApproval.approval, decisionFingerprint: "not-a-sha" },
      { ...governanceApproval.approval, approvalReference: "" },
      { ...governanceApproval.approval, approvedAt: -1 },
      { ...governanceApproval.approval, approvedAt: 1.5 },
    ]) {
      expectNoSideEffect(governanceFor({ approval }), /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID/);
    }
  });

  it("refuses a port that answers with nothing", () => {
    expectNoSideEffect({ requireExecutableChallenger: () => undefined }, /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE/);
  });

  it("lets an approved CHALLENGER through and keeps an identical replay idempotent", () => {
    const { run, opens } = deployWith(governanceFor());
    const first = run();
    assert.equal(first.candidateId, "challenger-a");
    assert.equal(opens.length, 1);
    const second = run();
    assert.equal(second.candidateId, "challenger-a");
    assert.equal(opens.length, 2, "replay re-opens deterministically rather than double-binding");
  });
});
