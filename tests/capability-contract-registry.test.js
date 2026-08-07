const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { validateRegistry } = require("../scripts/validate-capability-registry.js");

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function baseRegistry() {
  return {
    version: 1,
    contracts: [{
      capabilityId: "REGIME_DETECTION",
      contractVersion: "1.0.0",
      schemas: { input: "schemas/input.json", output: "schemas/output.json" },
      failure: { mode: "FAIL_CLOSED", timeoutMs: 5000, retryable: true, unknownIsFailure: true },
      permissions: ["market-data:read"],
      evidence: { provenanceRequired: true, implementationVersionRequired: true, inputVersionRequired: true, outputHashRequired: true },
      rollbackCompatibleWith: ["1.0.0"]
    }],
    implementations: [{
      implementationId: "baseline-regime",
      capabilityId: "REGIME_DETECTION",
      contractVersion: "1.0.0",
      provider: "internal",
      implementationVersion: "1.0.0",
      status: "APPROVED"
    }]
  };
}

function withFixture(mutator, callback) {
  const root = mkdtempSync(join(tmpdir(), "nusa-capability-registry-"));
  try {
    write(root, "schemas/input.json", "{}\n");
    write(root, "schemas/output.json", "{}\n");
    const registry = baseRegistry();
    if (mutator) mutator(registry);
    write(root, "registry.json", `${JSON.stringify(registry, null, 2)}\n`);
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("valid provider-independent capability registry passes", () => {
  withFixture(null, (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.equal(result.ok, true, result.failures.join("\n"));
  });
});

test("duplicate capability id/version is rejected", () => {
  withFixture((registry) => registry.contracts.push(structuredClone(registry.contracts[0])), (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.ok(result.failures.some((failure) => failure.includes("DUPLICATE_CAPABILITY_CONTRACT")));
  });
});

test("provider-specific capability id is rejected", () => {
  withFixture((registry) => { registry.contracts[0].capabilityId = "OPENAI_REGIME_DETECTION"; registry.implementations[0].capabilityId = "OPENAI_REGIME_DETECTION"; }, (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.ok(result.failures.some((failure) => failure.includes("PROVIDER_SPECIFIC_CAPABILITY_ID")));
  });
});

test("missing schema target is rejected", () => {
  withFixture((registry) => { registry.contracts[0].schemas.output = "schemas/missing.json"; }, (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.ok(result.failures.some((failure) => failure.includes("SCHEMA_REFERENCE_NOT_FOUND:output")));
  });
});

test("implementation binding to unknown contract is rejected", () => {
  withFixture((registry) => { registry.implementations[0].contractVersion = "2.0.0"; }, (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.ok(result.failures.some((failure) => failure.includes("UNKNOWN_CAPABILITY_CONTRACT")));
  });
});

test("evidence requirements cannot be silently disabled", () => {
  withFixture((registry) => { registry.contracts[0].evidence.outputHashRequired = false; }, (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.ok(result.failures.some((failure) => failure.includes("EVIDENCE_REQUIREMENT_NOT_ENFORCED:outputHashRequired")));
  });
});

test("non-positive timeout is rejected", () => {
  withFixture((registry) => { registry.contracts[0].failure.timeoutMs = 0; }, (root) => {
    const result = validateRegistry(root, "registry.json");
    assert.ok(result.failures.some((failure) => failure.includes("TIMEOUT_INVALID")));
  });
});
