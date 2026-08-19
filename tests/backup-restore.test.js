"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createBackup, readAndVerify, runDrill } = require("../scripts/backup-restore.js");
const { SYMLINK_UNAVAILABLE, canCreateSymlink } = require("./support/symlinkCapability.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-recovery-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
  fs.writeFileSync(path.join(source, "dashboard-token.txt"), "must-never-be-backed-up");
  const hiddenApiKey = ["actual", "secret-value", "123456"].join("-");
  fs.writeFileSync(path.join(source, "plain-settings.json"), JSON.stringify({ api_key: hiddenApiKey }));
  return { root, source, destination };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("backup creates a missing destination, excludes secret-shaped paths, and records fail-closed safety metadata", () => {
  const { root, source, destination } = fixture();
  try {
    const result = createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "snapshot-a" });
    assert.equal(fs.existsSync(destination), true);
    assert.equal(result.manifest.mode, "BACKUP_COPY_ONLY");
    assert.equal(result.manifest.productionMutationAllowed, false);
    assert.equal(result.manifest.evidenceMutationAllowed, false);
    assert.equal(result.manifest.destructiveRestoreAllowed, false);
    assert.equal(result.manifest.secretMaterialIncluded, false);
    assert.equal(result.manifest.secretExcludedCount, 2);
    assert.equal(result.manifest.entries.length, 1);
    assert.match(result.manifest.entries[0].path, /settings\.json$/);
    assert.doesNotMatch(JSON.stringify(result.manifest), /must-never-be-backed-up/);
    assert.equal(readAndVerify(result.snapshot).manifestSha256.length, 64);
  } finally {
    cleanup(root);
  }
});

test("backup content scanning excludes secrets hidden behind benign filenames and verify rejects a self-consistent secret artifact", () => {
  const { root, source, destination } = fixture();
  try {
    const backup = createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "snapshot-secret-scan" });
    assert.equal(backup.manifest.entries.length, 1);
    assert.equal(backup.manifest.secretExcludedCount, 2);
    assert.match(backup.manifest.entries[0].path, /settings\.json$/);

    const manifestPath = path.join(backup.snapshot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entry = manifest.entries[0];
    const artifact = path.join(backup.snapshot, ...entry.path.split("/"));
    const hiddenToken = ["tampered", "secret-value", "123456"].join("-");
    const secretPayload = JSON.stringify({ token: hiddenToken });
    fs.writeFileSync(artifact, secretPayload);
    entry.sizeBytes = Buffer.byteLength(secretPayload);
    entry.sha256 = crypto.createHash("sha256").update(secretPayload).digest("hex");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    assert.throws(() => readAndVerify(backup.snapshot), /secret material detected/);
  } finally {
    cleanup(root);
  }
});

test("verify fails closed when a backed-up artifact is tampered", () => {
  const { root, source, destination } = fixture();
  try {
    const result = createBackup({ include: [`EVIDENCE:${source}`], destination, "snapshot-id": "snapshot-b" });
    const entry = result.manifest.entries[0];
    fs.appendFileSync(path.join(result.snapshot, ...entry.path.split("/")), "tamper");
    assert.throws(() => readAndVerify(result.snapshot), /size mismatch|checksum mismatch/);
  } finally {
    cleanup(root);
  }
});

test("verify-only restore drill removes the target and writes a manifest-bound Evidence log", () => {
  const { root, source, destination } = fixture();
  try {
    const backup = createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "snapshot-c" });
    const drillTarget = path.join(root, "drill-target");
    const drillLog = path.join(root, "evidence", "recovery-drill.json");
    const result = runDrill({ snapshot: backup.snapshot, "drill-target": drillTarget, "drill-log": drillLog });
    assert.equal(result.status, "PASS");
    assert.equal(result.mode, "VERIFY_ONLY_RESTORE_DRILL");
    assert.equal(result.targetRemoved, true);
    assert.equal(fs.existsSync(drillTarget), false);
    assert.equal(fs.existsSync(drillLog), true);

    const evidence = JSON.parse(fs.readFileSync(drillLog, "utf8"));
    assert.equal(evidence.eventType, "RECOVERY_DRILL_EVIDENCE");
    assert.equal(evidence.snapshotId, "snapshot-c");
    assert.equal(evidence.snapshotManifestSha256, readAndVerify(backup.snapshot).manifestSha256);
    assert.equal(evidence.productionMutationAllowed, false);
    assert.equal(evidence.evidenceMutationAllowed, false);
    assert.equal(evidence.destructiveRestoreAllowed, false);
    assert.equal(evidence.automaticRestartAllowed, false);
    const { evidenceHashSha256, ...payload } = evidence;
    assert.equal(evidenceHashSha256, crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex"));
  } finally {
    cleanup(root);
  }
});

test("a drill refuses to overwrite an existing Evidence log", () => {
  const { root, source, destination } = fixture();
  try {
    const backup = createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "snapshot-d" });
    const drillLog = path.join(root, "drill.json");
    fs.writeFileSync(drillLog, "existing");
    assert.throws(() => runDrill({ snapshot: backup.snapshot, "drill-log": drillLog, "drill-target": path.join(root, "target") }), /drill log must not already exist/);
  } finally {
    cleanup(root);
  }
});

test("backup refuses symlink sources and release metadata missing checksums or SBOM", (t) => {
  const { root, source, destination } = fixture();
  try {
    // Skipping only the symlink half keeps the rest of this contract enforced everywhere.
    if (canCreateSymlink()) {
      const linked = path.join(root, "linked");
      fs.symlinkSync(source, linked, "dir");
      assert.throws(() => createBackup({ include: [`CONFIG:${linked}`], destination, "snapshot-id": "snapshot-e" }), /symlink is prohibited/);
    } else {
      t.diagnostic(SYMLINK_UNAVAILABLE);
    }

    const release = path.join(root, "release");
    fs.mkdirSync(release);
    fs.writeFileSync(path.join(release, "build-manifest.json"), JSON.stringify({ capabilityDescriptor: { productionMutationAllowed: false } }));
    assert.throws(() => createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "snapshot-f", "release-root": release }), /checksums and SBOM are required/);
    assert.equal(fs.existsSync(path.join(destination, "snapshot-f")), false, "failed backup must be cleaned up");
  } finally {
    cleanup(root);
  }
});

test("destructive restore command is intentionally unavailable", () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "..", "scripts", "backup-restore.js"), "restore"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /destructive restore is intentionally unsupported/);
});
