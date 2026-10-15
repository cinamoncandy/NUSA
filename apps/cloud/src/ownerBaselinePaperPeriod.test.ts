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
  assert.equal(new Date(input.advisory.generatedAt).getTime(), START - 9 * 60 * 60 * 1000 - 1);
  assert.equal(isOwnerBaselinePeriodInput(input), true);
});

test("owner baseline binding uses the KST day boundary", () => {
  const input = buildOwnerBaselinePaperPeriodInput({ market: "KRW-BTC", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT });
  assert.equal(new Date(input.advisory.generatedAt).toISOString(), "2026-09-30T14:59:59.999Z");
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

test("canonical continuations retain immutable advisory and reject forged baseline metadata", () => {
  const original = buildOwnerBaselinePaperPeriodInput({ market: "KRW-XRP", periodIndex: 0, periodStartAt: START, sourceCommitSha: COMMIT });
  const periodStartAt = START + 86_400_000;
  for (const prefix of ["closed-learning-rollover", "closed-learning-mixed-binding-replaced", "closed-learning-account-replaced"]) {
    const continued = { ...original, periodIndex: 5, periodStartAt, periodId: `${prefix}:5:${periodStartAt}` };
    assert.equal(isOwnerBaselinePeriodInput(continued), true);
    for (const forged of [
      { ...continued, periodIndex: 6 },
      { ...continued, periodStartAt: periodStartAt + 1 },
      { ...continued, market: "KRW-BTC" },
      { ...continued, candidateProvenance: [{ ...original.candidateProvenance[0]!, datasetContentSha256: "f".repeat(64) }] },
      { ...continued, candidateProvenance: [{ ...original.candidateProvenance[0]!, datasetId: "forged" }] },
      { ...continued, advisory: { ...original.advisory, reasons: [] } },
      { ...continued, advisory: { ...original.advisory, generatedAt: new Date(periodStartAt + 1).toISOString() } },
      { ...continued, candidateProvenance: [...original.candidateProvenance, ...original.candidateProvenance] },
    ]) assert.equal(isOwnerBaselinePeriodInput(forged), false);
  }
  assert.equal(isOwnerBaselinePeriodInput({ periodId: "owner-baseline:fake", candidateProvenance: [{ candidateId: OWNER_BASELINE_CANDIDATE_ID }] } as never), false);
});
