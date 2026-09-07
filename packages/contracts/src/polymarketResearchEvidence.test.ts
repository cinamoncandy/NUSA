import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptPolymarketResearchEvidence,
  PolymarketResearchEvidenceAdapter,
  type PolymarketDataHealth,
  type PolymarketResearchEvidenceInput,
} from "./polymarketResearchEvidence";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function validInput(): PolymarketResearchEvidenceInput {
  return {
    source: {
      sourceId: "polymarket-clob-btc-5m",
      transport: "CLOB_WS",
      health: "LIVE",
    },
    marketId: "btc-up-or-down-5m",
    eventId: "event-btc-5m",
    observedAt: 1_780_000_000_000,
    evaluationTimestamp: 1_780_000_000_500,
    staleWindowMs: 20_000,
    provenance: {
      sourceContentSha256: SHA_A,
      sourceObservedAt: 1_780_000_000_000,
      capturedAt: 1_780_000_000_100,
    },
    relevance: {
      asset: "BTC",
      ruleId: "polymarket-btc-direct-market",
      ruleVersion: "1",
      ruleHash: SHA_B,
    },
    features: {
      freshWalletScore: 0.82,
      abnormalSizeZScore: 3.4,
      coordinatedClusterScore: 0.67,
    },
  };
}

test("valid fresh LIVE observation becomes immutable research-only evidence with zero execution authority", () => {
  const evidence = PolymarketResearchEvidenceAdapter.adapt(validInput());

  assert.equal(evidence.eligibility, "ELIGIBLE");
  assert.deepEqual(evidence.reasonCodes, []);
  assert.equal(evidence.researchOnly, true);
  assert.equal(evidence.authority, "PAPER_ONLY");
  assert.equal(evidence.liveAuthority, "NONE");
  assert.equal(evidence.productionMutationAllowed, false);
  assert.equal(evidence.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(evidence.orderExecutionAllowed, false);
  assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.source), true);
  assert.equal(Object.isFrozen(evidence.provenance), true);
  assert.equal(Object.isFrozen(evidence.relevance), true);
  assert.equal(Object.isFrozen(evidence.features), true);
  assert.equal(Object.isFrozen(evidence.reasonCodes), true);

  assert.equal("signal" in evidence, false);
  assert.equal("side" in evidence, false);
  assert.equal("order" in evidence, false);
});

test("canonical evidence hash is independent of feature insertion order", () => {
  const first = validInput();
  const second: PolymarketResearchEvidenceInput = {
    ...validInput(),
    features: {
      coordinatedClusterScore: 0.67,
      abnormalSizeZScore: 3.4,
      freshWalletScore: 0.82,
    },
  };

  const firstEvidence = adaptPolymarketResearchEvidence(first);
  const secondEvidence = adaptPolymarketResearchEvidence(second);
  assert.deepEqual(firstEvidence.features, secondEvidence.features);
  assert.equal(firstEvidence.evidenceHash, secondEvidence.evidenceHash);
});

for (const health of ["LAGGED", "STALE", "FALLBACK", "OUTAGE"] as const satisfies readonly PolymarketDataHealth[]) {
  test(`${health} source is fail-closed as INSUFFICIENT`, () => {
    const input = validInput();
    const evidence = adaptPolymarketResearchEvidence({
      ...input,
      source: { ...input.source, health },
    });

    assert.equal(evidence.eligibility, "INSUFFICIENT");
    assert.ok(evidence.reasonCodes.includes(`DATA_HEALTH_${health}`));
    assert.equal(evidence.orderExecutionAllowed, false);
    assert.equal(evidence.liveAuthority, "NONE");
  });
}

test("future and stale observations cannot become eligible", () => {
  const future = validInput();
  const futureEvidence = adaptPolymarketResearchEvidence({
    ...future,
    observedAt: future.evaluationTimestamp + 1,
    provenance: {
      ...future.provenance,
      sourceObservedAt: future.evaluationTimestamp + 1,
      capturedAt: future.evaluationTimestamp + 1,
    },
  });
  assert.equal(futureEvidence.eligibility, "INSUFFICIENT");
  assert.ok(futureEvidence.reasonCodes.includes("OBSERVATION_IN_FUTURE"));
  assert.ok(futureEvidence.reasonCodes.includes("INVALID_CAPTURE_TIME"));

  const stale = validInput();
  const staleEvidence = adaptPolymarketResearchEvidence({
    ...stale,
    observedAt: stale.evaluationTimestamp - stale.staleWindowMs - 1,
    provenance: {
      ...stale.provenance,
      sourceObservedAt: stale.evaluationTimestamp - stale.staleWindowMs - 1,
      capturedAt: stale.evaluationTimestamp - stale.staleWindowMs,
    },
  });
  assert.equal(staleEvidence.eligibility, "INSUFFICIENT");
  assert.ok(staleEvidence.reasonCodes.includes("OBSERVATION_STALE"));
});

test("invalid provenance and mismatched point-in-time identity are fail-closed", () => {
  const input = validInput();
  const evidence = adaptPolymarketResearchEvidence({
    ...input,
    provenance: {
      sourceContentSha256: "not-a-sha256",
      sourceObservedAt: input.observedAt - 1,
      capturedAt: input.observedAt,
    },
  });

  assert.equal(evidence.eligibility, "INSUFFICIENT");
  assert.ok(evidence.reasonCodes.includes("INVALID_PROVENANCE_HASH"));
  assert.ok(evidence.reasonCodes.includes("PROVENANCE_TIME_MISMATCH"));
});

test("explicit asset relevance is mandatory and must be hash-bound", () => {
  const missing = validInput();
  const missingEvidence = adaptPolymarketResearchEvidence({ ...missing, relevance: undefined });
  assert.equal(missingEvidence.eligibility, "INSUFFICIENT");
  assert.ok(missingEvidence.reasonCodes.includes("MISSING_RELEVANCE"));

  const invalid = validInput();
  const invalidEvidence = adaptPolymarketResearchEvidence({
    ...invalid,
    relevance: {
      asset: " ",
      ruleId: "direct-market",
      ruleVersion: "1",
      ruleHash: "bad-hash",
    },
  });
  assert.equal(invalidEvidence.eligibility, "INSUFFICIENT");
  assert.ok(invalidEvidence.reasonCodes.includes("INVALID_RELEVANCE"));
  assert.ok(invalidEvidence.reasonCodes.includes("INVALID_RELEVANCE_HASH"));
});

test("non-finite feature values are represented safely and never become eligible", () => {
  const input = validInput();
  const evidence = adaptPolymarketResearchEvidence({
    ...input,
    features: {
      valid: 0.5,
      invalid: Number.NaN,
    },
  });

  assert.equal(evidence.eligibility, "INSUFFICIENT");
  assert.equal(evidence.features.invalid, null);
  assert.ok(evidence.reasonCodes.includes("INVALID_FEATURE_VALUE"));
  assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/);
});
