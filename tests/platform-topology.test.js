const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDefaultPlatformTopology,
  validatePlatformTopology
} = require("../dist/apps/cloud/src/platformTopology.js");

test("default topology preserves the seven-stage real-time core", () => {
  const topology = createDefaultPlatformTopology();
  assert.deepEqual(topology.corePipeline, [
    "MARKET",
    "PROBABILITY",
    "ALPHA",
    "PORTFOLIO",
    "RISK",
    "EXECUTION",
    "RUNTIME"
  ]);
  assert.doesNotThrow(() => validatePlatformTopology(topology));
  assert.ok(Object.isFrozen(topology));
});

test("committee and governance remain outside the real-time path", () => {
  const topology = createDefaultPlatformTopology();
  const committee = topology.modules.find((module) => module.id === "committee");
  const governance = topology.modules.find((module) => module.id === "governance");
  assert.equal(committee.layer, "CONTROL");
  assert.equal(committee.realTime, false);
  assert.equal(governance.layer, "CONTROL");
  assert.equal(governance.realTime, false);
});

test("rejects control modules placed in the real-time path", () => {
  const topology = createDefaultPlatformTopology();
  const modules = topology.modules.map((module) => module.id === "committee" ? { ...module, realTime: true } : { ...module });
  assert.throws(
    () => validatePlatformTopology({ ...topology, modules }),
    /control module cannot be in the real-time path/
  );
});

test("rejects core dependencies on control-plane modules", () => {
  const topology = createDefaultPlatformTopology();
  const modules = topology.modules.map((module) => module.id === "runtime"
    ? { ...module, dependencies: [...module.dependencies, "committee"] }
    : { ...module });
  assert.throws(
    () => validatePlatformTopology({ ...topology, modules }),
    /CORE module runtime cannot depend on CONTROL module committee/
  );
});

test("rejects core pipeline reordering", () => {
  const topology = createDefaultPlatformTopology();
  const reordered = [...topology.corePipeline];
  [reordered[4], reordered[5]] = [reordered[5], reordered[4]];
  assert.throws(
    () => validatePlatformTopology({ ...topology, corePipeline: reordered }),
    /core pipeline order/
  );
});
