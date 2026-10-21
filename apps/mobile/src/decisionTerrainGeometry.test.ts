import assert from "node:assert/strict";
import test from "node:test";
import { easeOutCubic, smoothTerrainRow } from "./decisionTerrainGeometry";

test("row smoothing passes through the bucket heights and flags unobserved stretches", () => {
  const row = smoothTerrainRow([0, 1, 0, null, null, null, null, null, null, null, null, null], 12);
  assert.equal(row.length, 12);
  assert.ok(Math.abs(row[1]!.h - 1) < 1e-9 && row[0]!.h === 0);
  assert.equal(row[1]!.seen, true);
  assert.equal(row[6]!.seen, false);
  assert.ok(row.every((p) => p.h >= 0));
  assert.equal(smoothTerrainRow([], 5).length, 5);
});

test("the entrance easing runs 0 to 1 and clamps outside that range", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-3), 0);
  assert.equal(easeOutCubic(5), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, "it starts fast");
});
