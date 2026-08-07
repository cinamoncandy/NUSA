const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const RECOMMENDATIONS = new Set(["KEEP_CHAMPION", "PROMOTE_CHALLENGER", "REJECT_CHALLENGER", "INCONCLUSIVE"]);
const LINEAGE_DIMENSIONS = ["model", "provider", "data", "tools", "implementation"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function equalValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function actualLineageDifferences(champion, challenger) {
  return LINEAGE_DIMENSIONS.filter((dimension) => !equalValue(champion.lineage?.[dimension], challenger.lineage?.[dimension]));
}

function validateDocument(document, capabilityRegistry) {
  const failures = [];
  const policy = document?.policy ?? {};
  const expectedPolicy = {
    self_evaluation: "prohibited",
    self_promotion: "prohibited",
    meta_ai_final_evaluation_authority: "prohibited",
    production_mutation: "prohibited",
    sealed_dataset_mutation_after_registration: "prohibited"
  };
  for (const [key, expected] of Object.entries(expectedPolicy)) {
    if (policy[key] !== expected) failures.push(`POLICY_INVALID:${key}`);
  }

  const contracts = new Set((capabilityRegistry?.contracts ?? []).map((entry) => `${entry.capabilityId}@${entry.contractVersion}`));
  const ids = new Set();
  for (const entry of document?.evaluations ?? []) {
    if (!entry.id || ids.has(entry.id)) failures.push(`EVALUATION_ID_INVALID:${entry.id || "missing"}`);
    ids.add(entry.id);

    const contractKey = `${entry.capability_id}@${entry.contract_version}`;
    if (!contracts.has(contractKey)) failures.push(`UNKNOWN_CAPABILITY_CONTRACT:${contractKey}`);
    if (!entry.champion?.id || !entry.challenger?.id || entry.champion.id === entry.challenger.id) {
      failures.push(`CANDIDATE_IDENTITY_INVALID:${entry.id}`);
    }

    for (const side of ["champion", "challenger"]) {
      const candidate = entry[side];
      if (!candidate?.implementation_version) failures.push(`IMPLEMENTATION_VERSION_MISSING:${entry.id}:${side}`);
      if (!candidate?.lineage?.implementation) failures.push(`LINEAGE_IMPLEMENTATION_MISSING:${entry.id}:${side}`);
      if (!Array.isArray(candidate?.lineage?.data)) failures.push(`LINEAGE_DATA_INVALID:${entry.id}:${side}`);
      if (!Array.isArray(candidate?.lineage?.tools)) failures.push(`LINEAGE_TOOLS_INVALID:${entry.id}:${side}`);
    }

    const differences = actualLineageDifferences(entry.champion ?? {}, entry.challenger ?? {});
    const declared = entry.lineage_independence?.differing_dimensions ?? [];
    if (!Array.isArray(declared) || declared.length === 0) failures.push(`LINEAGE_INDEPENDENCE_MISSING:${entry.id}`);
    if (JSON.stringify([...declared].sort()) !== JSON.stringify([...differences].sort())) {
      failures.push(`LINEAGE_INDEPENDENCE_MISMATCH:${entry.id}`);
    }
    if (differences.length === 0) failures.push(`CHALLENGER_NOT_INDEPENDENT:${entry.id}`);

    const evaluation = entry.evaluation ?? {};
    for (const datasetName of ["benchmark", "holdout"]) {
      const dataset = evaluation[datasetName];
      if (!dataset?.id || !dataset?.version || !/^sha256:[a-f0-9]{64}$/.test(dataset?.content_hash ?? "")) {
        failures.push(`SEALED_DATASET_IDENTITY_INVALID:${entry.id}:${datasetName}`);
      }
      if (dataset?.mutable_after_registration !== false) failures.push(`SEALED_DATASET_MUTABLE:${entry.id}:${datasetName}`);
      if (dataset?.accessible_to_candidate_during_evaluation !== false) failures.push(`SEALED_DATASET_EXPOSED:${entry.id}:${datasetName}`);
    }
    if (evaluation.benchmark?.content_hash && evaluation.benchmark?.content_hash === evaluation.holdout?.content_hash) {
      failures.push(`BENCHMARK_HOLDOUT_NOT_SEPARATE:${entry.id}`);
    }

    const authority = evaluation.authority ?? {};
    const authorities = [authority.proposer_id, authority.evaluator_id, authority.promotion_authority_id];
    if (authorities.some((value) => !value)) failures.push(`AUTHORITY_ID_MISSING:${entry.id}`);
    if (new Set(authorities).size !== authorities.length) failures.push(`AUTHORITY_NOT_SEPARATED:${entry.id}`);
    if ([entry.champion?.id, entry.challenger?.id].includes(authority.evaluator_id)) failures.push(`SELF_EVALUATION:${entry.id}`);
    if ([entry.champion?.id, entry.challenger?.id].includes(authority.promotion_authority_id)) failures.push(`SELF_PROMOTION:${entry.id}`);
    if (authority.meta_ai_proposer === true && authority.proposer_id === authority.evaluator_id) failures.push(`META_AI_SELF_EVALUATION:${entry.id}`);
    if (authority.meta_ai_proposer === true && authority.proposer_id === authority.promotion_authority_id) failures.push(`META_AI_SELF_PROMOTION:${entry.id}`);

    if (!evaluation.code_revision) failures.push(`CODE_REVISION_MISSING:${entry.id}`);
    if (!/^sha256:[a-f0-9]{64}$/.test(evaluation.configuration_hash ?? "")) failures.push(`CONFIGURATION_HASH_INVALID:${entry.id}`);
    if (!evaluation.metrics || Object.keys(evaluation.metrics).length === 0) failures.push(`METRICS_MISSING:${entry.id}`);
    if (!Array.isArray(evaluation.failure_semantics) || evaluation.failure_semantics.length === 0) failures.push(`FAILURE_SEMANTICS_MISSING:${entry.id}`);
    if (!RECOMMENDATIONS.has(evaluation.recommendation)) failures.push(`RECOMMENDATION_INVALID:${entry.id}`);
    if (!Array.isArray(evaluation.provenance) || evaluation.provenance.length === 0) failures.push(`PROVENANCE_MISSING:${entry.id}`);
  }

  if (!Array.isArray(document?.evaluations) || document.evaluations.length === 0) failures.push("EVALUATIONS_MISSING");
  return { ok: failures.length === 0, failures };
}

function validateRepository(root = process.cwd()) {
  const researchPath = join(root, "config/research/champion-challenger.json");
  const capabilityPath = join(root, "config/capabilities/registry.json");
  if (!existsSync(researchPath)) return { ok: false, failures: ["RESEARCH_REGISTRY_MISSING"] };
  if (!existsSync(capabilityPath)) return { ok: false, failures: ["CAPABILITY_REGISTRY_MISSING"] };
  return validateDocument(readJson(researchPath), readJson(capabilityPath));
}

if (require.main === module) {
  const result = validateRepository();
  if (!result.ok) {
    console.error("Champion/Challenger governance validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Champion/Challenger governance validation PASS");
}

module.exports = { actualLineageDifferences, validateDocument, validateRepository };
