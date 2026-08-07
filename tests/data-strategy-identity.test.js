const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { canonicalHash, validateRegistry } = require("../scripts/validate-data-strategy-identity");

const root = join(__dirname, "..");
const baseRegistry = JSON.parse(readFileSync(join(root, "config/identity/data-strategy-registry.json"), "utf8"));
const capabilities = JSON.parse(readFileSync(join(root, "config/capabilities/registry.json"), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const has = (result, prefix) => result.errors.some((error) => error.startsWith(prefix));

test("committed data and strategy identity registry validates", () => {
  const result = validateRegistry(clone(baseRegistry), clone(capabilities));
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("canonical hash is deterministic across object key ordering", () => {
  const left = { z: 3, a: { y: 2, x: 1 }, list: [{ b: 2, a: 1 }] };
  const right = { list: [{ a: 1, b: 2 }], a: { x: 1, y: 2 }, z: 3 };
  assert.equal(canonicalHash(left), canonicalHash(right));
});

test("point-in-time temporal contract fails closed when ordering is weakened", () => {
  const registry = clone(baseRegistry);
  registry.datasets[0].temporal.ordering = "EVENT_LE_MODEL_AVAILABLE";
  const result = validateRegistry(registry, clone(capabilities));
  assert.equal(result.ok, false);
  assert.equal(has(result, "DATASET_POINT_IN_TIME_CONTRACT_INVALID"), true);
});

test("dataset provenance is mandatory", () => {
  const registry = clone(baseRegistry);
  registry.datasets[0].provenance = [];
  const result = validateRegistry(registry, clone(capabilities));
  assert.equal(result.ok, false);
  assert.equal(has(result, "DATASET_PROVENANCE_MISSING"), true);
});

test("same dataset identity with changed content fails canonical hash validation", () => {
  const registry = clone(baseRegistry);
  registry.datasets[0].contentHash = `sha256:${"2".repeat(64)}`;
  const result = validateRegistry(registry, clone(capabilities));
  assert.equal(result.ok, false);
  assert.equal(has(result, "DATASET_CANONICAL_HASH_MISMATCH"), true);
});

test("feature set cannot reference a dataset under the wrong canonical hash", () => {
  const registry = clone(baseRegistry);
  registry.featureSets[0].sourceDatasets[0].canonicalHash = `sha256:${"3".repeat(64)}`;
  const result = validateRegistry(registry, clone(capabilities));
  assert.equal(result.ok, false);
  assert.equal(has(result, "FEATURE_DATASET_REFERENCE_HASH_MISMATCH"), true);
});

test("duplicate strategy id/version with divergent canonical identity is rejected", () => {
  const registry = clone(baseRegistry);
  const duplicate = clone(registry.strategies[0]);
  duplicate.parameters.maxRiskBudgetBps = 200;
  const { canonicalHash: _ignored, ...identity } = duplicate;
  duplicate.canonicalHash = canonicalHash(identity);
  registry.strategies.push(duplicate);
  const result = validateRegistry(registry, clone(capabilities));
  assert.equal(result.ok, false);
  assert.equal(has(result, "STRATEGY_IDENTITY_DUPLICATE"), true);
});

test("strategy capability references must resolve to the capability registry", () => {
  const registry = clone(baseRegistry);
  registry.strategies[0].capabilities[0].id = "UNKNOWN_CAPABILITY";
  const result = validateRegistry(registry, clone(capabilities));
  assert.equal(result.ok, false);
  assert.equal(has(result, "STRATEGY_CAPABILITY_UNKNOWN"), true);
});
