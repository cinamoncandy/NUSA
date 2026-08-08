"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR,
  createArtifactManifest,
  evaluateProductionReleaseArtifactSeal
} = require("../dist/apps/execution/src/index.js");
const { validateProductionReleaseArtifactSeal } = require("../scripts/validate-production-release-artifact-seal.js");

const REV = "1".repeat(40);
const CFG = "2".repeat(64);
const HASH = (char) => char.repeat(64);

function artifactManifest() {
  return createArtifactManifest("release-1", [
    { path: "NUSA.exe", sha256: HASH("3"), sizeBytes: 1024 },
    { path: "resources/app.asar", sha256: HASH("4"), sizeBytes: 2048 }
  ]);
}

function valid(overrides = {}) {
  return {
    candidateId: "release-candidate-1",
    codeRevision: REV,
    configurationHash: CFG,
    buildManifestCommit: REV,
    buildManifestConfigurationHash: CFG,
    deploymentBundleId: "deployment-bundle-1",
    rollbackBundleId: "rollback-bundle-1",
    rollbackVerifiedBundleId: "rollback-bundle-1",
    artifactManifest: artifactManifest(),
    securityReportDigest: HASH("5"),
    sbomDigest: HASH("6"),
    auditReplayAnchor: HASH("7"),
    restoreVerificationFingerprint: HASH("8"),
    preflightFingerprint: HASH("9"),
    ceremonyMechanismEvidenceRef: "evidence:wo-0044-completion",
    ceremonyMechanismEvidenceDigest: HASH("a"),
    signing: { state: "SIGNED_VERIFIED", evidenceRef: "signing:verification-1", evidenceDigest: HASH("b") },
    checks: {
      releaseProcess: "PASS",
      securityGate: "PASS",
      artifactAllowlist: "PASS",
      rollbackVerification: "PASS",
      restoreVerification: "PASS",
      capabilitySurface: "PASS",
      transportCredentialReadiness: "PASS",
      activationRehearsal: "PASS",
      readOnlyBrokerCredential: "PASS"
    },
    ...overrides
  };
}

test("signed exact release candidate is ready for production human review only", () => {
  const result = evaluateProductionReleaseArtifactSeal(valid());
  assert.equal(result.verdict, "READY_FOR_PRODUCTION_HUMAN_REVIEW");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.deploymentAuthority, false);
  assert.equal(result.activationAuthority, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("identical normalized candidates yield identical seal fingerprints", () => {
  const first = evaluateProductionReleaseArtifactSeal(valid());
  const reordered = createArtifactManifest("release-1", [
    { path: "resources/app.asar", sha256: HASH("4"), sizeBytes: 2048 },
    { path: "NUSA.exe", sha256: HASH("3"), sizeBytes: 1024 }
  ]);
  const second = evaluateProductionReleaseArtifactSeal(valid({ artifactManifest: reordered }));
  assert.equal(first.releaseSealFingerprint, second.releaseSealFingerprint);
});

test("artifact tamper and exact identity or rollback mismatch fail closed", () => {
  const manifest = artifactManifest();
  const tamperedManifest = { ...manifest, entries: [{ ...manifest.entries[0], sizeBytes: 999 }, manifest.entries[1]] };
  assert.throws(() => evaluateProductionReleaseArtifactSeal(valid({ artifactManifest: tamperedManifest })), /ARTIFACT_MANIFEST_INVALID/);
  assert.equal(evaluateProductionReleaseArtifactSeal(valid({ buildManifestCommit: "0".repeat(40) })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateProductionReleaseArtifactSeal(valid({ buildManifestConfigurationHash: HASH("0") })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateProductionReleaseArtifactSeal(valid({ rollbackVerifiedBundleId: "rollback-bundle-other" })).verdict, "SAFE_BLOCK");
});

test("unsigned or failed safety evidence blocks production review", () => {
  assert.equal(evaluateProductionReleaseArtifactSeal(valid({ signing: { state: "UNSIGNED" } })).verdict, "SAFE_BLOCK");
  const failed = valid();
  failed.checks = { ...failed.checks, securityGate: "FAIL" };
  assert.equal(evaluateProductionReleaseArtifactSeal(failed).verdict, "SAFE_BLOCK");
});

test("unknown signing or safety evidence remains unknown and fail closed", () => {
  assert.equal(evaluateProductionReleaseArtifactSeal(valid({ signing: { state: "UNKNOWN" } })).verdict, "UNKNOWN");
  const unknown = valid();
  unknown.checks = { ...unknown.checks, rollbackVerification: "UNKNOWN" };
  const result = evaluateProductionReleaseArtifactSeal(unknown);
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.authorizesLive, false);
});

test("signing evidence and safety roots are bound into the seal fingerprint", () => {
  const base = evaluateProductionReleaseArtifactSeal(valid()).releaseSealFingerprint;
  assert.notEqual(evaluateProductionReleaseArtifactSeal(valid({ signing: { state: "SIGNED_VERIFIED", evidenceRef: "signing:verification-2", evidenceDigest: HASH("b") } })).releaseSealFingerprint, base);
  assert.notEqual(evaluateProductionReleaseArtifactSeal(valid({ securityReportDigest: HASH("c") })).releaseSealFingerprint, base);
  assert.notEqual(evaluateProductionReleaseArtifactSeal(valid({ preflightFingerprint: HASH("d") })).releaseSealFingerprint, base);
  assert.notEqual(evaluateProductionReleaseArtifactSeal(valid({ ceremonyMechanismEvidenceDigest: HASH("e") })).releaseSealFingerprint, base);
});

test("source guard proves release seal cannot deploy or activate", () => {
  const result = validateProductionReleaseArtifactSeal();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR.deploymentAuthority, false);
  assert.equal(PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR.activationAuthority, false);
  assert.equal(PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR.executionAuthority, false);
  assert.equal(PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR.authorizesLive, false);
  assert.equal(PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
