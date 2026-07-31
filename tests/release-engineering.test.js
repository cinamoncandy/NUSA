const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
test("release engineering preserves the non-mutation capability boundary", () => {
  const source = fs.readFileSync(path.join(root, "scripts", "release-engineering.js"), "utf8");
  assert.match(source, /productionMutationAllowed: false/);
  assert.match(source, /build-manifest/);
  assert.match(source, /sha256/);
});
test("diagnostics and backup scripts redact secrets and produce manifests", () => {
  const diagnostics = fs.readFileSync(path.join(root, "scripts", "diagnostics-bundle.js"), "utf8");
  const backup = fs.readFileSync(path.join(root, "scripts", "backup-restore.js"), "utf8");
  assert.match(diagnostics, /REDACTED/);
  assert.match(diagnostics, /secretsIncluded: false/);
  assert.match(backup, /backup-manifest/);
  assert.match(backup, /productionMutationAllowed: false/);
});
