import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "./paperRealizedPeriodProducer";
import { OWNER_BASELINE_CANDIDATE_ID } from "./ownerBaselinePaperStrategy";
import { buildOwnerBaselinePaperPeriodInput, isOwnerBaselinePeriodInput } from "./ownerBaselinePaperPeriod";

const COMMIT = "a".repeat(40);
const START = Date.UTC(2026, 9, 1, 0, 0, 0);

test("owner baseline opens one truthful market-bound period from the canonical account boundary", () => {
  const input = buildOwnerBaselinePaperPeriodInput({ market: "krw-btc", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT });
  const plan = validatePlan({ ...input, schemaVersion: 1, observationIds: [], observations: [] });
  assert.equal(plan.market, "KRW-BTC");
  assert.equal(plan.periodStartAt, START);
  assert.equal(plan.candidateProvenance[0]?.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(plan.advisory.entries[0]?.id, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(new Date(plan.advisory.generatedAt).getTime(), START - 1);
  assert.equal(isOwnerBaselinePeriodInput(input), true);
});

test("owner baseline period identity is deterministic and market-bound", () => {
  const first = buildOwnerBaselinePaperPeriodInput({ market: "KRW-BTC", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT });
  assert.deepEqual(buildOwnerBaselinePaperPeriodInput({ market: "KRW-BTC", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT }), first);
  assert.notEqual(buildOwnerBaselinePaperPeriodInput({ market: "KRW-ETH", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT }).periodId, first.periodId);
});
