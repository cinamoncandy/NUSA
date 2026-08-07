const { existsSync, readFileSync } = require("node:fs");
const { join, normalize } = require("node:path");

const REGISTRY_PATH = "config/capabilities/registry.json";
const SEMVER = /^\d+\.\d+\.\d+$/;
const CAPABILITY_ID = /^[A-Z][A-Z0-9_]*$/;
const PROVIDER_TOKENS = Object.freeze(["OPENAI", "ANTHROPIC", "CLAUDE", "GOOGLE", "GEMINI", "GPT", "AZURE", "AWS", "BEDROCK"]);
const FAILURE_MODES = new Set(["FAIL_CLOSED", "DEGRADE", "RETRY"]);
const IMPLEMENTATION_STATUSES = new Set(["CHALLENGER", "APPROVED", "RETIRED"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRegistry(root = process.cwd(), registryPath = REGISTRY_PATH) {
  const failures = [];
  const absoluteRegistryPath = join(root, normalize(registryPath));
  if (!existsSync(absoluteRegistryPath)) return { ok: false, failures: [`CAPABILITY_REGISTRY_MISSING:${registryPath}`] };

  let registry;
  try {
    registry = JSON.parse(readFileSync(absoluteRegistryPath, "utf8"));
  } catch {
    return { ok: false, failures: [`CAPABILITY_REGISTRY_MALFORMED_JSON:${registryPath}`] };
  }

  if (registry.version !== 1) failures.push("CAPABILITY_REGISTRY_VERSION_INVALID");
  if (!Array.isArray(registry.contracts) || registry.contracts.length === 0) failures.push("CAPABILITY_CONTRACTS_MISSING");
  if (!Array.isArray(registry.implementations)) failures.push("CAPABILITY_IMPLEMENTATIONS_INVALID");

  const contractKeys = new Set();
  for (const [index, contract] of (registry.contracts || []).entries()) {
    const prefix = `contract[${index}]`;
    const capabilityId = contract?.capabilityId;
    const contractVersion = contract?.contractVersion;
    if (!CAPABILITY_ID.test(capabilityId || "")) failures.push(`${prefix}:CAPABILITY_ID_INVALID`);
    if (PROVIDER_TOKENS.some((token) => (capabilityId || "").includes(token))) failures.push(`${prefix}:PROVIDER_SPECIFIC_CAPABILITY_ID`);
    if (!SEMVER.test(contractVersion || "")) failures.push(`${prefix}:CONTRACT_VERSION_INVALID`);

    const key = `${capabilityId}@${contractVersion}`;
    if (contractKeys.has(key)) failures.push(`${prefix}:DUPLICATE_CAPABILITY_CONTRACT:${key}`);
    contractKeys.add(key);

    for (const schemaKind of ["input", "output"]) {
      const schemaPath = contract?.schemas?.[schemaKind];
      if (!nonEmptyString(schemaPath)) {
        failures.push(`${prefix}:SCHEMA_REFERENCE_MISSING:${schemaKind}`);
      } else if (!existsSync(join(root, normalize(schemaPath)))) {
        failures.push(`${prefix}:SCHEMA_REFERENCE_NOT_FOUND:${schemaKind}:${schemaPath}`);
      }
    }

    const failure = contract?.failure;
    if (!FAILURE_MODES.has(failure?.mode)) failures.push(`${prefix}:FAILURE_MODE_INVALID`);
    if (!Number.isInteger(failure?.timeoutMs) || failure.timeoutMs <= 0) failures.push(`${prefix}:TIMEOUT_INVALID`);
    if (typeof failure?.retryable !== "boolean") failures.push(`${prefix}:RETRYABLE_INVALID`);
    if (typeof failure?.unknownIsFailure !== "boolean") failures.push(`${prefix}:UNKNOWN_SEMANTICS_INVALID`);

    if (!Array.isArray(contract?.permissions)) failures.push(`${prefix}:PERMISSIONS_INVALID`);
    else if (contract.permissions.some((permission) => !nonEmptyString(permission))) failures.push(`${prefix}:PERMISSION_EMPTY`);

    const evidence = contract?.evidence;
    for (const field of ["provenanceRequired", "implementationVersionRequired", "inputVersionRequired", "outputHashRequired"]) {
      if (evidence?.[field] !== true) failures.push(`${prefix}:EVIDENCE_REQUIREMENT_NOT_ENFORCED:${field}`);
    }

    if (!Array.isArray(contract?.rollbackCompatibleWith) || contract.rollbackCompatibleWith.length === 0) {
      failures.push(`${prefix}:ROLLBACK_COMPATIBILITY_MISSING`);
    } else {
      if (!contract.rollbackCompatibleWith.includes(contractVersion)) failures.push(`${prefix}:SELF_ROLLBACK_VERSION_MISSING`);
      if (contract.rollbackCompatibleWith.some((version) => !SEMVER.test(version))) failures.push(`${prefix}:ROLLBACK_VERSION_INVALID`);
    }
  }

  const implementationIds = new Set();
  for (const [index, binding] of (registry.implementations || []).entries()) {
    const prefix = `implementation[${index}]`;
    if (!nonEmptyString(binding?.implementationId)) failures.push(`${prefix}:IMPLEMENTATION_ID_MISSING`);
    else if (implementationIds.has(binding.implementationId)) failures.push(`${prefix}:DUPLICATE_IMPLEMENTATION_ID:${binding.implementationId}`);
    else implementationIds.add(binding.implementationId);

    const key = `${binding?.capabilityId}@${binding?.contractVersion}`;
    if (!contractKeys.has(key)) failures.push(`${prefix}:UNKNOWN_CAPABILITY_CONTRACT:${key}`);
    if (!nonEmptyString(binding?.provider)) failures.push(`${prefix}:PROVIDER_MISSING`);
    if (!SEMVER.test(binding?.implementationVersion || "")) failures.push(`${prefix}:IMPLEMENTATION_VERSION_INVALID`);
    if (!IMPLEMENTATION_STATUSES.has(binding?.status)) failures.push(`${prefix}:IMPLEMENTATION_STATUS_INVALID`);
  }

  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validateRegistry();
  if (!result.ok) {
    console.error("Capability contract registry validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Capability contract registry validation PASS");
}

module.exports = { CAPABILITY_ID, FAILURE_MODES, IMPLEMENTATION_STATUSES, PROVIDER_TOKENS, REGISTRY_PATH, SEMVER, validateRegistry };
