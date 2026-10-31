import assert from "node:assert/strict";
import test from "node:test";
import { WAFFLE_MAX_CELLS, buildWaffle } from "./learningWaffleModel";

const tally = (cells: readonly number[]) => [0, 1, 2].map((k) => cells.filter((c) => c === k).length);

test("one cell per strategy: 418 -> 15 -> 0 draws 418 cells, 15 passers and no holdout pass", () => {
  const w = buildWaffle(418, 15, 0);
  assert.ok(w);
  assert.equal(w.unit, 1);
  assert.equal(w.cells.length, 418);
  assert.deepEqual(tally(w.cells), [403, 15, 0]);
  assert.equal(w.rows, 19);
});

test("a holdout pass is drawn, and above the cap each cell stands for several strategies", () => {
  assert.deepEqual(tally(buildWaffle(418, 15, 2)!.cells), [403, 13, 2]);
  const big = buildWaffle(5000, 40, 1)!;
  assert.equal(big.unit, Math.ceil(5000 / WAFFLE_MAX_CELLS));
  assert.ok(big.cells.length <= WAFFLE_MAX_CELLS);
  assert.deepEqual(tally(big.cells).slice(1), [3, 1], "4 discovery cells, one of them also a holdout pass; a nonzero stage keeps a cell");
});

test("inconsistent or malformed input draws nothing", () => {
  for (const [t, d, h] of [[0, 0, 0], [10, 11, 0], [10, 2, 3], [-1, 0, 0], [1.5, 0, 0]] as const) assert.equal(buildWaffle(t, d, h), null);
});
