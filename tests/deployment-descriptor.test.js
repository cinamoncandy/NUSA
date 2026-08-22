const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildDescriptor, hashTree, scanCapabilities } = require("../scripts/build-deployment-descriptor.js");
const { evaluateDeploymentSafety } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
const { verifyDeploymentSafetyDecision } = require("../scripts/lib/paper-risk-gateway-verifier.js");

test("the artifact tree hash is deterministic and content-sensitive", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "a.js"), "one");
  fs.writeFileSync(path.join(root, "nested", "b.js"), "two");

  const first = hashTree(root);
  assert.equal(first.fileCount, 2);
  assert.equal(hashTree(root).sha256, first.sha256);

  fs.writeFileSync(path.join(root, "nested", "b.js"), "three");
  assert.notEqual(hashTree(root).sha256, first.sha256);
});

test("renaming a file changes the artifact hash even when contents are identical", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "a.js"), "same");
  const before = hashTree(root).sha256;
  fs.renameSync(path.join(root, "a.js"), path.join(root, "b.js"));
  assert.notEqual(hashTree(root).sha256, before);
});

test("a missing build output is reported rather than hashed as empty", () => {
  assert.equal(hashTree(path.join(os.tmpdir(), "definitely-not-here-", String(Date.now()))), null);
  assert.throws(() => buildDescriptor({ dist: "no-such-directory" }), /build output not found/);
});

test("read-only Upbit observation is visible without being classified as live mutation or credential storage", () => {
  const scan = scanCapabilities();
  assert.ok(scan.scannedFileCount > 0);
  assert.deepEqual(scan.findings.liveTradingCapabilityPresent, []);
  assert.ok(scan.findings.readOnlyPrivateApiCapabilityPresent.length > 0);
  assert.deepEqual(scan.findings.privateApiCapabilityPresent, []);
  assert.deepEqual(scan.findings.credentialStoragePresent, []);
  assert.equal(scan.killSwitchReachable, true);
});

test("the descriptor states plainly that a scan proves presence, not absence", () => {
  const { provenance } = buildDescriptor({});
  assert.equal(provenance.capabilityEvidence.method, "STATIC_SOURCE_SCAN");
  assert.equal(provenance.capabilityEvidence.provesAbsence, false);
  assert.ok(provenance.capabilityEvidence.findings.readOnlyPrivateApiCapabilityPresent.length > 0);
  assert.equal(provenance.killSwitchEvidence.provesRuntimeReachability, false);
});

test("without an --expected value the corresponding comparison is vacuous and said to be", () => {
  const { descriptor, provenance } = buildDescriptor({});
  assert.equal(descriptor.artifactSha256, descriptor.expectedArtifactSha256);
  assert.equal(descriptor.sourceCommitSha, descriptor.expectedSourceCommitSha);
  assert.deepEqual(provenance.expectationsSupplied, []);

  const pinned = buildDescriptor({ expectedArtifactSha256: "deadbeef", expectedSourceCommitSha: "cafebabe" });
  assert.deepEqual(pinned.provenance.expectationsSupplied, ["artifactSha256", "sourceCommitSha"]);
});

test("a descriptor with read-only authenticated observation passes the Paper deployment gate", () => {
  const { descriptor, provenance } = buildDescriptor({});
  assert.equal(descriptor.liveTradingCapabilityPresent, false);
  assert.equal(descriptor.privateApiCapabilityPresent, false);
  assert.equal(descriptor.credentialStoragePresent, false);
  assert.ok(provenance.capabilityEvidence.findings.readOnlyPrivateApiCapabilityPresent.length > 0);

  const decision = evaluateDeploymentSafety(descriptor);
  assert.equal(decision.status, "ALLOW", JSON.stringify(decision.reasonCodes));
  assert.equal(decision.productionMutationAllowed, false);
  assert.equal(verifyDeploymentSafetyDecision(descriptor, decision).status, "PASS");
});

test("a pinned expectation that no longer matches halts the deployment gate", () => {
  const { descriptor } = buildDescriptor({ expectedArtifactSha256: "0".repeat(64), expectedSourceCommitSha: "0".repeat(40) });
  const decision = evaluateDeploymentSafety(descriptor);
  assert.equal(decision.status, "HALT");
  assert.deepEqual(decision.reasonCodes, ["ARTIFACT_HASH_MISMATCH", "SOURCE_COMMIT_MISMATCH"]);
  assert.equal(verifyDeploymentSafetyDecision(descriptor, decision).status, "PASS");
});

test("auto-trade defaulting on halts the deployment gate", () => {
  const { descriptor } = buildDescriptor({ autoTradeDefaultEnabled: true });
  const decision = evaluateDeploymentSafety(descriptor);
  assert.equal(decision.status, "HALT");
  assert.ok(decision.reasonCodes.includes("AUTO_TRADE_DEFAULT_ON"));
});
