import assert from "node:assert/strict";
import test from "node:test";
import { buildTodayTimeline } from "./recordsTimelineModel";

const NOW = Date.UTC(2026, 9, 15, 3, 15); // 12:15 KST
test("lists only real same-day events, newest first, in KST", () => {
  const events = buildTodayTimeline({ lastPaperDecisionAt: NOW - 60_000, windowDecisionCount: 3292, lastPaperFillAt: Date.UTC(2026, 9, 14, 15, 56), startedAt: Date.UTC(2026, 9, 15, 2, 46), lossLimit: { consecutiveLossCount: 3, maxConsecutiveLosses: 3 } }, NOW);
  assert.deepEqual(events.map((e) => e.time), ["12:14", "11:46", "00:56"]);
  assert.equal(events[0].tone, "NOW");
  assert.match(events[0].text, /3,292번째/);
  assert.match(events[2].text, /연속 손실 3\/3/);
  assert.equal(events[2].tone, "ATTENTION");
});

test("future, earlier-day, malformed or missing timestamps are dropped, never guessed", () => {
  assert.deepEqual(buildTodayTimeline(null, NOW), []);
  assert.deepEqual(buildTodayTimeline({ lastPaperDecisionAt: NOW + 1, lastPaperFillAt: Date.UTC(2026, 9, 13), startedAt: "x" }, NOW), []);
});
