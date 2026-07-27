const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadEvidenceManifest, classifyTrust, EVIDENCE_ORDER } = require("../scripts/lib/strategy-research-evidence-manifest.js");
const { runStrategyResearchScorecard } = require("../scripts/lib/strategy-research-promotion-gate-runner.js");
const { sha256Hex } = require("../scripts/lib/canonical-hash.js");

const dir = path.join(__dirname, "fixtures", "strategy-promotion-gate");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

test("evidence is always reported in canonical order regardless of input order", () => {
  const request = load("promote-review");
  const shuffled = { ...request.manifest, evidence: [...request.manifest.evidence].reverse() };
  const manifest = loadEvidenceManifest(shuffled);
  assert.deepEqual(manifest.entries.map((entry) => entry.evidenceType), [...EVIDENCE_ORDER]);
});

test("real evidence that passed independent verification is VERIFIED_REAL", () => {
  assert.equal(classifyTrust({ schemaVersion: 1, dataProvenance: "REAL_MARKET_DATA", independentVerificationStatus: "PASS" }), "VERIFIED_REAL");
});

test("synthetic evidence that passed verification is VERIFIED_SYNTHETIC, never VERIFIED_REAL", () => {
  assert.equal(classifyTrust({ schemaVersion: 1, dataProvenance: "SYNTHETIC_FIXTURE", independentVerificationStatus: "PASS" }), "VERIFIED_SYNTHETIC");
});

test("real evidence that did not pass verification is UNVERIFIED_REAL", () => {
  assert.equal(classifyTrust({ schemaVersion: 1, dataProvenance: "REAL_MARKET_DATA", independentVerificationStatus: "NOT_RUN" }), "UNVERIFIED_REAL");
});

test("a failed independent verification is INVALID and is never tolerated", () => {
  assert.equal(classifyTrust({ schemaVersion: 1, dataProvenance: "REAL_MARKET_DATA", independentVerificationStatus: "FAIL" }), "INVALID");
  const manifest = loadEvidenceManifest(load("invalid-verifier").manifest);
  assert.ok(manifest.errors.some((m) => m.includes("independent verification FAILED")));
});

test("two results for the same analysis are rejected rather than the better one being chosen", () => {
  const request = load("promote-review");
  const duplicated = { ...request.manifest, evidence: [...request.manifest.evidence, request.manifest.evidence[0]] };
  const manifest = loadEvidenceManifest(duplicated);
  assert.ok(manifest.errors.some((m) => m.includes("not the best of several")));
});

test("evidence spanning two strategy fingerprints is rejected", () => {
  const request = load("promote-review");
  const mixed = { ...request.manifest, evidence: request.manifest.evidence.map((entry, index) => index === 0 ? { ...entry, strategyFingerprint: "other-strategy" } : entry) };
  const manifest = loadEvidenceManifest(mixed);
  assert.ok(manifest.errors.some((m) => m.includes("multiple strategy fingerprints")));
});

test("evidence spanning two source commits is rejected", () => {
  const request = load("promote-review");
  const mixed = { ...request.manifest, evidence: request.manifest.evidence.map((entry, index) => index === 0 ? { ...entry, sourceCommitSha: "deadbeef" } : entry) };
  const manifest = loadEvidenceManifest(mixed);
  assert.ok(manifest.errors.some((m) => m.includes("multiple source commits")));
});

test("missing evidence is reported as MISSING and produces a blocker", () => {
  const result = runStrategyResearchScorecard(load("hold-missing-evidence"));
  const walkForward = result.evidenceManifest.find((entry) => entry.evidenceType === "WALK_FORWARD");
  assert.equal(walkForward.present, false);
  assert.equal(walkForward.trust, "MISSING");
  assert.ok(result.blockers.some((blocker) => blocker.detail.includes("WALK_FORWARD")));
});

test("a declared result hash that does not match the file on disk is caught", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scorecard-evidence-"));
  const request = load("promote-review");
  for (const entry of request.manifest.evidence) fs.writeFileSync(path.join(tmp, entry.resultPath), "actual file contents");
  const manifest = loadEvidenceManifest(request.manifest, { evidenceRoot: tmp });
  assert.ok(manifest.errors.some((m) => m.includes("does not match the file on disk")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a matching result hash verifies against the file on disk", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scorecard-evidence-"));
  const request = load("promote-review");
  const contents = "canonical result";
  const hash = sha256Hex(contents);
  request.manifest.evidence = request.manifest.evidence.map((entry) => ({ ...entry, resultSha256: hash }));
  for (const entry of request.manifest.evidence) fs.writeFileSync(path.join(tmp, entry.resultPath), contents);
  const manifest = loadEvidenceManifest(request.manifest, { evidenceRoot: tmp });
  assert.deepEqual(manifest.errors, []);
  assert.ok(manifest.entries.every((entry) => entry.fileVerification === "HASH_MATCH"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a declared file that does not exist under the evidence root is caught", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scorecard-evidence-"));
  const manifest = loadEvidenceManifest(load("promote-review").manifest, { evidenceRoot: tmp });
  assert.ok(manifest.errors.some((m) => m.includes("does not exist under the evidence root")));
  fs.rmSync(tmp, { recursive: true, force: true });
});
