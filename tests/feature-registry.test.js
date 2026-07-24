const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FeatureRegistry,
  createInitialFeatureDefinitions,
  validateFeatureCalculation
} = require("../dist/apps/cloud/src/featureRegistry.js");

const CREATED_AT = 1_700_000_000_000;

const buildRegistry = () => {
  const registry = new FeatureRegistry();
  for (const definition of createInitialFeatureDefinitions(CREATED_AT)) registry.register(definition);
  return registry;
};

test("registers immutable versioned initial features", () => {
  const registry = buildRegistry();
  const definitions = registry.list();
  assert.equal(definitions.length, 8);
  assert.ok(Object.isFrozen(definitions));
  const funding = registry.get("funding-z-score", 1);
  assert.equal(funding.lifecycleStatus, "ACTIVE");
  assert.ok(Object.isFrozen(funding));
  assert.ok(Object.isFrozen(funding.inputSchema));
});

test("rejects duplicate feature identities", () => {
  const registry = buildRegistry();
  const feature = registry.get("basis", 1);
  assert.throws(() => registry.register({ ...feature }), /already exists/);
});

test("rejects unknown dependencies", () => {
  const registry = buildRegistry();
  const feature = registry.get("basis", 1);
  assert.throws(() => registry.register({
    ...feature,
    featureId: "derived-basis",
    dependencies: ["missing@1"]
  }), /unknown feature dependency/);
});

test("creates a new immutable lifecycle version without mutating history", () => {
  const registry = buildRegistry();
  const original = registry.get("basis", 1);
  const retired = registry.deriveLifecycleVersion("basis", 1, "RETIRED", CREATED_AT + 10_000);
  assert.equal(original.lifecycleStatus, "ACTIVE");
  assert.equal(retired.version, 2);
  assert.equal(retired.lifecycleStatus, "RETIRED");
  assert.equal(retired.retiredAt, CREATED_AT + 10_000);
  assert.equal(registry.get("basis", 1), original);
});

test("searches and compares versioned features", () => {
  const registry = buildRegistry();
  const result = registry.search("order_book");
  assert.equal(result.length, 3);
  const next = registry.deriveLifecycleVersion("basis", 1, "DEPRECATED", CREATED_AT + 20_000);
  const comparison = registry.compare("basis", 1, next.version);
  assert.equal(comparison.left.lifecycleStatus, "ACTIVE");
  assert.equal(comparison.right.lifecycleStatus, "DEPRECATED");
  assert.ok(Object.isFrozen(comparison));
});

test("validates fresh calculation provenance", () => {
  const registry = buildRegistry();
  assert.doesNotThrow(() => validateFeatureCalculation(registry, {
    featureId: "basis",
    featureVersion: 1,
    engineVersion: "feature-engine-v1",
    inputSnapshotId: "snapshot-1",
    generatedAt: CREATED_AT + 1_000,
    source: "replay",
    value: 0.001
  }, CREATED_AT + 2_000));
});

test("rejects future and stale calculation records", () => {
  const registry = buildRegistry();
  const base = {
    featureId: "basis",
    featureVersion: 1,
    engineVersion: "feature-engine-v1",
    inputSnapshotId: "snapshot-1",
    source: "replay",
    value: 0.001
  };
  assert.throws(() => validateFeatureCalculation(registry, {
    ...base,
    generatedAt: CREATED_AT + 3_000
  }, CREATED_AT + 2_000), /future time/);
  assert.throws(() => validateFeatureCalculation(registry, {
    ...base,
    generatedAt: CREATED_AT
  }, CREATED_AT + 10_000), /stale/);
});

test("retired feature definitions cannot produce runtime calculations", () => {
  const registry = buildRegistry();
  const retired = registry.deriveLifecycleVersion("basis", 1, "RETIRED", CREATED_AT + 1_000);
  assert.throws(() => validateFeatureCalculation(registry, {
    featureId: retired.featureId,
    featureVersion: retired.version,
    engineVersion: "feature-engine-v1",
    inputSnapshotId: "snapshot-2",
    generatedAt: CREATED_AT + 1_000,
    source: "replay",
    value: 0.001
  }, CREATED_AT + 1_500), /validated or active/);
});