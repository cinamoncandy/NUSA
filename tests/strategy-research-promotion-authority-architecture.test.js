const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const scorecardPath = path.join(repoRoot, "scripts/lib/strategy-research-scorecard.js");
const verifierPath = path.join(repoRoot, "scripts/lib/strategy-research-scorecard-verifier.js");
const runnerPath = path.join(repoRoot, "scripts/lib/strategy-research-promotion-gate-runner.js");

function source(file) {
  return fs.readFileSync(file, "utf8");
}

test("WO-0031 has one canonical research promotion decision authority", () => {
  const scorecard = source(scorecardPath);
  const verifier = source(verifierPath);
  const runner = source(runnerPath);

  assert.match(scorecard, /canonicalPromotionAuthority:\s*CANONICAL_PROMOTION_AUTHORITY/);
  assert.match(scorecard, /promotionAuthority:\s*false/);
  assert.match(scorecard, /productionMutationAllowed:\s*false/);
  assert.doesNotMatch(scorecard, /\bdecision\s*[:,]/);
  assert.doesNotMatch(scorecard, /\bresearchDecision\s*[:,]/);
  assert.match(verifier, /must not emit a promotion decision/);

  assert.match(runner, /researchDecision/);
  assert.match(runner, /PROMOTE_TO_EXTENDED_PAPER_REVIEW/);
});

test("legacy scorecard names the promotion-gate runner rather than itself", () => {
  const scorecard = require("../scripts/lib/strategy-research-scorecard.js");
  assert.equal(scorecard.CANONICAL_PROMOTION_AUTHORITY, "strategy-research-promotion-gate-runner");
});
