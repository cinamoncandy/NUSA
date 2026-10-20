import assert from "node:assert/strict";
import test from "node:test";
import { TERRAIN_BUCKETS, TERRAIN_BUCKET_MS, buildDecisionTerrain, parseDecisionTrace } from "./decisionTerrainModel";

const WINDOW = Date.UTC(2026, 9, 20, 0, 0, 0); // 09:00 KST
const H = 3_600_000;
const trace = (since: number, fill: (b: number) => number, orders: (b: number) => number = () => 0) =>
  ({ since, bucketMs: TERRAIN_BUCKET_MS, decisions: Array.from({ length: TERRAIN_BUCKETS }, (_, b) => fill(b)), orders: Array.from({ length: TERRAIN_BUCKETS }, (_, b) => orders(b)) });

test("rows run from the window start to the current hour, labelled in KST", () => {
  const now = WINDOW + 4 * H + 30 * 60_000; // 13:30 KST
  const m = buildDecisionTerrain({ trace: trace(WINDOW, () => 4), now });
  assert.deepEqual(m.rows.map((r) => r.hour), [9, 10, 11, 12, 13]);
  assert.equal(m.progress, 0.5);
  assert.deepEqual(m.rows.map((r) => r.startAt), [0, 1, 2, 3, 4].map((r) => WINDOW + r * H), "each row knows when its hour starts");
  assert.ok(m.hasTrace);
  assert.equal(m.rows[0]!.values[0], 1, "heights are relative to the busiest bucket");
  assert.equal(m.rows[4]!.values[5], 1, "the bucket holding `now` is observed");
  assert.equal(m.rows[4]!.values[7], null, "the future is unobserved, not zero");
  assert.deepEqual(m.rows.map((r) => r.decisionCount), [48, 48, 48, 48, 28], "hour totals count observed buckets only (the 13:00 row stops at the bucket holding 13:30)");
  assert.deepEqual(m.rows.map((r) => r.orderCount), [0, 0, 0, 0, 0]);
  assert.equal(m.thisHour, 4 * 7, "only observed buckets of this hour count (13:00 to the bucket holding 13:30)");
});

test("buckets before a mid-day restart are null, and only the last rows are kept", () => {
  const now = WINDOW + 20 * H;
  const m = buildDecisionTerrain({ trace: trace(WINDOW + 10 * H + 7 * 60_000, (b) => b % 3), now, maxRows: 14 });
  assert.equal(m.rows.length, 14);
  assert.equal(m.rows[0]!.hour, (9 + 7) % 24);
  assert.equal(m.rows[3]!.values[0], null, "10:00 window hour, first bucket ended before the restart");
  assert.notEqual(m.rows[3]!.values[1], null, "the bucket containing the restart is observed");
});

test("orders become row positions; the loss-limit stop maps onto a visible row", () => {
  const now = WINDOW + 5 * H;
  const m = buildDecisionTerrain({ trace: trace(WINDOW, () => 2, (b) => (b === 14 ? 1 : 0)), now, limitReachedAt: WINDOW + 2 * H + 15 * 60_000 });
  assert.deepEqual(m.rows[1]!.orders, [(2 + 0.5) / 12]);
  assert.equal(m.rows[1]!.orderCount, 1);
  assert.equal(m.rows[0]!.orderCount, 0);
  assert.deepEqual(m.stop, { row: 2, at: 0.25 });
  assert.equal(buildDecisionTerrain({ trace: null, now, limitReachedAt: now + 1 }).stop, null, "a future stop is ignored");
  const late = WINDOW + 20 * H;
  assert.deepEqual(buildDecisionTerrain({ trace: null, now: late, limitReachedAt: WINDOW + H, maxRows: 4 }).stop, { row: 0, at: 0 }, "a stop before the oldest visible hour holds every visible row");
});

test("missing, malformed or other-day traces draw no terrain but keep the clock", () => {
  const now = WINDOW + 3 * H;
  for (const bad of [null, undefined, [], { ...trace(WINDOW, () => 1), bucketMs: 60_000 }, { ...trace(WINDOW, () => 1), decisions: [1] }, trace(WINDOW, (b) => (b === 3 ? -1 : 0)), trace(WINDOW - H, () => 1)]) {
    const m = buildDecisionTerrain({ trace: bad, now });
    assert.equal(m.hasTrace, false);
    assert.equal(m.thisHour, null);
    assert.ok(m.rows.every((r) => r.values.every((v) => v === null) && r.decisionCount === null && r.orderCount === null));
    assert.equal(m.rows.length, 4);
  }
  assert.equal(parseDecisionTrace(trace(WINDOW, () => 1))?.since, WINDOW);
});
