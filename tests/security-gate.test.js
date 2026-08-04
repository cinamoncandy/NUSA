const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanText } = require("../scripts/security-gate.js");
const { dependencyIntegrity, licenseAudit, parseLockfile, verifyArtifacts } = require("../scripts/security-gate.js");

test("secret scanner reports credential material without returning its value", () => {
  const findings = scanText(`const key = "${["ghp_", "12345678901234567890"].join("")}";`);
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

test("lockfile pins the patched versions for audited high advisories", () => {
  const packages = parseLockfile().packages;
  assert.ok(packages.some((item) => item.name === "fast-uri" && item.version === "3.1.5"));
  assert.ok(packages.some((item) => item.name === "brace-expansion" && item.version === "1.1.18"));
  assert.equal(packages.some((item) => item.name === "fast-uri" && item.version === "3.1.4"), false);
  assert.equal(packages.some((item) => item.name === "brace-expansion" && item.version === "1.1.17"), false);
});

test("optional detection finds optional: true even when other snapshot keys sit between it and the header", () => {
  // postject's snapshot entry has a "dependencies:" block before "optional: true" --
  // a package whose optional flag isn't the line immediately after its header must
  // still be recognized as optional, or license/audit checks wrongly flag it as missing.
  const postject = parseLockfile().packages.find((item) => item.name === "postject");
  assert.ok(postject, "postject must still be present in the lockfile for this regression test to mean anything");
  assert.equal(postject.optional, true);
});

test("license audit ignores platform-selected optional packages without skipping ordinary dependencies", () => {
  const lock = parseLockfile();
  const platformPackages = lock.packages.filter((item) => item.platformSpecific);
  assert.ok(platformPackages.length > 0);
  assert.ok(platformPackages.some((item) => /^(?:@esbuild\/|@rollup\/rollup-|fsevents$)/.test(item.name)));
  const licenses = licenseAudit(lock);
  assert.equal(licenses.missing.some((item) => item.startsWith("@esbuild/")), false);
  assert.equal(licenses.missing.some((item) => item.startsWith("@rollup/rollup-")), false);
  assert.equal(licenses.missing.some((item) => item.startsWith("fsevents@")), false);
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
