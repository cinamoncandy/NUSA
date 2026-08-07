const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const REGISTRY_PATH = "config/identity/data-strategy-registry.json";
const CAPABILITY_REGISTRY_PATH = "config/capabilities/registry.json";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function withoutCanonicalHash(record) {
  const { canonicalHash: _ignored, ...identity } = record;
  return identity;
}

function key(record) {
  return `${record.id}@${record.version}`;
}

function validateReference(ref, map, prefix, errors) {
  if (!ref || typeof ref !== "object") {
    errors.push(`${prefix}_REFERENCE_INVALID`);
    return;
  }
  const target = map.get(`${ref.id}@${ref.version}`);
  if (!target) {
    errors.push(`${prefix}_REFERENCE_UNKNOWN:${ref.id || "missing"}@${ref.version || "missing"}`);
    return;
  }
  if (ref.canonicalHash !== target.canonicalHash) errors.push(`${prefix}_REFERENCE_HASH_MISMATCH:${ref.id}@${ref.version}`);
}

function validateRegistry(registry, capabilityRegistry) {
  const errors = [];
  if (!registry || registry.version !== 1) errors.push("IDENTITY_REGISTRY_VERSION_INVALID");
  if (!Array.isArray(registry?.datasets) || !Array.isArray(registry?.featureSets) || !Array.isArray(registry?.strategies)) {
    return { ok: false, errors: ["IDENTITY_REGISTRY_COLLECTIONS_INVALID"] };
  }

  const datasetMap = new Map();
  const featureMap = new Map();
  const strategyMap = new Map();

  for (const dataset of registry.datasets) {
    const k = key(dataset);
    if (datasetMap.has(k)) errors.push(`DATASET_IDENTITY_DUPLICATE:${k}`);
    datasetMap.set(k, dataset);
    if (!dataset.id || !SEMVER.test(dataset.version || "")) errors.push(`DATASET_IDENTITY_INVALID:${k}`);
    if (!dataset.source || !dataset.schemaVersion || !dataset.snapshotId) errors.push(`DATASET_METADATA_MISSING:${k}`);
    if (!Array.isArray(dataset.provenance) || dataset.provenance.length === 0 || dataset.provenance.some((v) => typeof v !== "string" || !v)) errors.push(`DATASET_PROVENANCE_MISSING:${k}`);
    if (!SHA256.test(dataset.contentHash || "")) errors.push(`DATASET_CONTENT_HASH_INVALID:${k}`);
    const temporal = dataset.temporal || {};
    if (!temporal.eventTimeField || !temporal.receivedTimeField || !temporal.modelAvailableTimeField) errors.push(`DATASET_TEMPORAL_FIELDS_MISSING:${k}`);
    if (temporal.ordering !== "EVENT_LE_RECEIVED_LE_MODEL_AVAILABLE") errors.push(`DATASET_POINT_IN_TIME_CONTRACT_INVALID:${k}`);
    if (!SHA256.test(dataset.canonicalHash || "") || canonicalHash(withoutCanonicalHash(dataset)) !== dataset.canonicalHash) errors.push(`DATASET_CANONICAL_HASH_MISMATCH:${k}`);
  }

  for (const feature of registry.featureSets) {
    const k = key(feature);
    if (featureMap.has(k)) errors.push(`FEATURE_IDENTITY_DUPLICATE:${k}`);
    featureMap.set(k, feature);
    if (!feature.id || !SEMVER.test(feature.version || "")) errors.push(`FEATURE_IDENTITY_INVALID:${k}`);
    if (!Array.isArray(feature.definitions) || feature.definitions.length === 0 || feature.definitions.some((d) => !d?.name || !d?.version)) errors.push(`FEATURE_DEFINITIONS_INVALID:${k}`);
    if (feature.availabilitySemantics !== "MODEL_AVAILABLE_TIME") errors.push(`FEATURE_AVAILABILITY_SEMANTICS_INVALID:${k}`);
    if (!Array.isArray(feature.sourceDatasets) || feature.sourceDatasets.length === 0) errors.push(`FEATURE_SOURCE_DATASETS_MISSING:${k}`);
    for (const ref of feature.sourceDatasets || []) validateReference(ref, datasetMap, "FEATURE_DATASET", errors);
    if (!SHA256.test(feature.canonicalHash || "") || canonicalHash(withoutCanonicalHash(feature)) !== feature.canonicalHash) errors.push(`FEATURE_CANONICAL_HASH_MISMATCH:${k}`);
  }

  const capabilityContracts = new Set((capabilityRegistry?.contracts || []).map((c) => `${c.capabilityId}@${c.contractVersion}`));
  const implementations = new Set((capabilityRegistry?.implementations || []).map((i) => `${i.implementationId}|${i.capabilityId}@${i.contractVersion}`));

  for (const strategy of registry.strategies) {
    const k = key(strategy);
    if (strategyMap.has(k)) errors.push(`STRATEGY_IDENTITY_DUPLICATE:${k}`);
    strategyMap.set(k, strategy);
    if (!strategy.id || !SEMVER.test(strategy.version || "")) errors.push(`STRATEGY_IDENTITY_INVALID:${k}`);
    if (!strategy.genome || typeof strategy.genome !== "object" || !strategy.parameters || typeof strategy.parameters !== "object") errors.push(`STRATEGY_DEFINITION_INVALID:${k}`);
    for (const ref of strategy.featureSets || []) validateReference(ref, featureMap, "STRATEGY_FEATURE", errors);
    for (const ref of strategy.datasets || []) validateReference(ref, datasetMap, "STRATEGY_DATASET", errors);
    if (!Array.isArray(strategy.capabilities)) errors.push(`STRATEGY_CAPABILITIES_INVALID:${k}`);
    for (const cap of strategy.capabilities || []) {
      const capKey = `${cap.id}@${cap.contractVersion}`;
      if (!capabilityContracts.has(capKey)) errors.push(`STRATEGY_CAPABILITY_UNKNOWN:${capKey}`);
      if (cap.implementationId && !implementations.has(`${cap.implementationId}|${capKey}`)) errors.push(`STRATEGY_IMPLEMENTATION_UNKNOWN:${cap.implementationId}|${capKey}`);
    }
    if (!Array.isArray(strategy.models) || !Array.isArray(strategy.tools) || !strategy.objectivePolicyVersion) errors.push(`STRATEGY_VERSION_REFERENCES_INVALID:${k}`);
    if (!SHA256.test(strategy.canonicalHash || "") || canonicalHash(withoutCanonicalHash(strategy)) !== strategy.canonicalHash) errors.push(`STRATEGY_CANONICAL_HASH_MISMATCH:${k}`);
  }

  return { ok: errors.length === 0, errors };
}

function validateRegistryFile(root = process.cwd()) {
  const registry = JSON.parse(readFileSync(join(root, REGISTRY_PATH), "utf8"));
  const capabilityRegistry = JSON.parse(readFileSync(join(root, CAPABILITY_REGISTRY_PATH), "utf8"));
  return validateRegistry(registry, capabilityRegistry);
}

if (require.main === module) {
  const result = validateRegistryFile();
  if (!result.ok) {
    console.error("Data & Strategy Identity validation FAILED");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Data & Strategy Identity validation PASS");
}

module.exports = { REGISTRY_PATH, canonicalJson, canonicalHash, validateRegistry, validateRegistryFile };
