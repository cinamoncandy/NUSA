import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ClosedLearningLoopCoordinator,
  closedLearningCycleId,
  type ClosedLearningCycleRecord,
  type ClosedLearningCycleRepository,
  type ClosedLearningEvidenceIdentity,
  type ClosedLearningResearchDecision,
} from "./closedLearningLoopCoordinator";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SOURCE_SHA = "1".repeat(40);

function evidence(overrides: Partial<ClosedLearningEvidenceIdentity> = {}): ClosedLearningEvidenceIdentity {
  return {
    evidenceId: "paper-forward:krw-btc:2026-09-04",
    evidenceFingerprintSha256: HASH_A,
    championId: "champion-a",
    championVersion: "v7",
    sourceCommitSha: SOURCE_SHA,
    costModelVersion: "paper-cost-v3",
    riskConfigHash: HASH_B,
    evidenceReferences: ["paper-period:42", "league-run:17"],
    ...overrides,
  };
}

class MemoryRepository implements ClosedLearningCycleRepository {
  public readonly history: ClosedLearningCycleRecord[] = [];
  private readonly latest = new Map<string, ClosedLearningCycleRecord>();
  public get(cycleId: string): ClosedLearningCycleRecord | undefined { return this.latest.get(cycleId); }
  public append(record: ClosedLearningCycleRecord): ClosedLearningCycleRecord {
    const prior = this.latest.get(record.cycleId);
    if (prior != null && (prior.evidenceId !== record.evidenceId || prior.evidenceFingerprintSha256 !== record.evidenceFingerprintSha256)) throw new Error("IDENTITY_CONFLICT");
    const frozen = Object.freeze(record);
    this.history.push(frozen);
    this.latest.set(record.cycleId, frozen);
    return frozen;
  }
}

function decision(outcome: ClosedLearningResearchDecision["outcome"]): ClosedLearningResearchDecision {
  return {
    decisionId: `decision-${outcome.toLowerCase()}`,
    outcome,
    ...(outcome === "QUALIFIED_FOR_LEAGUE" ? { candidateId: "challenger-a", candidateVersion: "immutable-v9" } : {}),
    decisionReference: `research:${outcome}`,
    reasons: [outcome],
  };
}

describe("ClosedLearningLoopCoordinator", () => {
  it("persists REJECTED and INSUFFICIENT decisions without PAPER deployment", () => {
    for (const outcome of ["REJECTED", "INSUFFICIENT"] as const) {
      const repository = new MemoryRepository();
      let deployments = 0;
      const coordinator = new ClosedLearningLoopCoordinator(repository, { evaluate: () => decision(outcome) }, { deploy: () => { deployments += 1; throw new Error("must not deploy"); } }, () => 10_000);
      const result = coordinator.run(evidence({ evidenceId: `evidence-${outcome}` }));
      assert.equal(result.status, "EXECUTED");
      assert.equal(result.record.decision.outcome, outcome);
      assert.equal(result.record.paperDeployment, undefined);
      assert.equal(repository.history.length, 1);
      assert.equal(deployments, 0);
    }
  });

  it("records qualification before deploying the challenger to PAPER-only authority", () => {
    const repository = new MemoryRepository();
    const coordinator = new ClosedLearningLoopCoordinator(repository, { evaluate: () => decision("QUALIFIED_FOR_LEAGUE") }, {
      deploy: (input) => ({
        deploymentId: `${input.cycleId}:paper`,
        candidateId: input.decision.candidateId,
        candidateVersion: input.decision.candidateVersion,
        authority: input.authority,
        liveAuthority: input.liveAuthority,
        productionMutationAllowed: input.productionMutationAllowed,
        aiAuthority: input.aiAuthority,
      }),
    }, () => 20_000);

    const result = coordinator.run(evidence());
    assert.equal(repository.history.length, 2);
    assert.equal(repository.history[0]?.decision.outcome, "QUALIFIED_FOR_LEAGUE");
    assert.equal(repository.history[0]?.paperDeployment, undefined);
    assert.equal(result.record.paperDeployment?.authority, "PAPER_RESEARCH_ONLY");
    assert.equal(result.record.paperDeployment?.liveAuthority, "NONE");
    assert.equal(result.record.paperDeployment?.productionMutationAllowed, false);
    assert.equal(result.record.paperDeployment?.aiAuthority, "ZERO_AUTHORITY");
  });

  it("replays completed evidence without rerunning Research or redeploying PAPER", () => {
    const repository = new MemoryRepository();
    let researchRuns = 0;
    let deployments = 0;
    const coordinator = new ClosedLearningLoopCoordinator(repository, { evaluate: () => { researchRuns += 1; return decision("QUALIFIED_FOR_LEAGUE"); } }, {
      deploy: (input) => {
        deployments += 1;
        return { deploymentId: "paper-1", candidateId: input.decision.candidateId, candidateVersion: input.decision.candidateVersion, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" };
      },
    }, () => 30_000);
    assert.equal(coordinator.run(evidence()).status, "EXECUTED");
    assert.equal(coordinator.run(evidence()).status, "REPLAYED");
    assert.equal(researchRuns, 1);
    assert.equal(deployments, 1);
  });

  it("resumes only the missing PAPER deployment after restart without rerunning Research", () => {
    const repository = new MemoryRepository();
    const input = evidence();
    const cycleId = closedLearningCycleId(input);
    repository.append(Object.freeze({ cycleId, evidenceId: input.evidenceId, evidenceFingerprintSha256: input.evidenceFingerprintSha256, decision: decision("QUALIFIED_FOR_LEAGUE"), recordedAt: 40_000 }));
    let researchRuns = 0;
    let deployments = 0;
    const restarted = new ClosedLearningLoopCoordinator(repository, { evaluate: () => { researchRuns += 1; return decision("REJECTED"); } }, {
      deploy: (deployment) => {
        deployments += 1;
        return { deploymentId: "paper-resumed", candidateId: deployment.decision.candidateId, candidateVersion: deployment.decision.candidateVersion, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" };
      },
    });
    const result = restarted.run(input);
    assert.equal(result.status, "RESUMED");
    assert.equal(result.record.paperDeployment?.deploymentId, "paper-resumed");
    assert.equal(researchRuns, 0);
    assert.equal(deployments, 1);
  });

  it("rejects a deployment receipt that attempts to acquire LIVE or production mutation authority", () => {
    const repository = new MemoryRepository();
    const coordinator = new ClosedLearningLoopCoordinator(repository, { evaluate: () => decision("QUALIFIED_FOR_LEAGUE") }, {
      deploy: (input) => ({
        deploymentId: "unsafe",
        candidateId: input.decision.candidateId,
        candidateVersion: input.decision.candidateVersion,
        authority: "PAPER_RESEARCH_ONLY",
        liveAuthority: "LIVE" as "NONE",
        productionMutationAllowed: true as false,
        aiAuthority: "ZERO_AUTHORITY",
      }),
    });
    assert.throws(() => coordinator.run(evidence()), /authority escaped its fail-closed boundary/);
  });

  it("changes cycle identity when provenance, cost, risk, champion or evidence changes", () => {
    const base = closedLearningCycleId(evidence());
    assert.notEqual(base, closedLearningCycleId(evidence({ evidenceFingerprintSha256: HASH_B })));
    assert.notEqual(base, closedLearningCycleId(evidence({ championVersion: "v8" })));
    assert.notEqual(base, closedLearningCycleId(evidence({ costModelVersion: "paper-cost-v4" })));
    assert.notEqual(base, closedLearningCycleId(evidence({ riskConfigHash: HASH_A })));
    assert.notEqual(base, closedLearningCycleId(evidence({ evidenceReferences: ["paper-period:99"] })));
  });
});
