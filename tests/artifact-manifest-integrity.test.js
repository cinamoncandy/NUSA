const test = require("node:test");
const assert = require("node:assert/strict");
const { createArtifactManifest, verifyArtifactManifest } = require('../dist/apps/execution/src/index.js');

/**
 * verifyArtifactManifest used to compare only the two pre-computed manifestHash FIELDS
 * (expected.manifestHash !== actual.manifestHash). manifestHash is a value stored on the
 * object, not a property of reality: a manifest whose entries were edited but whose
 * manifestHash field was left untouched (or copied from a still-valid manifest) verified
 * clean with zero blockers, defeating the entire purpose of a tamper-evident manifest.
 */

test("a manifest whose entries were tampered but whose manifestHash was left stale is caught", () => {
  const genuine = createArtifactManifest("release-1", [
    { path: "app.exe", sha256: "a".repeat(64), sizeBytes: 100 },
    { path: "app.dll", sha256: "b".repeat(64), sizeBytes: 200 }
  ]);

  // Simulate a tampered artifact: one file's real hash changed (a swapped/rebuilt binary),
  // but the manifestHash field was NOT recomputed -- copied over unchanged, exactly as a
  // forged or stale manifest would arrive from disk.
  const tampered = { ...genuine, entries: [genuine.entries[0], { ...genuine.entries[1], sha256: "c".repeat(64) }] };

  const blockers = verifyArtifactManifest(genuine, tampered);
  assert.ok(blockers.length > 0, "tampered entries under a stale manifestHash must not verify clean");
  assert.ok(blockers.includes("MANIFEST_HASH_MISMATCH") || blockers.includes("ACTUAL_MANIFEST_HASH_INVALID"));
});

test("a manifest that is internally inconsistent (hash does not match its own entries) is rejected even compared to itself", () => {
  const genuine = createArtifactManifest("release-1", [{ path: "app.exe", sha256: "a".repeat(64), sizeBytes: 100 }]);
  const selfInconsistent = { ...genuine, manifestHash: "f".repeat(64) };

  assert.deepEqual(verifyArtifactManifest(selfInconsistent, selfInconsistent), ["EXPECTED_MANIFEST_HASH_INVALID", "ACTUAL_MANIFEST_HASH_INVALID"]);
});

test("two genuinely identical manifests still verify with no blockers", () => {
  const a = createArtifactManifest("release-1", [{ path: "app.exe", sha256: "a".repeat(64), sizeBytes: 100 }]);
  const b = createArtifactManifest("release-1", [{ path: "app.exe", sha256: "a".repeat(64), sizeBytes: 100 }]);
  assert.deepEqual(verifyArtifactManifest(a, b), []);
});

test("genuinely different entries (both manifests correctly self-consistent) are still caught, matching prior behavior", () => {
  const a = createArtifactManifest("release-1", [{ path: "app.exe", sha256: "a".repeat(64), sizeBytes: 100 }]);
  const c = createArtifactManifest("release-1", [{ path: "app.exe", sha256: "c".repeat(64), sizeBytes: 100 }]);
  assert.deepEqual(verifyArtifactManifest(a, c), ["MANIFEST_HASH_MISMATCH"]);
});
