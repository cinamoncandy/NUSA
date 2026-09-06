import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { FileResearchRunReplaySnapshotStore } from "./researchRunReplaySnapshotStore";

function fixture(): { store: FileResearchRunReplaySnapshotStore; filename: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-replay-"));
  const filename = path.join(directory, "snapshots.json");
  return { store: new FileResearchRunReplaySnapshotStore(filename), filename, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

describe("FileResearchRunReplaySnapshotStore", () => {
  it("rejects invalid run fingerprints before reading archive content", () => {
    const f = fixture();
    try { assert.throws(() => f.store.read("not-a-sha256"), /fingerprint is invalid/); }
    finally { f.cleanup(); }
  });

  it("bounded read accepts an empty canonical archive without materializing a match", async () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.filename, '{"schemaVersion":1,"snapshots":[]}\n', "utf8");
      assert.equal(f.store.read("a".repeat(64)), undefined);
      assert.equal(f.store.latest(), undefined);
      assert.equal(await f.store.latestIdentityAsync(), undefined);
    } finally { f.cleanup(); }
  });

  it("bounded read fails closed on trailing archive corruption", async () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.filename, '{"schemaVersion":1,"snapshots":[]}junk', "utf8");
      assert.throws(() => f.store.read("a".repeat(64)), /file is corrupted/);
      assert.throws(() => f.store.latest(), /file is corrupted/);
      await assert.rejects(f.store.latestIdentityAsync(), /failed closed/);
    } finally { f.cleanup(); }
  });

  it("fails closed on corrupt persisted archive JSON", () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.filename, "{broken", "utf8");
      assert.throws(() => f.store.list(), /file is corrupted/);
    } finally { f.cleanup(); }
  });

  it("fails closed on unsupported archive schema", () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.filename, JSON.stringify({ schemaVersion: 2, snapshots: [] }), "utf8");
      assert.throws(() => f.store.list(), /file schema is invalid/);
    } finally { f.cleanup(); }
  });
});
