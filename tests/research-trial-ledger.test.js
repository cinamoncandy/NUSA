"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ResearchTrialLedgerError,
  appendResearchTrial,
  appendResearchTrialIdempotent,
  parseResearchTrialLedger,
  serializeResearchTrialLedger,
  summarizeResearchTrialLedger,
  verifyResearchTrialLedger
} = require("../dist/apps/desktop/src/cloud/researchTrialLedger.js");

const DATASET_HASH = "a".repeat(64);

function trial(overrides = {}) {
  return {
    trialId: "trial-1",
    familyId: "sma-family",
    hypothesis: "short momentum persists after costs",
    createdAt: "2026-08-25T00:00:00.000Z",
    dataset: {
      datasetId: "dataset-1",
      contentSha256: DATASET_HASH,
      market: "KRW-BTC",
      interval: "1d"
    },
    candidateIds: ["sma-5-20", "sma-8-20"],
    search: { searchId: "search-1", attemptOrdinal: 1 },
    outcome: "COMPLETED",
    score: 0.42,
    metrics: { totalReturn: 0.1, maxDrawdown: 0.05 },
    tags: ["baseline", "momentum"],
    ...overrides
  };
}

test("trial ledger creates deterministic tamper-evident records", () => {
  const first = appendResearchTrial([], trial());
  const second = appendResearchTrial(first, trial({
    trialId: "trial-2",
    parentTrialId: "trial-1",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    outcome: "REJECTED",
    score: undefined,
    metrics: undefined,
    rejectionReasons: ["MAX_DRAWDOWN_EXCEEDED"],
    candidateIds: ["sma-3-15"]
  }));

  assert.equal(second.length, 2);
  assert.equal(second[0].sequence, 1);
  assert.equal(second[1].sequence, 2);
  assert.equal(second[1].previousRecordHash, second[0].recordHash);
  assert.match(second[0].recordHash, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => verifyResearchTrialLedger(second));

  const recreated = appendResearchTrial([], trial());
  assert.equal(recreated[0].recordHash, first[0].recordHash);
});

test("exact trial replay is idempotent and does not double count evidence", () => {
  const ledger = appendResearchTrialIdempotent([], trial({ candidateIds: ["sma-8-20", "sma-5-20"] }));
  const replayed = appendResearchTrialIdempotent(ledger, trial({
    candidateIds: ["sma-5-20", "sma-8-20"],
    tags: ["momentum", "baseline"]
  }));

  assert.strictEqual(replayed, ledger);
  assert.equal(replayed.length, 1);
  assert.equal(summarizeResearchTrialLedger(replayed).trialCount, 1);
  assert.equal(replayed[0].recordHash, ledger[0].recordHash);
});

test("trial replay fails closed when persisted evidence drifts", () => {
  const ledger = appendResearchTrialIdempotent([], trial());

  assert.throws(
    () => appendResearchTrialIdempotent(ledger, trial({ score: 0.99 })),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "REPLAY_EVIDENCE_MISMATCH"
  );
  assert.throws(
    () => appendResearchTrialIdempotent(ledger, trial({ dataset: { ...trial().dataset, contentSha256: "b".repeat(64) } })),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "REPLAY_EVIDENCE_MISMATCH"
  );
});

test("trial ledger counts failed and rejected attempts instead of hiding search failures", () => {
  let ledger = appendResearchTrial([], trial());
  ledger = appendResearchTrial(ledger, trial({
    trialId: "trial-2",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    outcome: "FAILED",
    score: undefined,
    metrics: undefined,
    candidateIds: ["sma-10-30"]
  }));
  ledger = appendResearchTrial(ledger, trial({
    trialId: "trial-3",
    familyId: "breakout-family",
    search: { searchId: "search-2", attemptOrdinal: 1 },
    outcome: "REJECTED",
    score: undefined,
    metrics: undefined,
    rejectionReasons: ["INSUFFICIENT_OOS_EVIDENCE"],
    candidateIds: ["breakout-20"]
  }));

  const summary = summarizeResearchTrialLedger(ledger);
  assert.deepEqual(summary, {
    trialCount: 3,
    completedCount: 1,
    failedCount: 1,
    rejectedCount: 1,
    abstainedCount: 0,
    distinctSearchCount: 2,
    distinctFamilyCount: 2,
    maximumSearchAttemptOrdinal: 2,
    terminalRecordHash: ledger[2].recordHash
  });
});

test("trial ledger rejects duplicate ids, ordinal gaps and unknown parents", () => {
  const ledger = appendResearchTrial([], trial());

  assert.throws(
    () => appendResearchTrial(ledger, trial()),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "DUPLICATE_TRIAL_ID"
  );

  assert.throws(
    () => appendResearchTrial(ledger, trial({ trialId: "trial-gap", search: { searchId: "search-1", attemptOrdinal: 3 } })),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "NON_CONTIGUOUS_SEARCH_ATTEMPT"
  );

  assert.throws(
    () => appendResearchTrial(ledger, trial({ trialId: "trial-child", parentTrialId: "missing", search: { searchId: "search-2", attemptOrdinal: 1 } })),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "UNKNOWN_PARENT_TRIAL"
  );
});

test("trial ledger detects content tampering and broken hash chains", () => {
  let ledger = appendResearchTrial([], trial());
  ledger = appendResearchTrial(ledger, trial({
    trialId: "trial-2",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    candidateIds: ["sma-3-15"]
  }));

  const tampered = ledger.map((record) => ({ ...record }));
  tampered[0] = { ...tampered[0], hypothesis: "rewritten after seeing the result" };
  assert.throws(
    () => verifyResearchTrialLedger(tampered),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "RECORD_HASH_MISMATCH"
  );

  const broken = ledger.map((record) => ({ ...record }));
  broken[1] = { ...broken[1], previousRecordHash: "f".repeat(64) };
  assert.throws(
    () => verifyResearchTrialLedger(broken),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "BROKEN_HASH_CHAIN"
  );
});

test("trial ledger JSONL round trip preserves verified evidence", () => {
  let ledger = appendResearchTrial([], trial({ candidateIds: ["z", "a"] }));
  ledger = appendResearchTrial(ledger, trial({
    trialId: "trial-2",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    candidateIds: ["c"],
    tags: ["second"]
  }));

  const serialized = serializeResearchTrialLedger(ledger);
  const parsed = parseResearchTrialLedger(serialized);
  assert.deepEqual(parsed, ledger);
  assert.equal(parsed[0].candidateIds.join(","), "a,z");
});

test("rejected trials require explicit rejection reasons", () => {
  assert.throws(
    () => appendResearchTrial([], trial({ outcome: "REJECTED", score: undefined, metrics: undefined })),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "MISSING_REJECTION_REASON"
  );
});

test("abstained trials require reasons and remain in the immutable denominator", () => {
  let ledger = appendResearchTrial([], trial({ outcome: "ABSTAINED", score: undefined, metrics: undefined, abstentionReasons: ["INSUFFICIENT_CONFIDENCE"] }));
  ledger = appendResearchTrial(ledger, trial({
    trialId: "trial-2",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    outcome: "COMPLETED"
  }));
  const summary = summarizeResearchTrialLedger(ledger);
  assert.equal(summary.abstainedCount, 1);
  assert.equal(summary.trialCount, 2);
  assert.throws(
    () => appendResearchTrial([], trial({ outcome: "ABSTAINED", score: undefined, metrics: undefined })),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "MISSING_ABSTENTION_REASON"
  );
});
