import assert from "node:assert/strict";
import test from "node:test";
import { easeOutBack, projectTerrain, smoothTerrainRow, terrainCamera, terrainRowZ } from "./decisionTerrainGeometry";

test("the entrance starts top-down and ends tilted; far rows sit higher on screen than near rows", () => {
  const flat = terrainCamera(400, 380, -0.3, 0), tilted = terrainCamera(400, 380, -0.3, 1);
  assert.ok(Math.abs(flat.pitch - Math.PI / 2) < 1e-9 && flat.yaw === 0);
  assert.ok(Math.abs(tilted.pitch - 0.5) < 1e-9 && tilted.yaw === -0.3);
  const near = projectTerrain(0, 0, 0, tilted), far = projectTerrain(0, 0, 2, tilted);
  assert.ok(far.y < near.y, "further into the screen is higher up");
  const low = projectTerrain(0, 0, 1, tilted), high = projectTerrain(0, 0.5, 1, tilted);
  assert.ok(high.y < low.y, "taller is higher up");
  for (const p of [near, far, low, high]) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("rows step back by a fixed depth and slide forward while a new hour arrives", () => {
  assert.equal(terrainRowZ(4, 5), 0);
  assert.ok(Math.abs(terrainRowZ(0, 5) - 0.8) < 1e-9);
  assert.ok(terrainRowZ(4, 5, 1) < 0);
});

test("row smoothing passes through the bucket heights and flags unobserved stretches", () => {
  const row = smoothTerrainRow([0, 1, 0, null, null, null, null, null, null, null, null, null], 12);
  assert.equal(row.length, 12);
  assert.ok(Math.abs(row[1]!.h - 1) < 1e-9 && row[0]!.h === 0);
  assert.equal(row[1]!.seen, true);
  assert.equal(row[6]!.seen, false);
  assert.ok(row.every((p) => p.h >= 0));
  assert.equal(smoothTerrainRow([], 5).length, 5);
  assert.ok(easeOutBack(0.6) > 1, "the gate overshoots before settling");
  assert.equal(easeOutBack(1), 1);
});
