"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ResearchTrialLedgerError,
  appendResearchTrial,
} = require("../dist/apps/desktop/src/cloud/researchTrialLedger.js");
const {
  createResearchTrialLedgerCheckpoint,
  verifyResearchTrialLedgerExtendsCheckpoint,
} = require("../dist/apps/desktop/src/cloud/researchTrialLedgerContinuity.js");

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
      interval: "1d",
    },
    candidateIds: ["sma-5-20"],
    search: { searchId: "search-1", attemptOrdinal: 1 },
    outcome: "COMPLETED",
    score: 0.42,
    metrics: { totalReturn: 0.1 },
    ...overrides,
  };
}

function twoRecordLedger() {
  let ledger = appendResearchTrial([], trial());
  ledger = appendResearchTrial(ledger, trial({
    trialId: "trial-2",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    outcome: "FAILED",
    score: undefined,
    metrics: undefined,
    candidateIds: ["sma-8-20"],
  }));
  return ledger;
}

test("checkpointed trial history may only grow by preserving the exact evidence prefix", () => {
  const ledger = twoRecordLedger();
  const checkpoint = createResearchTrialLedgerCheckpoint(ledger);
  const extended = appendResearchTrial(ledger, trial({
    trialId: "trial-3",
    search: { searchId: "search-1", attemptOrdinal: 3 },
    outcome: "REJECTED",
    score: undefined,
    metrics: undefined,
    rejectionReasons: ["INSUFFICIENT_OOS_EVIDENCE"],
    candidateIds: ["sma-13-34"],
  }));

  assert.deepEqual(checkpoint, {
    schemaVersion: 1,
    trialCount: 2,
    terminalRecordHash: ledger[1].recordHash,
  });
  assert.doesNotThrow(() => verifyResearchTrialLedgerExtendsCheckpoint(extended, checkpoint));
});

test("checkpoint rejects favorable-result-only history truncation", () => {
  const ledger = twoRecordLedger();
  const checkpoint = createResearchTrialLedgerCheckpoint(ledger);

  assert.throws(
    () => verifyResearchTrialLedgerExtendsCheckpoint(ledger.slice(0, 1), checkpoint),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "LEDGER_HISTORY_TRUNCATED",
  );
});

test("checkpoint rejects a valid but rewritten evidence prefix", () => {
  const original = twoRecordLedger();
  const checkpoint = createResearchTrialLedgerCheckpoint(original);
  let rewritten = appendResearchTrial([], trial({ score: 0.99 }));
  rewritten = appendResearchTrial(rewritten, trial({
    trialId: "trial-2",
    search: { searchId: "search-1", attemptOrdinal: 2 },
    outcome: "FAILED",
    score: undefined,
    metrics: undefined,
    candidateIds: ["sma-8-20"],
  }));

  assert.doesNotThrow(() => require("../dist/apps/desktop/src/cloud/researchTrialLedger.js").verifyResearchTrialLedger(rewritten));
  assert.throws(
    () => verifyResearchTrialLedgerExtendsCheckpoint(rewritten, checkpoint),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "LEDGER_HISTORY_DIVERGED",
  );
});

test("checkpoint validation fails closed on malformed checkpoint evidence", () => {
  const ledger = twoRecordLedger();
  const checkpoint = createResearchTrialLedgerCheckpoint(ledger);

  assert.throws(
    () => verifyResearchTrialLedgerExtendsCheckpoint(ledger, { ...checkpoint, trialCount: -1 }),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "INVALID_LEDGER_CHECKPOINT",
  );
  assert.throws(
    () => verifyResearchTrialLedgerExtendsCheckpoint(ledger, { ...checkpoint, terminalRecordHash: "ABC" }),
    (error) => error instanceof ResearchTrialLedgerError && error.code === "INVALID_LEDGER_CHECKPOINT",
  );
});
