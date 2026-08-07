const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const HASH = /^sha256:[0-9a-f]{64}$/;

function loadJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function validateDeploymentBundles(root = process.cwd()) {
  const failures = [];
  const registry = loadJson(root, "config/deployment/bundles.json");
  const capabilities = loadJson(root, "config/capabilities/registry.json");

  if (registry.schema !== "nusa.deployment-bundle-registry/v1") failures.push("DEPLOYMENT_SCHEMA_INVALID");
  if (!Array.isArray(registry.bundles) || registry.bundles.length === 0) failures.push("DEPLOYMENT_BUNDLES_MISSING");

  const capabilityContracts = new Set((capabilities.contracts || []).map((c) => `${c.capabilityId}@${c.contractVersion}`));
  const implementations = new Set((capabilities.implementations || []).map((i) => `${i.implementationId}@${i.implementationVersion}`));
  const byId = new Map();

  for (const bundle of registry.bundles || []) {
    if (!bundle.bundleId || byId.has(bundle.bundleId)) failures.push(`BUNDLE_ID_DUPLICATE:${bundle.bundleId || "missing"}`);
    byId.set(bundle.bundleId, bundle);
    if (!capabilityContracts.has(`${bundle.capabilityId}@${bundle.contractVersion}`)) failures.push(`BUNDLE_CAPABILITY_UNKNOWN:${bundle.bundleId}`);
    if (!implementations.has(`${bundle.implementationId}@${bundle.implementationVersion}`)) failures.push(`BUNDLE_IMPLEMENTATION_UNKNOWN:${bundle.bundleId}`);
    if (!HASH.test(bundle.configHash || "")) failures.push(`BUNDLE_CONFIG_HASH_INVALID:${bundle.bundleId}`);
    if (!bundle.artifact?.artifactId || !HASH.test(bundle.artifact?.sha256 || "")) failures.push(`BUNDLE_ARTIFACT_INVALID:${bundle.bundleId}`);
    if (!Array.isArray(bundle.datasetIdentities) || !Array.isArray(bundle.featureSetIdentities) || !Array.isArray(bundle.modelRefs) || !Array.isArray(bundle.promptRefs) || !Array.isArray(bundle.toolRefs) || !Array.isArray(bundle.policyRefs)) failures.push(`BUNDLE_COMPONENT_SET_INVALID:${bundle.bundleId}`);
    if (!bundle.compatibility?.rollbackReady) failures.push(`BUNDLE_ROLLBACK_NOT_READY:${bundle.bundleId}`);
    if (!Array.isArray(bundle.compatibility?.compatibleWith) || bundle.compatibility.compatibleWith.length === 0) failures.push(`BUNDLE_COMPATIBILITY_MISSING:${bundle.bundleId}`);
  }

  for (const bundle of registry.bundles || []) {
    if (!bundle.rollbackBundleId) continue;
    if (bundle.rollbackBundleId === bundle.bundleId) failures.push(`ROLLBACK_SELF_REFERENCE:${bundle.bundleId}`);
    const target = byId.get(bundle.rollbackBundleId);
    if (!target) {
      failures.push(`ROLLBACK_TARGET_UNKNOWN:${bundle.bundleId}`);
      continue;
    }
    if (target.status !== "VERIFIED") failures.push(`ROLLBACK_TARGET_NOT_VERIFIED:${bundle.bundleId}:${target.bundleId}`);
    if (target.capabilityId !== bundle.capabilityId || target.contractVersion !== bundle.contractVersion) failures.push(`ROLLBACK_TARGET_INCOMPATIBLE:${bundle.bundleId}:${target.bundleId}`);
  }

  const promotionBundleIds = new Set();
  for (const promotion of registry.promotions || []) {
    if (promotionBundleIds.has(promotion.bundleId)) failures.push(`PROMOTION_DUPLICATE:${promotion.bundleId}`);
    promotionBundleIds.add(promotion.bundleId);
    const bundle = byId.get(promotion.bundleId);
    if (!bundle) {
      failures.push(`PROMOTION_BUNDLE_UNKNOWN:${promotion.bundleId}`);
      continue;
    }
    if (promotion.productionMutationAuthorized !== false) failures.push(`PRODUCTION_MUTATION_AUTHORITY_PROHIBITED:${promotion.bundleId}`);
    if (!HASH.test(promotion.promotionArtifactSha256 || "") || !HASH.test(promotion.runtimeArtifactSha256 || "")) failures.push(`PROMOTION_ARTIFACT_HASH_INVALID:${promotion.bundleId}`);
    if (promotion.promotionArtifactSha256 !== bundle.artifact.sha256) failures.push(`PROMOTION_ARTIFACT_BUNDLE_MISMATCH:${promotion.bundleId}`);
    if (promotion.runtimeArtifactSha256 !== promotion.promotionArtifactSha256) failures.push(`PROMOTION_RUNTIME_ARTIFACT_MISMATCH:${promotion.bundleId}`);
    if (promotion.recommendation === "PROMOTE" && !bundle.rollbackBundleId) failures.push(`PROMOTION_ROLLBACK_TARGET_MISSING:${promotion.bundleId}`);
  }

  return { ok: failures.length === 0, failures, bundles: registry.bundles?.length || 0, promotions: registry.promotions?.length || 0 };
}

if (require.main === module) {
  const result = validateDeploymentBundles();
  if (!result.ok) {
    console.error("Deployment bundle validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Deployment bundle validation PASS (${result.bundles} bundles, ${result.promotions} promotion records)`);
}

module.exports = { validateDeploymentBundles };
