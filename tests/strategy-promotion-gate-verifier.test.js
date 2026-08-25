const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runStrategyResearchScorecard } = require("../scripts/lib/strategy-research-promotion-gate-runner.js");
const { verifyScorecard } = require("../scripts/lib/strategy-research-promotion-gate-verifier.js");

const dir = path.join(__dirname, "fixtures", "strategy-promotion-gate");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
const fixtures = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));

test("every fixture's scorecard passes independent verification", () => {
  for (const name of fixtures) {
    const request = load(name);
    const verification = verifyScorecard(request, runStrategyResearchScorecard(request));
    assert.equal(verification.status, "PASS", `${name}: ${JSON.stringify(verification.errors)}`);
  }
});

test("the verifier catches a dimension upgraded after the fact", () => {
  const request = load("reject-strategy");
  const result = runStrategyResearchScorecard(request);
  const tampered = result.dimensions.find((dimension) => dimension.status === "FAIL");
  tampered.status = "STRONG";
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("dimensionsSha256")));
});

test("the verifier catches a decision softened after hashing", () => {
  const request = load("look-ahead-blocker");
  const result = runStrategyResearchScorecard(request);
  result.researchDecision = "PROMOTE_TO_EXTENDED_PAPER_REVIEW";
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("decisionSha256")));
});

test("the verifier rejects a PROMOTE decided on synthetic evidence", () => {
  const request = load("synthetic-only");
  const result = runStrategyResearchScorecard(request);
  result.researchDecision = "PROMOTE_TO_EXTENDED_PAPER_REVIEW";
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("PROMOTE decided on synthetic evidence")));
});

test("the verifier rejects a PROMOTE decided with missing evidence", () => {
  const request = load("hold-missing-evidence");
  const result = runStrategyResearchScorecard(request);
  result.researchDecision = "PROMOTE_TO_EXTENDED_PAPER_REVIEW";
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("PROMOTE decided with missing evidence")));
});

test("the verifier rejects a softened operational-safety failure", () => {
  const request = load("operational-safety-failure");
  const result = runStrategyResearchScorecard(request);
  result.researchDecision = "HOLD";
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("operational Paper safety FAIL must force INVALID")));
});

test("the verifier rejects a numeric total score", () => {
  const request = load("promote-review");
  const result = runStrategyResearchScorecard(request);
  result.totalScore = 87;
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("numeric total score")));
});

test("the verifier rejects a self-approved owner review", () => {
  const request = load("promote-review");
  const result = runStrategyResearchScorecard(request);
  result.ownerReview = { status: "APPROVED", approvedBy: "scorecard", approvedAt: "2026-07-27T00:00:00.000Z", conditions: [] };
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("owner review must start PENDING")));
});

test("the verifier rejects a truncated prohibited-action list", () => {
  const request = load("promote-review");
  const result = runStrategyResearchScorecard(request);
  result.prohibitedActions = result.prohibitedActions.filter((action) => action !== "Enable Live Trading");
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("Enable Live Trading")));
});

test("the verifier rejects a manifest that is missing entries or out of canonical order", () => {
  const request = load("promote-review");
  const result = runStrategyResearchScorecard(request);
  result.evidenceManifest = result.evidenceManifest.slice(1);
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("canonical order")));
});

test("the verifier rejects evidence belonging to a different strategy", () => {
  const request = load("promote-review");
  request.manifest.evidence[0].strategyFingerprint = "sma10x40-1m-samecandle-v1";
  const result = runStrategyResearchScorecard(request);
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("different strategy fingerprint")));
});

test("the verifier rejects a missing-evidence entry that produced no blocker", () => {
  const request = load("hold-missing-evidence");
  const result = runStrategyResearchScorecard(request);
  result.blockers = [];
  result.hashes.blockersSha256 = require("../scripts/lib/canonical-hash.js").canonicalHash(result.blockers);
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("produced no blocker")));
});

test("the verifier does not accept a hash recomputed over tampered content", () => {
  const request = load("operational-safety-failure");
  const result = runStrategyResearchScorecard(request);
  result.researchDecision = "PROMOTE_TO_EXTENDED_PAPER_REVIEW";
  const { canonicalHash } = require("../scripts/lib/canonical-hash.js");
  result.hashes.decisionSha256 = canonicalHash({ decision: result.researchDecision, reasons: result.decisionReasons });
  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("PROMOTE decided while")));
});

test("the verifier rejects forged VERIFIED bias controls not present in source evidence", () => {
  const request = load("promote-review");
  const dataset = request.manifest.evidence.find((entry) => entry.evidenceType === "DATASET_QUALITY");
  delete dataset.metrics.selectionBiasControlStatus;
  delete dataset.metrics.survivorshipBiasControlStatus;

  const result = runStrategyResearchScorecard(request);
  const dataIntegrity = result.dimensions.find((dimension) => dimension.id === "D-001");
  dataIntegrity.status = "STRONG";
  dataIntegrity.metrics.selectionBiasControlStatus = "VERIFIED";
  dataIntegrity.metrics.survivorshipBiasControlStatus = "VERIFIED";
  dataIntegrity.blockers = [];
  result.blockers = [];
  result.researchDecision = "PROMOTE_TO_EXTENDED_PAPER_REVIEW";

  const { canonicalHash } = require("../scripts/lib/canonical-hash.js");
  result.hashes.requestSha256 = canonicalHash(request);
  result.hashes.dimensionsSha256 = canonicalHash(result.dimensions);
  result.hashes.blockersSha256 = canonicalHash(result.blockers);
  result.hashes.decisionSha256 = canonicalHash({ decision: result.researchDecision, reasons: result.decisionReasons });

  const verification = verifyScorecard(request, result);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.errors.some((error) => error.includes("original DATASET_QUALITY evidence")));
});

test("a request-level validation failure verifies as a well-formed refusal", () => {
  const request = load("promote-review");
  delete request.policy.requireOperationalPaperSafety;
  const result = runStrategyResearchScorecard(request);
  assert.equal(result.executionStatus, "INVALID");
  assert.equal(verifyScorecard(request, result).status, "PASS");
});

test("a synthetic-evidence file hash mismatch is caught against the real file on disk", (t) => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "scorecard-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = load("promote-review");
  for (const entry of request.manifest.evidence) fs.writeFileSync(path.join(root, entry.resultPath), "{\"tampered\":true}");
  const result = runStrategyResearchScorecard(request, { evidenceRoot: root });
  assert.ok(result.evidenceManifest.every((entry) => entry.fileVerification === "HASH_MISMATCH"));
  assert.equal(result.executionStatus, "BLOCKED");
  assert.equal(verifyScorecard(request, result).status, "PASS");
});
