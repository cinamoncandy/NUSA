"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup } = require("../scripts/backup-restore.js");

test("backup excludes Authorization bearer secrets hidden behind benign filenames", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-recovery-authorization-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
  const bearer = ["Bearer", ["authorization", "secret-value", "123456"].join("-")].join(" ");
  fs.writeFileSync(path.join(source, "request.log"), `Authorization: ${bearer}\n`);
  try {
    const backup = createBackup({ include: [`LOG:${source}`], destination, "snapshot-id": "authorization-secret" });
    assert.equal(backup.manifest.secretExcludedCount, 1);
    assert.equal(backup.manifest.entries.length, 1);
    assert.match(backup.manifest.entries[0].path, /settings\.json$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
