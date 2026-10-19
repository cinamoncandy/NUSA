import assert from "node:assert/strict";
import test from "node:test";
import { buildTodayTimeline } from "./recordsTimelineModel";

const NOW = Date.UTC(2026, 9, 15, 3, 15); // 12:15 KST
test("lists only real same-day events, newest first, in KST; the loss limit is its own row", () => {
  const events = buildTodayTimeline({ lastPaperDecisionAt: NOW - 60_000, lastPaperFillAt: Date.UTC(2026, 9, 14, 15, 56), startedAt: Date.UTC(2026, 9, 15, 2, 46), lossLimit: { consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: NOW - 30_000 } }, NOW);
  assert.deepEqual(events.map((e) => [e.time, e.tone]), [["12:14", "ATTENTION"], ["12:14", "NOW"], ["11:46", "MUTED"], ["00:56", "NORMAL"]]);
  assert.equal(events[0].text, "연속 손실 3/3 확인 · 새 매수 멈춤");
  assert.equal(events[3].text, "마지막 PAPER 체결", "a fill never claims to be the loss that hit the limit");
});

test("an old decision is not 'now'; a limit from another day, disabled, under the max or max 0 is not shown", () => {
  const old = buildTodayTimeline({ lastPaperDecisionAt: NOW - 3 * 60_000 }, NOW);
  assert.equal(old[0].tone, "NORMAL");
  for (const lossLimit of [{ consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: Date.UTC(2026, 9, 13) }, { consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: NOW, consecutiveLossLimitEnabled: false }, { consecutiveLossCount: 2, maxConsecutiveLosses: 3, evaluatedAt: NOW }, { consecutiveLossCount: 0, maxConsecutiveLosses: 0, evaluatedAt: NOW }]) {
    assert.deepEqual(buildTodayTimeline({ lossLimit }, NOW), [], JSON.stringify(lossLimit));
  }
});

test("future, earlier-day, malformed or missing timestamps are dropped, never guessed", () => {
  assert.deepEqual(buildTodayTimeline(null, NOW), []);
  assert.deepEqual(buildTodayTimeline({ lastPaperDecisionAt: NOW + 1, lastPaperFillAt: Date.UTC(2026, 9, 13), startedAt: "x" }, NOW), []);
});
