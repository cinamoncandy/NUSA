import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeWorkSnapshot, decideActiveWorkClaim, type ActiveWorkClaim } from "./activeWipRegistry";

const claim = (workId: string, executionId: string, modules: readonly string[], files: readonly string[], claimedAt = 100, leaseExpiresAt = 1_000): ActiveWorkClaim =>
  ({ workId, executionId, touchedModules: modules, touchedFiles: files, claimedAt, leaseExpiresAt });

describe("bounded active WIP registry", () => {
  it("allows independent work up to the bounded WIP limit", () => {
    const current = [claim("A", "exec-A", ["research"], ["a.ts"])];
    assert.equal(decideActiveWorkClaim(claim("B", "exec-B", ["paper"], ["b.ts"]), current, 200, 2).accepted, true);
    assert.equal(decideActiveWorkClaim(claim("C", "exec-C", ["ui"], ["c.ts"]), current, 200, 1).reason, "WIP_LIMIT_REACHED");
  });

  it("fails closed on overlapping module or file ownership", () => {
    const current = [claim("A", "exec-A", ["autopilot"], ["apps/autopilot/src/index.ts"])];
    const moduleConflict = decideActiveWorkClaim(claim("B", "exec-B", ["autopilot"], ["other.ts"]), current, 200, 4);
    assert.equal(moduleConflict.reason, "RESOURCE_CONFLICT");
    assert.deepEqual(moduleConflict.conflicts[0]?.modules, ["autopilot"]);
    const fileConflict = decideActiveWorkClaim(claim("C", "exec-C", ["other"], ["apps/autopilot/src/index.ts"]), current, 200, 4);
    assert.deepEqual(fileConflict.conflicts[0]?.files, ["apps/autopilot/src/index.ts"]);
  });

  it("is replay-idempotent and ignores expired claims", () => {
    const original = claim("A", "exec-A", ["autopilot"], ["a.ts"], 100, 300);
    assert.equal(decideActiveWorkClaim(original, [original], 200, 1).accepted, true);
    assert.deepEqual(activeWorkSnapshot([original], 301), []);
  });

  it("rejects malformed claims and conflicting work identity deterministically", () => {
    assert.equal(decideActiveWorkClaim(claim("", "exec", [], []), [], 200, 2).reason, "INVALID_CLAIM");
    assert.throws(() => activeWorkSnapshot([claim("A", "exec-1", ["one"], ["a.ts"]), claim("A", "exec-2", ["two"], ["b.ts"])], 200), /ACTIVE_WIP_IDENTITY_CONFLICT/);
  });
});
