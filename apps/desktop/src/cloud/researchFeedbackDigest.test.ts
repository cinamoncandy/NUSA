import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildResearchFeedbackDigest, ResearchFeedbackError } from "./researchFeedbackDigest";
import { appendResearchTrial, type ResearchTrialOutcome, type ResearchTrialRecord } from "./researchTrialLedger";

let ordinal = 0;

function seal(
  records: readonly ResearchTrialRecord[],
  familyId: string,
  outcome: ResearchTrialOutcome,
  searchId = "search-1",
): readonly ResearchTrialRecord[] {
  ordinal += 1;
  return appendResearchTrial(records, {
    trialId: `trial-${ordinal}`,
    familyId,
    hypothesis: "momentum persists intraday",
    createdAt: "2026-08-26T05:00:00.000Z",
    dataset: { datasetId: "dataset-a", contentSha256: "a".repeat(64), market: "KRW-BTC", interval: "60m" },
    candidateIds: [`candidate-${ordinal}`],
    search: { searchId, attemptOrdinal: records.filter((record) => record.search.searchId === searchId).length + 1 },
    outcome,
    ...(outcome === "REJECTED" ? { rejectionReasons: ["OOS_BELOW_THRESHOLD"] } : {}),
  });
}

function ledgerOf(...outcomes: readonly (readonly [string, ResearchTrialOutcome])[]): readonly ResearchTrialRecord[] {
  let records: readonly ResearchTrialRecord[] = [];
  for (const [familyId, outcome] of outcomes) records = seal(records, familyId, outcome);
  return records;
}

describe("buildResearchFeedbackDigest", () => {
  it("counts failed and rejected trials in the denominator, so survivors cannot define the sample", () => {
    // 2 completions look good in isolation, but 6 of 8 attempts did not survive.
    const ledger = ledgerOf(
      ["momentum", "COMPLETED"], ["momentum", "COMPLETED"],
      ["momentum", "FAILED"], ["momentum", "FAILED"], ["momentum", "FAILED"],
      ["momentum", "REJECTED"], ["momentum", "REJECTED"], ["momentum", "REJECTED"],
    );
    const family = buildResearchFeedbackDigest(ledger).families[0]!;

    assert.equal(family.priorTrialCount, 8);
    assert.equal(family.completedCount, 2);
    assert.equal(family.failedCount, 3);
    assert.equal(family.rejectedCount, 3);
    assert.equal(family.failureRatio, 0.75);
    assert.ok(family.priorAdjustment < 0, "a mostly-unsuccessful search must be scored down, not up");
    assert.ok(family.reasons.includes("HISTORICAL_FAILURE_RATE_ARGUES_AGAINST_FAMILY"));
  });

  it("never lets a trial influence the prior applied to itself", () => {
    const ledger = ledgerOf(...Array.from({ length: 6 }, () => ["momentum", "COMPLETED"] as const));
    // Evaluating at sequence 1 means no record precedes it: nothing can justify itself.
    const atStart = buildResearchFeedbackDigest(ledger, { evaluatedSequence: 1 });
    assert.equal(atStart.totalPriorTrials, 0);
    assert.deepEqual(atStart.families, []);
    assert.ok(atStart.reasons.includes("NO_SEALED_PRIOR_EVIDENCE"));

    // Evaluating at sequence 4 sees exactly the 3 records sealed before it, never the 4th itself.
    const midway = buildResearchFeedbackDigest(ledger, { evaluatedSequence: 4 });
    assert.equal(midway.totalPriorTrials, 3);
    assert.equal(midway.families[0]!.priorTrialCount, 3);
  });

  it("bounds the adjustment in both directions so history cannot compound without limit", () => {
    const allGood = ledgerOf(...Array.from({ length: 40 }, () => ["momentum", "COMPLETED"] as const));
    const allBad = ledgerOf(...Array.from({ length: 40 }, () => ["momentum", "FAILED"] as const));

    const best = buildResearchFeedbackDigest(allGood).families[0]!;
    const worst = buildResearchFeedbackDigest(allBad).families[0]!;

    assert.equal(best.priorAdjustment, 0.1, "capped at the policy maximum however long the winning streak");
    assert.equal(worst.priorAdjustment, -0.1, "capped at the policy minimum however long the losing streak");
    assert.ok(best.reasons.includes("PRIOR_ADJUSTMENT_CAPPED"));
    assert.ok(worst.reasons.includes("PRIOR_PENALTY_CAPPED"));

    // A far longer winning streak must not earn any more credit than a shorter one.
    const shorter = buildResearchFeedbackDigest(ledgerOf(...Array.from({ length: 8 }, () => ["momentum", "COMPLETED"] as const))).families[0]!;
    assert.equal(best.priorAdjustment, shorter.priorAdjustment);
  });

  it("stays neutral while sealed history is too thin to conclude anything", () => {
    const family = buildResearchFeedbackDigest(ledgerOf(["momentum", "COMPLETED"], ["momentum", "COMPLETED"])).families[0]!;
    assert.equal(family.priorAdjustment, 0);
    assert.ok(family.reasons.includes("INSUFFICIENT_PRIOR_HISTORY"));
  });

  it("fails closed on rewritten history instead of deriving feedback from it", () => {
    const ledger = ledgerOf(["momentum", "FAILED"], ["momentum", "FAILED"], ["momentum", "FAILED"]);
    // Retroactively flip a failure into a completion -- exactly the rewrite that would manufacture
    // a favourable prior. The hash chain must reject it before any number is computed.
    const rewritten = ledger.map((record, index) => (index === 0 ? { ...record, outcome: "COMPLETED" as const } : record));
    assert.throws(() => buildResearchFeedbackDigest(rewritten));

    // Dropping an inconvenient failure outright must also fail closed, not silently shrink the sample.
    assert.throws(() => buildResearchFeedbackDigest(ledger.slice(1)));
  });

  it("discloses when one family dominates the evidence base rather than presenting it as broad", () => {
    const dominated = buildResearchFeedbackDigest(ledgerOf(
      ["momentum", "COMPLETED"], ["momentum", "COMPLETED"], ["momentum", "COMPLETED"],
      ["momentum", "FAILED"], ["momentum", "FAILED"], ["momentum", "FAILED"],
      ["meanreversion", "COMPLETED"],
    ));
    assert.ok(dominated.reasons.includes("EVIDENCE_BASE_DOMINATED_BY_SINGLE_FAMILY"));

    const balanced = buildResearchFeedbackDigest(ledgerOf(
      ["momentum", "COMPLETED"], ["momentum", "FAILED"], ["momentum", "COMPLETED"],
      ["meanreversion", "COMPLETED"], ["meanreversion", "FAILED"], ["meanreversion", "COMPLETED"],
    ));
    assert.equal(balanced.reasons.includes("EVIDENCE_BASE_DOMINATED_BY_SINGLE_FAMILY"), false);
  });

  it("keeps family ordering deterministic and records the ledger hash it was computed against", () => {
    const ledger = ledgerOf(
      ["zeta", "COMPLETED"], ["alpha", "COMPLETED"], ["zeta", "FAILED"], ["alpha", "FAILED"],
    );
    const digest = buildResearchFeedbackDigest(ledger);
    assert.deepEqual(digest.families.map((family) => family.familyId), ["alpha", "zeta"]);
    assert.equal(digest.ledgerTerminalHash, ledger.at(-1)!.recordHash);
    assert.equal(digest.evidenceMode, "SEALED_HISTORICAL_EVIDENCE");
  });

  it("fails closed on an invalid policy or evaluated sequence", () => {
    const ledger = ledgerOf(["momentum", "COMPLETED"]);
    for (const bad of [{ maximumAdjustment: 0 }, { maximumAdjustment: 1.5 }, { minimumPriorTrials: 0 }, { concentrationDisclosureThreshold: 0 }]) {
      assert.throws(
        () => buildResearchFeedbackDigest(ledger, { policy: bad }),
        (error) => error instanceof ResearchFeedbackError && error.code === "INVALID_POLICY",
        JSON.stringify(bad),
      );
    }
    assert.throws(
      () => buildResearchFeedbackDigest(ledger, { evaluatedSequence: 0 }),
      (error) => error instanceof ResearchFeedbackError && error.code === "INVALID_EVALUATED_SEQUENCE",
    );
  });

  it("never emits a promotion, weight, capital amount, order, or LIVE authority", () => {
    const digest = buildResearchFeedbackDigest(ledgerOf(...Array.from({ length: 6 }, () => ["momentum", "COMPLETED"] as const)));
    const serialized = JSON.stringify(digest).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "order", "broker", "withdraw", "transfer", "notional", "capitalamount", "researchweight", "promote"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.ok(digest.reasons.includes("BOUNDED_RESEARCH_PRIOR_ONLY"));
    assert.ok(digest.reasons.includes("NO_PROMOTION_AUTHORITY"));
    assert.ok(digest.reasons.includes("SEALED_HISTORY_NOT_REWRITTEN"));
  });
});
