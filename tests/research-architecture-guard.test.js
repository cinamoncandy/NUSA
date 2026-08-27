const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validate } = require("../scripts/validate-research-architecture.js");

test("research architecture guard enforces one owner promotion path and hardened evidence", () => { const result = validate(process.cwd()); assert.equal(result.ok, true, result.failures.join(",")); });

// Exactly the files the guard reads. Enumerated rather than deep-copying whole directories so the
// negative cases stay fast; a missing entry surfaces immediately as a guard failure on the
// unmodified-copy test below rather than passing silently.
const GUARD_INPUTS = [
  "apps/cloud/src/championChallengerManager.ts",
  "apps/cloud/src/strategyGovernanceService.ts",
  "apps/cloud/src/researchAutomationRuntime.ts",
  "apps/cloud/src/researchCandidateGate.ts",
  "packages/contracts/src/researchHardening.ts",
  "packages/storage/src/researchHypothesisLifecycle.ts",
  "packages/storage/src/index.ts",
  "packages/storage/src/migrations/014_research_hypothesis_events.sql",
  "apps/desktop/src/cloud/nusaLeague.ts",
  "apps/desktop/src/cloud/candidateFailureAttribution.ts",
  "apps/desktop/src/cloud/promotionEvidenceAdvisory.ts",
  "apps/desktop/src/cloud/shadowAllocationEvaluation.ts",
  "apps/desktop/src/cloud/researchFeedbackDigest.ts",
  "apps/desktop/src/cloud/leagueCapitalAllocation.ts",
  "apps/desktop/src/cloud/persistedPaperPeriodAdapter.ts",
];

/**
 * Mirrors the guard's inputs into a scratch directory so a violation can be introduced and the
 * guard exercised against it. Asserting only the passing case would let the guard silently rot
 * into a no-op -- a guard that cannot be shown to fail is not evidence of anything.
 */
function withMutatedRepository(relativePath, mutate, assertion) {
  const root = process.cwd();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-guard-"));
  try {
    for (const input of GUARD_INPUTS) {
      const source = path.join(root, input);
      if (!fs.existsSync(source)) continue;
      const destination = path.join(scratch, input);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    const target = path.join(scratch, relativePath);
    fs.writeFileSync(target, mutate(fs.readFileSync(target, "utf8")), "utf8");
    assertion(validate(scratch));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("guard passes on an unmodified mirror, so the negative cases prove the mutation not the mirror", () => {
  withMutatedRepository(
    "apps/desktop/src/cloud/nusaLeague.ts",
    (source) => source,
    (result) => assert.equal(result.ok, true, result.failures.join(",")),
  );
});

test("guard rejects an evidence judge feeding back into the League scoring core", () => {
  // A candidate's score must never depend on a judgement derived from that same score.
  withMutatedRepository(
    "apps/desktop/src/cloud/nusaLeague.ts",
    (source) => `import { attributeCandidateFailures } from "./candidateFailureAttribution";\n${source}`,
    (result) => {
      assert.equal(result.ok, false, "the guard must reject a self-confirming feedback import");
      assert.ok(
        result.failures.includes("EVIDENCE_JUDGE_FEEDBACK_INTO_SCORING_CORE_candidateFailureAttribution"),
        result.failures.join(","),
      );
    },
  );
});

test("guard rejects an evidence judge acquiring execution or promotion authority", () => {
  withMutatedRepository(
    "apps/desktop/src/cloud/promotionEvidenceAdvisory.ts",
    (source) => `${source}\nconst liveAuthority = "GRANTED";\n`,
    (result) => {
      assert.equal(result.ok, false, "the guard must reject authority leaking into a research judge");
      assert.ok(
        result.failures.includes("RESEARCH_JUDGE_AUTHORITY_promotionEvidenceAdvisory_liveAuthority"),
        result.failures.join(","),
      );
    },
  );
});
