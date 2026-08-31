const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

function validate(root = process.cwd()) {
  const read = (file) => readFileSync(join(root, file), "utf8");
  const failures = [];
  const legacy = read("apps/cloud/src/championChallengerManager.ts");
  if (/promoteChampion\s*\(/.test(legacy)) failures.push("SINGLE_CHAMPION_MUTATION_AUTHORITY");
  const service = read("apps/cloud/src/strategyGovernanceService.ts");
  if (!service.includes("champion mutation requires CandidatePromotionRuntime owner command")) failures.push("CANONICAL_LIFECYCLE");
  const automation = read("apps/cloud/src/researchAutomationRuntime.ts");
  if (!automation.includes("ResearchCandidateGate") || !automation.includes("this.candidateGate.evaluate")) failures.push("CANDIDATE_GATE_NOT_CONNECTED");
  if (!automation.includes("ResearchStreamNormalizer") || !automation.includes("this.streamNormalizer.accept")) failures.push("RESEARCH_BOUNDED_QUEUE");
  const researchFactory = read("apps/desktop/src/cloud/researchRunFactory.ts");
  if (!existsSync(join(root, "apps/desktop/src/cloud/researchHypothesisAdmission.ts")) || !researchFactory.includes("admitCanonicalResearchHypothesis")) {
    failures.push("CANONICAL_HYPOTHESIS_ADMISSION_NOT_CONNECTED");
  }
  const hypothesisAdmission = read("apps/desktop/src/cloud/researchHypothesisAdmission.ts");
  if (!researchFactory.includes("canonicalHypothesisHash") || !hypothesisAdmission.includes("HYPOTHESIS_PRECOMMITMENT_MISMATCH")) {
    failures.push("CANONICAL_HYPOTHESIS_PROVENANCE_NOT_BOUND");
  }
  const leagueBridge = read("apps/desktop/src/cloud/researchRunLeagueBridge.ts");
  if (!leagueBridge.includes("admitCanonicalResearchHypothesis") || !leagueBridge.includes("CANONICAL_HYPOTHESIS_HASH_MISMATCH")) {
    failures.push("CANONICAL_HYPOTHESIS_NOT_CARRIED_TO_LEAGUE");
  }
  const realResearchRunPath = join(root, "scripts/research-real-market-run.js");
  if (existsSync(realResearchRunPath)) {
    const realResearchRun = read("scripts/research-real-market-run.js");
    if (!realResearchRun.includes("createResearchHypothesis") || !realResearchRun.includes("canonicalHypothesis")) {
      failures.push("REAL_RESEARCH_RUN_CANONICAL_HYPOTHESIS_NOT_WIRED");
    }
  }
  const gate = read("apps/cloud/src/researchCandidateGate.ts");
  if (!gate.includes("automaticPromotion: false") || !gate.includes("HOLDOUT_REQUIRED") || !gate.includes("INSUFFICIENT_INDEPENDENT_WINDOWS")) failures.push("VERSIONED_RESEARCH_EVIDENCE");
  const hardening = read("packages/contracts/src/researchHardening.ts");
  for (const invariant of ["finalHoldoutUntouched", "datasetContentSha256", "sourceCommitSha", "randomSeed", "canonicalInputHash"]) if (!hardening.includes(invariant)) failures.push(`PROVENANCE_${invariant}`);
  if (!existsSync(join(root, "packages/storage/src/researchHypothesisLifecycle.ts"))) failures.push("HYPOTHESIS_LIFECYCLE");
  if (!existsSync(join(root, "packages/storage/src/migrations/014_research_hypothesis_events.sql")) && !read("packages/storage/src/index.ts").includes("014_research_hypothesis_events")) failures.push("HYPOTHESIS_MIGRATION");

  // Evidence-judge independence: Creator != Evaluator != Risk Gate != Evidence Judge.
  //
  // nusaLeague.ts is the scoring core. Every module listed below reads a League standing to
  // produce a downstream judgement -- failure attribution, promotion evidence strength, shadow
  // allocation outcome, bounded learning priors, capital-allocation advice. If the scoring core
  // ever imports one of them, a candidate's score begins depending on a judgement derived from
  // that same score: a self-confirming loop, and exactly the feedback that must not exist without
  // independent verification.
  //
  // Import direction is the invariant. It is checked here rather than in the per-module tests
  // because those assert on serialized output fields and would all still pass if the import were
  // added.
  const evidenceJudges = [
    "candidateFailureAttribution",
    "promotionEvidenceAdvisory",
    "shadowAllocationEvaluation",
    "researchFeedbackDigest",
    "leagueCapitalAllocation",
    "persistedPaperPeriodAdapter"
  ];
  const scoringCorePath = "apps/desktop/src/cloud/nusaLeague.ts";
  if (existsSync(join(root, scoringCorePath))) {
    const scoringCore = read(scoringCorePath);
    for (const judge of evidenceJudges) {
      if (scoringCore.includes(`./${judge}"`) || scoringCore.includes(`./${judge}'`)) {
        failures.push(`EVIDENCE_JUDGE_FEEDBACK_INTO_SCORING_CORE_${judge}`);
      }
    }
  }

  // Those same modules must not acquire execution or promotion authority as they gain callers.
  const authorityTokens = ["liveAuthority", "productionMutationAllowed", "promoteChampion", "placeOrder", "submitOrder"];
  for (const judge of evidenceJudges) {
    const judgePath = `apps/desktop/src/cloud/${judge}.ts`;
    if (!existsSync(join(root, judgePath))) continue;
    const source = read(judgePath);
    for (const token of authorityTokens) {
      if (source.includes(token)) failures.push(`RESEARCH_JUDGE_AUTHORITY_${judge}_${token}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validate();
  console.log(`Research architecture guard: ${result.ok ? "PASS" : "FAIL"}`);
  if (!result.ok) { console.error(result.failures.join("\n")); process.exit(1); }
}

module.exports = { validate };
