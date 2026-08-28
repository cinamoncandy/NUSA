import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNusaDevelopmentQueue, type NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";

const T0 = Date.parse("2026-08-28T00:00:00.000Z");

function work(id: string, touchedFiles: readonly string[]): NusaDevelopmentWorkItem {
  return {
    id,
    state: "READY",
    priority: "P1",
    dependencies: [],
    canonicalOwner: null,
    touchedFiles,
    evidenceRequirements: ["targeted-test", "exact-head-ci"],
    nextAction: "claim",
    createdAt: T0,
    claim: null,
  };
}

describe("NUSA development queue canonical touched-file identity", () => {
  it("accepts canonical repository-relative file paths", () => {
    const queue = createNusaDevelopmentQueue([
      work("canonical", ["apps/desktop/src/cloud/nusaDevelopmentControlPlane.ts", ".github/workflows/ci.yml"]),
    ]);
    assert.deepEqual(queue.items[0]?.touchedFiles, [
      "apps/desktop/src/cloud/nusaDevelopmentControlPlane.ts",
      ".github/workflows/ci.yml",
    ]);
  });

  it("fails closed on path aliases that could bypass conflict allocation", () => {
    for (const path of [
      "./shared.ts",
      "apps/../shared.ts",
      "apps/./shared.ts",
      "/shared.ts",
      "apps\\shared.ts",
      "apps//shared.ts",
      "apps/shared.ts/",
      "",
    ]) {
      assert.throws(
        () => createNusaDevelopmentQueue([work(`invalid-${path || "empty"}`, [path])]),
        /WORK_TOUCHED_FILE_NOT_CANONICAL/,
        path,
      );
    }
  });

  it("rejects duplicate canonical file identity within one work item", () => {
    assert.throws(
      () => createNusaDevelopmentQueue([work("duplicate", ["shared.ts", "shared.ts"])]),
      /WORK_TOUCHED_FILE_DUPLICATE:duplicate:shared\.ts/,
    );
  });
});
