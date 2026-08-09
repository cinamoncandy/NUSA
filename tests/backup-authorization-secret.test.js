"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup } = require("../scripts/backup-restore.js");

const cases = [
  ["bearer", "Authorization: Bearer authorization-secret-value-123456\n"],
  ["basic", "Authorization: Basic dXNlcjpwYXNzd29yZA==\n"],
  ["custom-scheme", "Authorization: Foo 0123456789abcdef0123456789abcdef\n"],
  ["token-char-scheme", "Authorization: X+Y 0123456789abcdef0123456789abcdef\n"],
  ["numeric-leading-scheme", "Authorization: 9Auth 0123456789abcdef0123456789abcdef\n"],
  ["short-custom-credential", "Authorization: A+B x\n"],
  ["quoted-json", `${JSON.stringify({ Authorization: "Basic dXNlcjpwYXNzd29yZA==" })}\n`],
];

for (const [name, authorizationLine] of cases) {
  test(`backup excludes ${name} Authorization credentials hidden behind benign filenames`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `nusa-recovery-authorization-${name}-`));
    const source = path.join(root, "source");
    const destination = path.join(root, "backups");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
    fs.writeFileSync(path.join(source, "request.log"), authorizationLine);
    try {
      const backup = createBackup({ include: [`LOG:${source}`], destination, "snapshot-id": `authorization-${name}` });
      assert.equal(backup.manifest.secretExcludedCount, 1);
      assert.equal(backup.manifest.entries.length, 1);
      assert.match(backup.manifest.entries[0].path, /settings\.json$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
