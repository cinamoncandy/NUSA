"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBackup, readAndVerify } = require("../scripts/backup-restore.js");
const { redactSecretText, scanSecretText } = require("../scripts/recovery-secret-safety.js");

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nusa-recovery-secret-"));
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("secret scanner catches credential assignments, bearer values, provider tokens, JWTs, and private keys", () => {
  const bearer = ["bearer", "material", "0123456789"].join("-");
  const providerToken = `ghp_${"A".repeat(20)}`;
  const jwt = `eyJ${"A".repeat(12)}.${"B".repeat(12)}.${"C".repeat(12)}`;
  const privateKey = ["-----BEGIN PRIVATE KEY-----", "abc", "-----END PRIVATE KEY-----"].join("\n");
  const apiValue = ["prod", "api", "material", "12345"].join("-");
  const input = [`Authorization: Bearer ${bearer}`, `apiKey=${apiValue}`, providerToken, jwt, privateKey].join("\n");
  const rules = new Set(scanSecretText(input).map((item) => item.rule));
  for (const rule of ["AUTHORIZATION_VALUE", "CREDENTIAL_ASSIGNMENT", "TOKEN_PREFIX", "JWT_VALUE", "PRIVATE_KEY"]) assert.equal(rules.has(rule), true, rule);
  const redacted = redactSecretText(input);
  assert.deepEqual(scanSecretText(redacted), []);
  assert.doesNotMatch(redacted, new RegExp(bearer));
  assert.doesNotMatch(redacted, new RegExp(providerToken));
  assert.doesNotMatch(redacted, new RegExp(jwt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("backup fails closed on secret content hidden inside an ordinary config filename", () => {
  const root = temporaryRoot();
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  const apiValue = ["live", "credential", "material", "12345"].join("-");
  fs.writeFileSync(path.join(source, "config.json"), JSON.stringify({ mode: "PAPER", apiKey: apiValue }));
  try {
    assert.throws(() => createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "content-secret" }), /contains secret material/);
    assert.equal(fs.existsSync(path.join(destination, "content-secret")), false, "failed secret-bearing snapshot must be removed");
  } finally {
    cleanup(root);
  }
});

test("verification rescans artifact content even when attacker rewrites manifest size and digest", () => {
  const root = temporaryRoot();
  const source = path.join(root, "source");
  const destination = path.join(root, "backups");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), JSON.stringify({ mode: "PAPER", productionMutationAllowed: false }));
  try {
    const backup = createBackup({ include: [`CONFIG:${source}`], destination, "snapshot-id": "rescan" });
    const manifestPath = path.join(backup.snapshot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const artifactPath = path.join(backup.snapshot, ...manifest.entries[0].path.split("/"));
    const hiddenValue = ["private", "token", "material", "12345"].join("-");
    const malicious = Buffer.from(JSON.stringify({ token: hiddenValue }), "utf8");
    fs.writeFileSync(artifactPath, malicious);
    manifest.entries[0].sizeBytes = malicious.length;
    manifest.entries[0].sha256 = crypto.createHash("sha256").update(malicious).digest("hex");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => readAndVerify(backup.snapshot), /contains secret material/);
  } finally {
    cleanup(root);
  }
});
