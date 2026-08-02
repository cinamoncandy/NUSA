const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanText } = require("../scripts/security-gate.js");
const { dependencyIntegrity, verifyArtifacts } = require("../scripts/security-gate.js");

test("secret scanner reports credential material without returning its value", () => {
  const findings = scanText('const key = "ghp_12345678901234567890";');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "TOKEN_PREFIX");
  assert.equal(Object.hasOwn(findings[0], "value"), false);
});

test("secret scanner ignores explicit non-secret placeholders", () => {
  assert.deepEqual(scanText('password: "not-configured"'), []);
});

test("lockfile contains integrity metadata for every resolved package", () => {
  const result = dependencyIntegrity();
  assert.equal(result.findings.length, 0);
  assert.ok(result.packageCount > 0);
});

test("artifact verification checks recorded hashes and signing state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-security-"));
  try {
    const artifact = path.join(directory, "NUSA.exe");
    fs.writeFileSync(artifact, "paper-only-test-artifact");
    const crypto = require("node:crypto");
    const hash = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    fs.writeFileSync(path.join(directory, "build-manifest.json"), JSON.stringify({ capabilityDescriptor: { productionMutationAllowed: false, liveTradingEnabled: false, credentialsConfigured: false }, signing: { status: "CONFIGURED_BY_BUILD_ENV" } }));
    fs.writeFileSync(path.join(directory, "nusa-checksums.txt"), `${hash}  NUSA.exe\n`);
    const result = verifyArtifacts(directory);
    assert.equal(result.checksumStatus, "PASS");
    assert.equal(result.signingStatus, "PASS");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
