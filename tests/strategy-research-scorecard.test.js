const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { canonicalHash } = require("../scripts/lib/canonical-hash.js");
const {
  REQUIRED_EVIDENCE_TYPES,
  CANONICAL_PROMOTION_AUTHORITY,
  createStrategyResearchScorecard
} = require("../scripts/lib/strategy-research-scorecard.js");
const { verifyStrategyResearchScorecard } = require("../scripts/lib/strategy-research-scorecard-verifier.js");

const identity = {
  strategyId: "sma",
  strategyVersion: "1",
  datasetId: "set",
  datasetVersion: "1",
  executionId: "run",
  riskProfileId: "risk"
};

function request() {
  return {
    scorecardId: "card",
    identity,
    evaluatedAtMs: 1,
    evidence: REQUIRED_EVIDENCE_TYPES.map((type) => {
      const payload = { sampleSufficiency: "PASS", benchmarkCompetitiveness: "PASS" };
      return {
        evidenceId: type,
        type,
        source: "REAL",
        assessment: "PASS",
        identity,
        payload,
        payloadSha256: canonicalHash(payload)
      };
    })
  };
}

test("sealed real evidence creates a deterministic provenance-only scorecard", () => {
  const input = request();
  const card = createStrategyResearchScorecard(input);
  assert.equal(card.readiness, "READY_FOR_CANONICAL_GATE_EVALUATION");
  assert.equal(card.canonicalPromotionAuthority, CANONICAL_PROMOTION_AUTHORITY);
  assert.equal(card.productionMutationAllowed, false);
  assert.equal(card.promotionAuthority, false);
  assert.equal(Object.prototype.hasOwnProperty.call(card, "decision"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(card, "researchDecision"), false);
  assert.equal(verifyStrategyResearchScorecard(input, card).status, "PASS");
  assert.deepEqual(card, createStrategyResearchScorecard({ ...input, evidence: [...input.evidence].reverse() }));
});

test("missing, unverified, synthetic, tampered, and mismatched evidence fail closed as readiness", () => {
  const missing = request();
  missing.evidence.pop();
  assert.equal(createStrategyResearchScorecard(missing).readiness, "INCOMPLETE_EVIDENCE");

  const unverified = request();
  delete unverified.evidence[0].payloadSha256;
  assert.equal(createStrategyResearchScorecard(unverified).readiness, "INCOMPLETE_EVIDENCE");

  const synthetic = request();
  synthetic.evidence.forEach((item) => { item.source = "SYNTHETIC"; });
  assert.equal(createStrategyResearchScorecard(synthetic).readiness, "SYNTHETIC_ONLY");

  const tampered = request();
  tampered.evidence[0].payload = {};
  assert.equal(createStrategyResearchScorecard(tampered).readiness, "INVALID_EVIDENCE");

  const mismatched = request();
  mismatched.evidence[0].identity = { ...identity, executionId: "other" };
  assert.equal(createStrategyResearchScorecard(mismatched).readiness, "INVALID_EVIDENCE");
});

test("declared failures and unresolved research remain non-authoritative readiness facts", () => {
  const failed = request();
  failed.evidence.find((item) => item.type === "REGIME_ANALYSIS").assessment = "FAIL";
  assert.equal(createStrategyResearchScorecard(failed).readiness, "FAILED_RESEARCH_DIMENSION");

  const blocked = request();
  blocked.evidence.find((item) => item.type === "WALK_FORWARD").assessment = "INCONCLUSIVE";
  assert.equal(createStrategyResearchScorecard(blocked).readiness, "UNRESOLVED_RESEARCH_DIMENSION");
});

test("verifier rejects any compatibility artifact that reintroduces a promotion decision", () => {
  const input = request();
  const card = createStrategyResearchScorecard(input);
  const tampered = { ...card, decision: "PROMOTE_TO_EXTENDED_PAPER_REVIEW" };
  const verification = verifyStrategyResearchScorecard(input, tampered);
  assert.equal(verification.status, "FAIL");
  assert.match(verification.errors.join("\n"), /must not emit a promotion decision/);
});

test("CLI emits a verifiable provenance artifact once and refuses overwrite", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scorecard-"));
  const input = path.join(directory, "request.json");
  const output = path.join(directory, "result.json");
  fs.writeFileSync(input, JSON.stringify(request()));
  const first = spawnSync(process.execPath, ["scripts/run-strategy-research-scorecard.js", "--request", input, "--output", output], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const result = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(result.verification.status, "PASS");
  assert.equal(result.scorecard.canonicalPromotionAuthority, CANONICAL_PROMOTION_AUTHORITY);
  assert.equal(Object.prototype.hasOwnProperty.call(result.scorecard, "decision"), false);
  const second = spawnSync(process.execPath, ["scripts/run-strategy-research-scorecard.js", "--request", input, "--output", output], { encoding: "utf8" });
  assert.equal(second.status, 1);
  fs.rmSync(directory, { recursive: true, force: true });
});
