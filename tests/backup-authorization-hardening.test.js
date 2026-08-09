"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup } = require("../scripts/backup-restore.js");

function runBackupCase(name, authorizationText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nusa-recovery-auth-final-${name}-`));
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
  fs.writeFileSync(path.join(source, "request.log"), authorizationText);
  return { root, backup: () => createBackup({ include: [`LOG:${source}`], destination, "snapshot-id": `auth-final-${name}` }) };
}

for (const [name, text] of [
  ["short-bearer", "Authorization: Bearer abc\n"],
  ["quoted-null", 'Authorization: "null"\n'],
  ["quoted-undefined-json", '{"Authorization":"undefined"}\n'],
  ["bracket", 'headers["Authorization"] = "Basic abc";\n'],
  ["node-set-header", 'request.setHeader("Authorization", "Bearer abc")\n'],
  ["node-append-header", 'request.appendHeader("Authorization", "Bearer abc")\n'],
  ["xhr", 'xhr.setRequestHeader("Authorization", "Bearer abc")\n'],
  ["escaped-json", '{\\"Authorization\\":\\"Bearer abc\\"}\n'],
  ["shadowed-direct", 'Authorization: ""\nAuthorization: Bearer abc\n'],
  ["shadowed-tuple", '[["Authorization", ""], ["Authorization", "Basic abc"]]\n'],
  ["shadowed-setter", 'headers.set("Authorization", ""); headers.append("Authorization", "Bearer abc");\n'],
]) {
  test(`backup excludes ${name} Authorization credential`, () => {
    const fixture = runBackupCase(name, text);
    try {
      const backup = fixture.backup();
      assert.equal(backup.manifest.secretExcludedCount, 1);
      assert.equal(backup.manifest.entries.length, 1);
      assert.match(backup.manifest.entries[0].path, /settings\.json$/);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

for (const [name, text] of [
  ["missing", "Authorization:\n"],
  ["empty", 'Authorization: ""\n'],
  ["bare-null", "Authorization = null;\n"],
  ["bare-undefined", "Authorization = undefined;\n"],
  ["setter-null", 'request.setHeader("Authorization", null)\n'],
  ["setter-undefined", 'xhr.setRequestHeader("Authorization", undefined)\n'],
  ["empty-tuple", '[["Authorization", ""]]\n'],
]) {
  test(`backup preserves ${name} Authorization absence`, () => {
    const fixture = runBackupCase(name, text);
    try {
      const backup = fixture.backup();
      assert.equal(backup.manifest.secretExcludedCount, 0);
      assert.equal(backup.manifest.entries.length, 2);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
