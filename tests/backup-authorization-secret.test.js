"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup } = require("../scripts/backup-restore.js");

const basicCredential = ["dXNlcjpwYXNzd29yZA", "=="].join("");
const longCredential = ["0123456789abcdef", "0123456789abcdef"].join("");
const cases = [
  ["bearer", `Authorization: Bearer ${["authorization", "secret-value", "123456"].join("-")}\n`],
  ["short-bearer", "Authorization: Bearer abc\n"],
  ["basic", `Authorization: Basic ${basicCredential}\n`],
  ["custom-scheme", `Authorization: Foo ${longCredential}\n`],
  ["token-char-scheme", `Authorization: X+Y ${longCredential}\n`],
  ["numeric-leading-scheme", `Authorization: 9Auth ${longCredential}\n`],
  ["quoted-json", `${JSON.stringify({ Authorization: `Basic ${basicCredential}` })}\n`],
  ["bracket-property", `headers["Authorization"] = "Basic ${basicCredential}"\n`],
  ["dot-property", `headers.authorization = "Basic ${basicCredential}"\n`],
  ["escaped-json", `${JSON.stringify(JSON.stringify({ Authorization: `Basic ${basicCredential}` }))}\n`],
  ["header-tuple", `${JSON.stringify([["Authorization", `Basic ${basicCredential}`]])}\n`],
  ["headers-setter", `headers.set("Authorization", "Basic ${basicCredential}")\n`],
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

test("empty Authorization representations are not treated as credentials", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-recovery-authorization-empty-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
  fs.writeFileSync(path.join(source, "empty.log"), `${JSON.stringify({ Authorization: "" })}\n`);
  try {
    const backup = createBackup({ include: [`LOG:${source}`], destination, "snapshot-id": "authorization-empty" });
    assert.equal(backup.manifest.secretExcludedCount, 0);
    assert.equal(backup.manifest.entries.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
