import test from "node:test";
import assert from "node:assert/strict";
import { OWNER_BASELINE_CANDIDATE_ID } from "./ownerBaselinePaperStrategy";
import { buildOwnerBaselinePaperPeriodInput, isOwnerBaselinePeriodInput, isOwnerBaselinePeriodStartAt } from "./ownerBaselinePaperPeriod";

const COMMIT = "a".repeat(40);
const START = Date.UTC(2026, 9, 1, 0, 0, 0);

test("owner baseline opens one truthful market-bound period from the canonical account boundary", () => {
  const input = buildOwnerBaselinePaperPeriodInput({ market: "krw-btc", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT });
  assert.equal(input.market, "KRW-BTC");
  assert.equal(input.periodStartAt, START);
  assert.equal(input.candidateProvenance[0]?.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(input.advisory.entries[0]?.id, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(new Date(input.advisory.generatedAt).getTime(), START - 1);
  assert.equal(isOwnerBaselinePeriodInput(input), true);
});

test("owner baseline period identity is deterministic and market-bound", () => {
  const first = buildOwnerBaselinePaperPeriodInput({ market: "KRW-BTC", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT });
  assert.deepEqual(buildOwnerBaselinePaperPeriodInput({ market: "KRW-BTC", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT }), first);
  assert.notEqual(buildOwnerBaselinePaperPeriodInput({ market: "KRW-ETH", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT }).periodId, first.periodId);
});

test("owner baseline rejects non-Unix account timestamps before opening a period", () => {
  assert.equal(isOwnerBaselinePeriodStartAt(0), false);
  assert.equal(isOwnerBaselinePeriodStartAt(Number.NaN), false);
  assert.equal(isOwnerBaselinePeriodStartAt(START), true);
});
