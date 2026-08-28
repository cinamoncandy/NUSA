import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNusaDevelopmentQueue, type NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";

const T0 = Date.parse("2026-08-28T03:00:00.000Z");

function work(id: string, dependencies: readonly string[] = []): NusaDevelopmentWorkItem {
  return {
    id,
    state: "READY",
    priority: "P1",
    dependencies,
    canonicalOwner: null,
    touchedFiles: [`${id}.ts`],
    evidenceRequirements: ["targeted-test", "exact-head-ci"],
    nextAction: "claim",
    createdAt: T0,
    claim: null,
  };
}

describe("NUSA development queue dependency graph", () => {
  it("rejects a two-node dependency cycle instead of leaving READY work permanently unclaimable", () => {
    assert.throws(
      () => createNusaDevelopmentQueue([
        work("a", ["b"]),
        work("b", ["a"]),
      ]),
      /WORK_DEPENDENCY_CYCLE/,
    );
  });

  it("rejects longer transitive cycles", () => {
    assert.throws(
      () => createNusaDevelopmentQueue([
        work("a", ["b"]),
        work("b", ["c"]),
        work("c", ["a"]),
      ]),
      /WORK_DEPENDENCY_CYCLE/,
    );
  });

  it("accepts a valid dependency diamond", () => {
    const queue = createNusaDevelopmentQueue([
      work("base"),
      work("left", ["base"]),
      work("right", ["base"]),
      work("top", ["left", "right"]),
    ]);
    assert.equal(queue.items.length, 4);
    assert.equal(queue.revision, 0);
  });
});
