"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup, readAndVerify } = require("../scripts/backup-restore.js");

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("backup persists the exact bytes that passed the content secret scan", () => {
  const root = temporaryRoot("nusa-recovery-toctou-");
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  const sourceFile = path.join(source, "settings.json");
  const safePayload = JSON.stringify({ mode: "PAPER", productionMutationAllowed: false });
  const hiddenValue = ["late", "secret-value", "123456"].join("-");
  const changedPayload = JSON.stringify({ api_key: hiddenValue });
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(sourceFile, safePayload);

  const originalCopyFileSync = fs.copyFileSync;
  let sourceCopyAttempted = false;
  fs.copyFileSync = (from, to, flags) => {
    if (path.resolve(from) === path.resolve(sourceFile)) {
      sourceCopyAttempted = true;
      fs.writeFileSync(sourceFile, changedPayload);
    }
    return originalCopyFileSync(from, to, flags);
  };

  try {
    const backup = createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "atomic-bytes" });
    const entry = backup.manifest.entries[0];
    const artifact = path.join(backup.snapshot, ...entry.path.split("/"));
    assert.equal(sourceCopyAttempted, false, "backup must not reopen/copy the source after scanning it");
    assert.equal(fs.readFileSync(artifact, "utf8"), safePayload);
    assert.equal(readAndVerify(backup.snapshot).manifest.secretMaterialIncluded, false);
  } finally {
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("backup rejects a regular source swapped to a symlink between lstat and open", () => {
  const root = temporaryRoot("nusa-recovery-symlink-race-");
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  const sourceFile = path.join(source, "settings.json");
  const outsideFile = path.join(root, "outside.txt");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(sourceFile, JSON.stringify({ mode: "PAPER" }));
  fs.writeFileSync(outsideFile, "outside-file-that-must-never-be-followed");

  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = (target, flags, mode) => {
    if (!swapped && path.resolve(target) === path.resolve(sourceFile)) {
      swapped = true;
      fs.rmSync(sourceFile);
      fs.symlinkSync(outsideFile, sourceFile, "file");
    }
    return originalOpenSync(target, flags, mode);
  };

  try {
    assert.throws(
      () => createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "symlink-race" }),
      /ELOOP|identity changed|symlink is prohibited/
    );
    assert.equal(swapped, true, "test must exercise the pre-open swap window");
    assert.equal(fs.existsSync(path.join(destination, "symlink-race")), false, "failed raced snapshot must be removed");
  } finally {
    fs.openSync = originalOpenSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
