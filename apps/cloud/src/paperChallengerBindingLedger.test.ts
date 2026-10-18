import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";
import { paperChallengerPolicyIdentity } from "./paperChallengerPolicyIdentity";
import type { PaperResearchLineage } from "./paperResearchLineage";

type RecordValue = Parameters<SqliteEvolutionLearningLedger["append"]>[0];

class MemoryLedger {
  public readonly records: RecordValue[] = [];
  public append(record: RecordValue): RecordValue {
    const existing = this.records.find((item) => item.opportunityId === record.opportunityId);
    if (existing != null) {
      assert.deepEqual(existing, record);
      return existing;
    }
    this.records.push(Object.freeze(record));
    return record;
  }
  public list(): readonly RecordValue[] { return this.records; }
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const lineage: PaperResearchLineage = Object.freeze({
  schemaVersion: 1,
  candidateId: "challenger-a-v9",
  candidateVersion: "e".repeat(64),
  originalRunFingerprintSha256: "c".repeat(64),
  replayRunFingerprintSha256: "d".repeat(64),
  researchDecisionReference: "research-decision:1",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

function binding(overrides: Partial<PaperCandidateExecutionBinding> = {}): PaperCandidateExecutionBinding {
  const candidateId = overrides.candidateId ?? "challenger-a-v9";
  return {
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId,
    datasetId: "dataset-a",
    datasetContentSha256: HASH_A,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: HASH_A,
    bindingFingerprintSha256: HASH_B,
    candidateStrategy: {
      candidateId, familyId: "sma-crossover", lineageId: "lineage-a", specificationHash: "e".repeat(64),
      codeSha: "f".repeat(40), costModelVersion: "cost-v1", parameters: { shortPeriod: 2, longPeriod: 5 },
    },
    ...overrides,
  };
}

function governance(value: PaperCandidateExecutionBinding = binding()) {
  return {
    strategyId: "strategy-a", candidateId: value.candidateId, candidateVersion: value.candidateStrategy!.specificationHash,
    familyId: value.candidateStrategy!.familyId, evidenceFingerprintSha256: value.bindingFingerprintSha256, lifecycle: "CHALLENGER" as const,
    approval: { actorType: "HUMAN" as const, approvalReference: "owner:paper-challenger", approvedAt: 1, decisionFingerprint: "d".repeat(64) },
  };
}

describe("PaperChallengerBindingLedger", () => {
  it("recovers one active immutable binding and exact Research lineage after restart", () => {
    const persistence = new MemoryLedger();
    const first = new PaperChallengerBindingLedger(persistence);
    first.activate("krw-btc", binding(), lineage, governance());
    assert.equal(first.read("KRW-BTC", 3_000)?.candidateId, "challenger-a-v9");

    const restarted = new PaperChallengerBindingLedger(persistence);
    const recovered = restarted.current("KRW-BTC", 3_000);
    assert.equal(recovered?.binding.bindingFingerprintSha256, HASH_B);
    assert.equal(recovered?.binding.liveAuthority, "NONE");
    assert.equal(recovered?.binding.productionMutationAllowed, false);
    assert.deepEqual(recovered?.researchLineage, lineage);
    assert.deepEqual(recovered?.governanceAuthorization, governance());
    assert.deepEqual(restarted.lineage("KRW-BTC", 3_000), lineage);
  });

  it("keeps legacy lineage-free activation history readable", () => {
    const persistence = new MemoryLedger();
    const legacyBinding = binding();
    persistence.append({ opportunityId: "paper-challenger:KRW-BTC:legacy:active", problem: "NUSA PAPER challenger binding lifecycle", evidenceReferences: [], hypothesis: JSON.stringify({ schemaVersion: 1, status: "ACTIVE", market: "KRW-BTC", binding: legacyBinding, activatedAt: legacyBinding.periodStartAt, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), changeReference: `candidate:${legacyBinding.candidateId}`, validationStatus: "ACTIVE", outcome: "SUCCESS", failureReason: null, rollbackReference: null, reusable: true, recordedAt: new Date(legacyBinding.periodStartAt).toISOString() });
    const restarted = new PaperChallengerBindingLedger(persistence);
    assert.equal(restarted.read("KRW-BTC", 3_000)?.candidateId, "challenger-a-v9");
    assert.equal(restarted.lineage("KRW-BTC", 3_000), undefined);
    assert.equal(restarted.current("KRW-BTC", 3_000)?.governanceAuthorization, undefined);
  });

  it("keeps legacy lineage activation without candidate strategy readable but ungoverned", () => {
    const persistence = new MemoryLedger();
    const { candidateStrategy: legacyCandidateStrategy, ...legacyBinding } = binding();
    void legacyCandidateStrategy;
    persistence.append({ opportunityId: "paper-challenger:KRW-BTC:legacy-lineage:active", problem: "NUSA PAPER challenger binding lifecycle", evidenceReferences: [], hypothesis: JSON.stringify({ schemaVersion: 1, status: "ACTIVE", market: "KRW-BTC", binding: legacyBinding, activatedAt: legacyBinding.periodStartAt, researchLineage: lineage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }), changeReference: "candidate:" + legacyBinding.candidateId, validationStatus: "ACTIVE", outcome: "SUCCESS", failureReason: null, rollbackReference: null, reusable: true, recordedAt: new Date(legacyBinding.periodStartAt).toISOString() });
    const restarted = new PaperChallengerBindingLedger(persistence);
    assert.equal(restarted.read("KRW-BTC", 3_000)?.candidateId, "challenger-a-v9");
    assert.deepEqual(restarted.lineage("KRW-BTC", 3_000), lineage);
    assert.equal(restarted.current("KRW-BTC", 3_000)?.governanceAuthorization, undefined);
  });

  it("rejects lineage for a different candidate", () => {
    const runtime = new PaperChallengerBindingLedger(new MemoryLedger());
    assert.throws(() => runtime.activate("KRW-BTC", binding(), Object.freeze({ ...lineage, candidateId: "different" }), governance()), /lineage candidate conflict/);
  });

  it("rejects Research lineage candidate-version mismatch both before persistence and on replay", () => {
    const mismatchedLineage = Object.freeze({ ...lineage, candidateVersion: "f".repeat(64) });
    const policy = paperChallengerPolicyIdentity({ candidateId: binding().candidateId, candidateVersion: binding().candidateStrategy!.specificationHash, familyId: binding().candidateStrategy!.familyId, evidenceFingerprintSha256: binding().bindingFingerprintSha256, replayRunFingerprintSha256: lineage.replayRunFingerprintSha256, researchDecisionReference: lineage.researchDecisionReference });
    const authorization = { ...governance(), approval: { actorType: "POLICY" as const, approvalReference: policy.approvalReference, approvedAt: 1, decisionFingerprint: policy.decisionFingerprint } };
    const persistence = new MemoryLedger();
    assert.throws(() => new PaperChallengerBindingLedger(persistence).activate("KRW-BTC", binding(), mismatchedLineage, authorization), /lineage candidate conflict/);
    assert.equal(persistence.records.length, 0);

    new PaperChallengerBindingLedger(persistence).activate("KRW-BTC", binding(), lineage, authorization);
    const stored = persistence.records[0]!;
    const receipt = JSON.parse(stored.hypothesis) as Record<string, any>;
    persistence.records[0] = Object.freeze({ ...stored, hypothesis: JSON.stringify({ ...receipt, researchLineage: mismatchedLineage }) });
    assert.throws(() => new PaperChallengerBindingLedger(persistence).current("KRW-BTC", 3_000), /lineage candidate conflict/);
  });

  it("revokes a failed challenger without deleting immutable activation history", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding(), lineage, governance());
    const revoked = runtime.revoke("KRW-BTC", HASH_B, "challenger-a-v9", 4_000, "RISK_BREACH");
    assert.equal(revoked.status, "REVOKED");
    assert.equal(revoked.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(runtime.read("KRW-BTC", 4_001), undefined);
    assert.equal(persistence.records.length, 2);
  });

  it("keeps the activation unavailable before its canonical period start", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding(), lineage, governance());
    assert.equal(runtime.read("KRW-BTC", 1_999), undefined);
  });

  it("rejects revocation that does not match the active candidate identity", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding(), lineage, governance());
    assert.throws(() => runtime.revoke("KRW-BTC", HASH_B, "different-candidate", 3_000, "FAILED"), /does not match/);
  });

  it("fails closed when a second challenger is activated before the first is revoked", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding(), lineage, governance());
    const second = binding({ candidateId: "challenger-b-v1", bindingFingerprintSha256: HASH_A, periodStartAt: 2_500 });
    assert.throws(
      () => runtime.activate("KRW-BTC", second, undefined, governance(second)),
      /multiple PAPER challengers/,
    );
  });

  it("rejects new activations whose Governance evidence does not bind the exact PAPER candidate", () => {
    const runtime = new PaperChallengerBindingLedger(new MemoryLedger());
    assert.throws(() => runtime.activate("KRW-BTC", binding(), lineage, { ...governance(), evidenceFingerprintSha256: HASH_A }), /Governance authorization does not bind/);
    assert.throws(() => runtime.activate("KRW-BTC", binding(), lineage, { ...governance(), approval: { ...governance().approval, approvedAt: 2_001 } }), /Governance authorization does not bind/);
  });

  it("detects persisted Governance authorization tampering on restart", () => {
    const persistence = new MemoryLedger();
    new PaperChallengerBindingLedger(persistence).activate("KRW-BTC", binding(), lineage, governance());
    const stored = persistence.records[0]!;
    const receipt = JSON.parse(stored.hypothesis) as Record<string, unknown>;
    persistence.records[0] = Object.freeze({ ...stored, hypothesis: JSON.stringify({ ...receipt, governanceAuthorization: { ...governance(), candidateId: "forged" } }) });
    assert.throws(() => new PaperChallengerBindingLedger(persistence).current("KRW-BTC", 3_000), /Governance authorization does not bind/);
  });

  it("recomputes deterministic policy approval identity from immutable Research lineage", () => {
    const policy = paperChallengerPolicyIdentity({ candidateId: binding().candidateId, candidateVersion: binding().candidateStrategy!.specificationHash, familyId: binding().candidateStrategy!.familyId, evidenceFingerprintSha256: binding().bindingFingerprintSha256, replayRunFingerprintSha256: lineage.replayRunFingerprintSha256, researchDecisionReference: lineage.researchDecisionReference });
    const authorization = { ...governance(), approval: { actorType: "POLICY" as const, approvalReference: policy.approvalReference, approvedAt: 1, decisionFingerprint: policy.decisionFingerprint } };
    const persistence = new MemoryLedger();
    new PaperChallengerBindingLedger(persistence).activate("KRW-BTC", binding(), lineage, authorization);
    const record = persistence.records[0]!;
    const receipt = JSON.parse(record.hypothesis) as Record<string, any>;
    persistence.records[0] = Object.freeze({ ...record, hypothesis: JSON.stringify({ ...receipt, governanceAuthorization: { ...authorization, approval: { ...authorization.approval, decisionFingerprint: "a".repeat(64) } } }) });
    assert.throws(() => new PaperChallengerBindingLedger(persistence).current("KRW-BTC", 3_000), /Governance authorization does not bind/);
  });
});
