import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { PaperChallengerDeploymentRuntime, type QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import { PaperChallengerPolicyApproval, paperChallengerPolicyEnabled } from "./paperChallengerPolicyApproval";
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

const request = Object.freeze({ candidateId: "challenger-a", candidateVersion: SPECIFICATION_HASH, familyId: "sma-crossover", evidenceFingerprintSha256: "e".repeat(64) });
const deployInput = Object.freeze({ cycleId: `closed-learning:${"b".repeat(64)}`, decision, authority: "PAPER_RESEARCH_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const });

function runtimeWith(governance: ConstructorParameters<typeof PaperChallengerDeploymentRuntime>[0]["governance"], opens: unknown[]) {
  return new PaperChallengerDeploymentRuntime({
    artifacts: { read: () => artifact },
    bindings: new PaperChallengerBindingLedger(new MemoryLedger()),
    periods: {
      listRealizedPeriods: () => Object.freeze([]),
      openPeriodFromCanonicalAccount: (input) => {
        opens.push(input);
        return Object.freeze({ ...input, schemaVersion: 1 as const, observationIds: Object.freeze([]), observations: Object.freeze([]) });
      },
    },
    readCanonicalPaperAccount: () => account(),
    governance,
  });
}

describe("PaperChallengerPolicyApproval (ADR-0018)", () => {
  it("is disabled unless the operator sets exactly ENABLED", () => {
    assert.equal(paperChallengerPolicyEnabled({}), false);
    assert.equal(paperChallengerPolicyEnabled({ NUSA_PAPER_CHALLENGER_POLICY_APPROVAL: "true" }), false);
    assert.equal(paperChallengerPolicyEnabled({ NUSA_PAPER_CHALLENGER_POLICY_APPROVAL: "enabled" }), false);
    assert.equal(paperChallengerPolicyEnabled({ NUSA_PAPER_CHALLENGER_POLICY_APPROVAL: "ENABLED" }), true);
  });

  it("disabled policy reports approval unavailable and deploys nothing", () => {
    const opens: unknown[] = [];
    const policy = new PaperChallengerPolicyApproval({ artifacts: { read: () => artifact }, enabled: false });
    assert.throws(() => policy.requireExecutableChallenger(request), /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE/);
    assert.throws(() => runtimeWith(policy, opens).deploy(deployInput), /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_UNAVAILABLE/);
    assert.equal(opens.length, 0);
  });

  it("enabled policy approves the qualified artifact as a POLICY CHALLENGER and the runtime deploys it", () => {
    const opens: unknown[] = [];
    const policy = new PaperChallengerPolicyApproval({ artifacts: { read: () => artifact }, enabled: true, now: () => 5 });
    const authorization = policy.requireExecutableChallenger(request);
    assert.equal(authorization.lifecycle, "CHALLENGER");
    assert.equal(authorization.approval.actorType, "POLICY");
    assert.match(authorization.approval.approvalReference, /^policy:paper-challenger-policy-v1:/);
    assert.match(authorization.approval.decisionFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(policy.requireExecutableChallenger(request).approval.decisionFingerprint, authorization.approval.decisionFingerprint, "approval is deterministic");
    const receipt = runtimeWith(policy, opens).deploy(deployInput);
    assert.equal(receipt.candidateId, "challenger-a");
    assert.equal(receipt.liveAuthority, "NONE");
    assert.equal(opens.length, 1);
  });

  it("re-checks the stored artifact instead of trusting the request", () => {
    const enabled = (read: () => QualifiedPaperChallengerArtifact | undefined) => new PaperChallengerPolicyApproval({ artifacts: { read }, enabled: true });
    assert.throws(() => enabled(() => undefined).requireExecutableChallenger(request), /ARTIFACT_UNAVAILABLE/);
    assert.throws(() => enabled(() => artifact).requireExecutableChallenger({ ...request, familyId: "other-family" }), /STRATEGY_IDENTITY_CONFLICT/);
    assert.throws(() => enabled(() => ({ ...artifact, researchLineage: undefined })).requireExecutableChallenger(request), /LINEAGE_UNAVAILABLE/);
    assert.throws(() => enabled(() => ({ ...artifact, researchDecisionReference: "research-decision:other" })).requireExecutableChallenger(request), /LINEAGE_CONFLICT/);
    assert.throws(() => enabled(() => ({ ...artifact, liveAuthority: "FULL" } as unknown as QualifiedPaperChallengerArtifact)).requireExecutableChallenger(request), /AUTHORITY_INVALID/);
    assert.throws(() => enabled(() => artifact).requireExecutableChallenger({ ...request, evidenceFingerprintSha256: "not-a-sha" }), /REQUEST_INVALID/);
  });

  it("the runtime still refuses AI approvals and POLICY approvals outside the policy namespace", () => {
    const withApproval = (approval: { actorType: string; approvalReference?: string }) => ({
      requireExecutableChallenger: (r: typeof request) => ({ strategyId: "s", ...r, lifecycle: "CHALLENGER", approval: { approvalReference: "policy:x", approvedAt: 1, decisionFingerprint: "d".repeat(64), ...approval } }),
    });
    for (const approval of [{ actorType: "AI" }, { actorType: "HYBRID" }, { actorType: "POLICY", approvalReference: "owner:x" }]) {
      const opens: unknown[] = [];
      assert.throws(() => runtimeWith(withApproval(approval), opens).deploy(deployInput), /PAPER_CHALLENGER_GOVERNANCE_APPROVAL_INVALID/);
      assert.equal(opens.length, 0);
    }
  });
});
