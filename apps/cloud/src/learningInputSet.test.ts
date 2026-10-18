import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LearningInputSetError,
  assertLearningInputSet,
  buildLearningInputSet,
  learningCycleId,
  learningInputSetFingerprint,
  learningInputSetPeriodReferences,
  type LearningInputSetInput,
} from "./learningInputSet";

// A2. The Learning Decision may not consume an arbitrary query result, so the evidence it may
// consider is fixed first as a deterministic identity. These tests pin the properties that make
// that identity trustworthy: canonical regardless of supply order, fail-closed on anything that
// would let a decision read its own future or overstate its evidence, and identical across a
// replay. Exactly-once downstream is a property of this identity, not of a counter.

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};

const input = (overrides: Partial<LearningInputSetInput> = {}): LearningInputSetInput => ({
  cutoffTimestamp: 1_000,
  researchEvidence: [
    { recordId: "trial-b", recordedAt: 200 },
    { recordId: "trial-a", recordedAt: 100 },
  ],
  paperEvidence: [{ recordId: "period-1", recordedAt: 300 }],
  policies: POLICIES,
  metaPartitionIdentity: "meta-train",
  ...overrides,
});

describe("A2 learning input set canonicalization", () => {
  it("fingerprints identically regardless of the order evidence was supplied in", () => {
    const forward = buildLearningInputSet(input());
    const shuffled = buildLearningInputSet(input({
      researchEvidence: [
        { recordId: "trial-a", recordedAt: 100 },
        { recordId: "trial-b", recordedAt: 200 },
      ],
    }));
    assert.deepEqual([...forward.researchEvidenceRecordIds], ["trial-a", "trial-b"], "record ids are canonically sorted, not supply ordered");
  assert.deepEqual([...forward.researchEvidenceObservedAt], [100, 200]);
    assert.equal(learningInputSetFingerprint(forward), learningInputSetFingerprint(shuffled));
    assert.equal(learningCycleId(forward), learningCycleId(shuffled));
  });

  it("yields one identity for the same evidence and a different one for any change", () => {
    const baseline = learningInputSetFingerprint(buildLearningInputSet(input()));
    const variants = [
      buildLearningInputSet(input({ cutoffTimestamp: 999 })),
      buildLearningInputSet(input({ metaPartitionIdentity: "meta-validation" })),
      buildLearningInputSet(input({ policies: { ...POLICIES, learningPolicyVersion: "learn-v2" } })),
      buildLearningInputSet(input({ policies: { ...POLICIES, researchPolicyVersion: "research-v2" } })),
      buildLearningInputSet(input({ policies: { ...POLICIES, riskPolicyVersion: "risk-v2" } })),
      buildLearningInputSet(input({ policies: { ...POLICIES, governancePolicyVersion: "gov-v2" } })),
      buildLearningInputSet(input({ paperEvidence: [{ recordId: "period-1", recordedAt: 301 }] })),
      buildLearningInputSet(input({ paperEvidence: [] })),
    ];
    for (const variant of variants) assert.notEqual(learningInputSetFingerprint(variant), baseline, "every policy and every piece of evidence is covered by the identity");
  });

  it("keeps the two lanes separate, each with its own digest", () => {
    const set = buildLearningInputSet(input());
    assert.deepEqual([...set.researchEvidenceRecordIds], ["trial-a", "trial-b"]);
    assert.deepEqual([...set.paperEvidenceRecordIds], ["period-1"]);
    assert.notEqual(set.researchLaneDigest, set.performanceLaneDigest);
    assert.match(set.researchLaneDigest, /^[a-f0-9]{64}$/);
  });

  it("accepts a single populated lane while rejecting an entirely empty set", () => {
    assertLearningInputSet(buildLearningInputSet(input({ paperEvidence: [] })));
    assertLearningInputSet(buildLearningInputSet(input({ researchEvidence: [] })));
  });

  it("revalidates the meta partition identity at the persisted trust boundary", () => {
    const valid = buildLearningInputSet(input());
    for (const metaPartitionIdentity of [undefined, "not valid!"]) {
      assert.throws(
        () => assertLearningInputSet({ ...valid, metaPartitionIdentity } as never),
        (error: unknown) => error instanceof LearningInputSetError && error.code === "MALFORMED_INPUT_SET",
      );
    }
  });

  it("emits the exact paper-period references the retention guard needs", () => {
    const set = buildLearningInputSet(input({
      paperEvidence: [
        { recordId: "period-2", recordedAt: 400 },
        { recordId: "period-1", recordedAt: 300 },
      ],
    }));
    assert.deepEqual([...learningInputSetPeriodReferences(set)], ["paper-period:period-1", "paper-period:period-2"]);
  });
});

describe("A2 falsification - evidence that must be refused", () => {
  const refuses = (action: () => unknown, code: string): void => {
    assert.throws(action, (error: unknown) => error instanceof LearningInputSetError && error.code === code);
  };

  it("rejects a duplicate evidence id instead of silently de-duplicating", () => {
    refuses(() => buildLearningInputSet(input({
      researchEvidence: [
        { recordId: "trial-a", recordedAt: 100 },
        { recordId: "trial-a", recordedAt: 150 },
      ],
    })), "DUPLICATE_EVIDENCE_ID");
  });

  it("rejects evidence recorded at or after the cutoff - a decision may not read its own future", () => {
    refuses(() => buildLearningInputSet(input({ paperEvidence: [{ recordId: "period-1", recordedAt: 1_000 }] })), "PIT_VIOLATION");
    refuses(() => buildLearningInputSet(input({ paperEvidence: [{ recordId: "period-1", recordedAt: 1_001 }] })), "PIT_VIOLATION");
  });

  it("rejects malformed record ids, including ones carrying control characters", () => {
    const malformed = ["", "   ", "b".repeat(513), "id" + String.fromCharCode(0) + "id", "id" + String.fromCharCode(31) + "id"];
    for (const recordId of malformed) {
      refuses(() => buildLearningInputSet(input({ paperEvidence: [{ recordId, recordedAt: 10 }] })), "MALFORMED_RECORD_ID");
    }
  });

  it("rejects one record counted as both research and performance evidence", () => {
    refuses(() => buildLearningInputSet(input({ paperEvidence: [{ recordId: "trial-a", recordedAt: 300 }] })), "CROSS_LANE_DUPLICATE");
  });

  it("rejects an empty input set - there is nothing to learn from", () => {
    refuses(() => buildLearningInputSet(input({ researchEvidence: [], paperEvidence: [] })), "EMPTY_INPUT_SET");
  });

  it("rejects invalid policy versions, meta partition, and cutoff", () => {
    refuses(() => buildLearningInputSet(input({ policies: { learningPolicyVersion: "learn-v1" } as never })), "INVALID_POLICY_VERSION");
    refuses(() => buildLearningInputSet(input({ policies: null as never })), "INVALID_POLICY_VERSION");
    refuses(() => buildLearningInputSet(input({ researchEvidence: undefined as never })), "MALFORMED_INPUT");
    refuses(() => buildLearningInputSet(input({ paperEvidence: null as never })), "MALFORMED_INPUT");
    refuses(() => buildLearningInputSet(input({ policies: { ...POLICIES, learningPolicyVersion: "" } })), "INVALID_POLICY_VERSION");
    refuses(() => buildLearningInputSet(input({ policies: { ...POLICIES, riskPolicyVersion: "risk version with spaces" } })), "INVALID_POLICY_VERSION");
    refuses(() => buildLearningInputSet(input({ metaPartitionIdentity: "not valid!" })), "INVALID_META_PARTITION");
    refuses(() => buildLearningInputSet(input({ cutoffTimestamp: -1 })), "INVALID_CUTOFF");
    refuses(() => buildLearningInputSet(input({ cutoffTimestamp: 1.5 })), "INVALID_CUTOFF");
  });
});

describe("A2 exactly-once identity", () => {
  it("produces one identity across repeated and shuffled construction", () => {
    const identities = new Set<string>();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      identities.add(learningInputSetFingerprint(buildLearningInputSet(input())));
      identities.add(learningInputSetFingerprint(buildLearningInputSet(input({
        researchEvidence: [...input().researchEvidence].reverse(),
      }))));
    }
    assert.equal(identities.size, 1, "ten constructions, however supplied, must yield one input identity");
  });

  it("rejects a frozen input set being mutated after identity was taken", () => {
    const set = buildLearningInputSet(input());
    assert.equal(Object.isFrozen(set), true, "a learning input set is immutable once built");
    assert.throws(() => { (set as unknown as { cutoffTimestamp: number }).cutoffTimestamp = 0; }, TypeError);
    assert.equal(learningInputSetFingerprint(set), learningInputSetFingerprint(buildLearningInputSet(input())), "the identity survives an attempted mutation");
  });
});
