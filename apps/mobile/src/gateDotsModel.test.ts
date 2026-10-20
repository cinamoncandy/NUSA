import assert from "node:assert/strict";
import { test } from "node:test";
import { gateDotKind } from "./gateDotsModel";

test("only PASS is filled; CHECKING is hollow; everything else reads as blocked", () => {
  assert.equal(gateDotKind("PASS"), "PASSED");
  assert.equal(gateDotKind("CHECKING"), "CHECKING");
  for (const s of ["FAIL", "BLOCKED", "STALE"] as const) assert.equal(gateDotKind(s), "BLOCKED");
});
