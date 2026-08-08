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
  const gate = read("apps/cloud/src/researchCandidateGate.ts");
  if (!gate.includes("automaticPromotion: false") || !gate.includes("HOLDOUT_REQUIRED") || !gate.includes("INSUFFICIENT_INDEPENDENT_WINDOWS")) failures.push("VERSIONED_RESEARCH_EVIDENCE");
  const hardening = read("packages/contracts/src/researchHardening.ts");
  for (const invariant of ["finalHoldoutUntouched", "datasetContentSha256", "sourceCommitSha", "randomSeed", "canonicalInputHash"]) if (!hardening.includes(invariant)) failures.push(`PROVENANCE_${invariant}`);
  if (!existsSync(join(root, "packages/storage/src/researchHypothesisLifecycle.ts"))) failures.push("HYPOTHESIS_LIFECYCLE");
  if (!existsSync(join(root, "packages/storage/src/migrations/014_research_hypothesis_events.sql")) && !read("packages/storage/src/index.ts").includes("014_research_hypothesis_events")) failures.push("HYPOTHESIS_MIGRATION");
  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validate();
  console.log(`Research architecture guard: ${result.ok ? "PASS" : "FAIL"}`);
  if (!result.ok) { console.error(result.failures.join("\n")); process.exit(1); }
}

module.exports = { validate };
