import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { PaperChallengerBindingLedger } from "./paperChallengerBindingLedger";

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

function binding(overrides: Partial<PaperCandidateExecutionBinding> = {}): PaperCandidateExecutionBinding {
  return {
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId: "challenger-a-v9",
    datasetId: "dataset-a",
    datasetContentSha256: HASH_A,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: HASH_A,
    bindingFingerprintSha256: HASH_B,
    ...overrides,
  };
}

describe("PaperChallengerBindingLedger", () => {
  it("recovers one active immutable binding after restart", () => {
    const persistence = new MemoryLedger();
    const first = new PaperChallengerBindingLedger(persistence);
    first.activate("krw-btc", binding());
    assert.equal(first.read("KRW-BTC", 3_000)?.candidateId, "challenger-a-v9");

    const restarted = new PaperChallengerBindingLedger(persistence);
    const recovered = restarted.read("KRW-BTC", 3_000);
    assert.equal(recovered?.bindingFingerprintSha256, HASH_B);
    assert.equal(recovered?.liveAuthority, "NONE");
    assert.equal(recovered?.productionMutationAllowed, false);
  });

  it("revokes a failed challenger without deleting immutable activation history", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding());
    const revoked = runtime.revoke("KRW-BTC", HASH_B, "challenger-a-v9", 4_000, "RISK_BREACH");
    assert.equal(revoked.status, "REVOKED");
    assert.equal(revoked.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(runtime.read("KRW-BTC", 4_001), undefined);
    assert.equal(persistence.records.length, 2);
  });

  it("keeps the activation unavailable before its canonical period start", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding());
    assert.equal(runtime.read("KRW-BTC", 1_999), undefined);
  });

  it("rejects revocation that does not match the active candidate identity", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding());
    assert.throws(() => runtime.revoke("KRW-BTC", HASH_B, "different-candidate", 3_000, "FAILED"), /does not match/);
  });

  it("fails closed when a second challenger is activated before the first is revoked", () => {
    const persistence = new MemoryLedger();
    const runtime = new PaperChallengerBindingLedger(persistence);
    runtime.activate("KRW-BTC", binding());
    assert.throws(
      () => runtime.activate("KRW-BTC", binding({ candidateId: "challenger-b-v1", bindingFingerprintSha256: HASH_A, periodStartAt: 2_500 })),
      /multiple PAPER challengers/,
    );
  });
});
