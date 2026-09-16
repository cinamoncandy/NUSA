const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { canonicalResearchJson } = require("../dist/packages/contracts/src/researchRuntime.js");
const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");

const SOURCE_SHA = "a".repeat(40);

function hash(value) {
  return createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
}

function snapshot(fingerprintChar, generatedAt) {
  const payload = {
    schemaVersion: 1,
    sourceCommitSha: SOURCE_SHA,
    originalRunFingerprintSha256: fingerprintChar.repeat(64),
    candidates: [{
      id: `identity-only-${fingerprintChar}`,
      candidateSpecification: { codeSha: SOURCE_SHA },
    }],
    options: { generatedAt },
  };
  return { ...payload, snapshotSha256: hash(payload) };
}

function archivePath(t, snapshots) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-identity-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "research-replay-snapshots.json");
  fs.writeFileSync(filename, `${JSON.stringify({ schemaVersion: 1, snapshots })}\n`, "utf8");
  return filename;
}

test("latest identity scan verifies immutable envelopes without replaying every historical League", async (t) => {
  const older = snapshot("1", "2026-09-07T00:00:00.000Z");
  const newer = snapshot("2", "2026-09-08T00:00:00.000Z");
  const store = new FileResearchRunReplaySnapshotStore(archivePath(t, [older, newer]));

  const identity = await store.latestIdentityAsync();
  assert.deepEqual(identity, {
    originalRunFingerprintSha256: "2".repeat(64),
    generatedAt: "2026-09-08T00:00:00.000Z",
  });

  assert.throws(
    () => store.read(newer.originalRunFingerprintSha256),
    /research|candidate|league|benchmark|dataset|undefined/i,
    "selected snapshots must still pass the existing full semantic replay boundary when read",
  );
});

test("latest identity scan rejects checksum tampering", (t) => {
  const entry = snapshot("3", "2026-09-08T00:00:00.000Z");
  entry.options.generatedAt = "2026-09-09T00:00:00.000Z";
  const store = new FileResearchRunReplaySnapshotStore(archivePath(t, [entry]));
  assert.throws(() => store.latestIdentity(), /checksum mismatch/);
});

test("latest identity scan rejects duplicate immutable run identity", (t) => {
  const first = snapshot("4", "2026-09-07T00:00:00.000Z");
  const second = snapshot("4", "2026-09-08T00:00:00.000Z");
  const store = new FileResearchRunReplaySnapshotStore(archivePath(t, [first, second]));
  assert.throws(() => store.latestIdentity(), /duplicated or invalid/);
});

test("latest identity scan fails closed when newest Research time is ambiguous", (t) => {
  const first = snapshot("5", "2026-09-08T00:00:00.000Z");
  const second = snapshot("6", "2026-09-08T00:00:00.000Z");
  const store = new FileResearchRunReplaySnapshotStore(archivePath(t, [first, second]));
  assert.throws(() => store.latestIdentity(), /latest Research snapshot is ambiguous/);
});
