"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup } = require("../scripts/backup-restore.js");

function runBackupCase(name, authorizationLine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nusa-recovery-authorization-${name}-`));
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
  fs.writeFileSync(path.join(source, "request.log"), authorizationLine);
  return { root, backup: () => createBackup({ include: [`LOG:${source}`], destination, "snapshot-id": `authorization-${name}` }) };
}

const credentialCases = [
  ["bearer", "Authorization: Bearer authorization-secret-value-123456\n"],
  ["short-bearer", "Authorization: Bearer abc\n"],
  ["basic", "Authorization: Basic dXNlcjpwYXNzd29yZA==\n"],
  ["custom-scheme", "Authorization: Foo 0123456789abcdef0123456789abcdef\n"],
  ["token-char-scheme", "Authorization: X+Y 0123456789abcdef0123456789abcdef\n"],
  ["numeric-leading-scheme", "Authorization: 9Auth 0123456789abcdef0123456789abcdef\n"],
  ["quoted-json", `${JSON.stringify({ Authorization: "Basic dXNlcjpwYXNzd29yZA==" })}\n`],
  ["bracket-assignment", 'headers["Authorization"] = "Basic dXNlcjpwYXNzd29yZA==";\n'],
  ["dot-property", 'headers.Authorization = "Basic dXNlcjpwYXNzd29yZA==";\n'],
  ["nested-dot-property", 'request.headers.Authorization = "Bearer abc";\n'],
  ["tuple-pair", '[["Authorization", "Basic dXNlcjpwYXNzd29yZA=="]]\n'],
  ["headers-set", 'headers.set("Authorization", "Basic dXNlcjpwYXNzd29yZA==")\n'],
  ["headers-append", 'headers.append("Authorization", "X+Y abc")\n'],
  ["set-request-header", 'xhr.setRequestHeader("Authorization", "Basic dXNlcjpwYXNzd29yZA==")\n'],
  ["escaped-json", '{\\"Authorization\\":\\"Basic dXNlcjpwYXNzd29yZA==\\"}\n'],
];

for (const [name, authorizationLine] of credentialCases) {
  test(`backup excludes ${name} Authorization credentials hidden behind benign filenames`, () => {
    const fixture = runBackupCase(name, authorizationLine);
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

const absenceCases = [
  ["missing-value", "Authorization:\n"],
  ["empty-double-quoted", 'Authorization: ""\n'],
  ["empty-single-quoted", "Authorization: ''\n"],
  ["null-value", "Authorization: null\n"],
  ["undefined-value", "Authorization = undefined\n"],
  ["empty-bracket-assignment", 'headers["Authorization"] = "";\n'],
  ["empty-dot-property", 'headers.Authorization = "";\n'],
  ["empty-tuple-pair", '[["Authorization", ""]]\n'],
  ["empty-setter", 'headers.set("Authorization", "")\n'],
  ["empty-set-request-header", 'xhr.setRequestHeader("Authorization", "")\n'],
  ["escaped-empty-json", '{\\"Authorization\\":\\"\\"}\n'],
];

for (const [name, authorizationLine] of absenceCases) {
  test(`backup preserves ${name} Authorization absence instead of excluding a safe file`, () => {
    const fixture = runBackupCase(name, authorizationLine);
    try {
      const backup = fixture.backup();
      assert.equal(backup.manifest.secretExcludedCount, 0);
      assert.equal(backup.manifest.entries.length, 2);
      assert.equal(backup.manifest.entries.some((entry) => /request\.log$/.test(entry.path)), true);
      assert.equal(backup.manifest.entries.some((entry) => /settings\.json$/.test(entry.path)), true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
