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

test("default topology represents all six canonical planes", () => {
  const topology = createDefaultPlatformTopology();
  assert.deepEqual(
    [...new Set(topology.modules.map((module) => module.plane))].sort(),
    [
      "APPLICATIONS",
      "CONTROL_RELEASE",
      "DATA_KNOWLEDGE",
      "EVIDENCE_OPERATIONS",
      "REALTIME_DECISION_EXECUTION",
      "RESEARCH_AI_LEARNING"
    ].sort()
  );
});

test("committee and governance remain outside the real-time path", () => {
  const topology = createDefaultPlatformTopology();
  const committee = topology.modules.find((module) => module.id === "committee");
  const governance = topology.modules.find((module) => module.id === "governance");
  assert.equal(committee.layer, "CONTROL");
  assert.equal(committee.plane, "CONTROL_RELEASE");
  assert.equal(committee.realTime, false);
  assert.equal(governance.layer, "CONTROL");
  assert.equal(governance.plane, "CONTROL_RELEASE");
  assert.equal(governance.realTime, false);
});

test("risk and release preserve independent veto domains", () => {
  const topology = createDefaultPlatformTopology();
  const risk = topology.modules.find((module) => module.id === "risk");
  const release = topology.modules.find((module) => module.id === "release");
  assert.equal(risk.plane, "REALTIME_DECISION_EXECUTION");
  assert.equal(risk.realTime, true);
  assert.match(risk.responsibilities.join(" "), /independent runtime veto/);
  assert.equal(release.plane, "CONTROL_RELEASE");
  assert.equal(release.realTime, false);
  assert.match(release.responsibilities.join(" "), /independent deployment veto/);
});

test("execution remains the single governed execution boundary", () => {
  const topology = createDefaultPlatformTopology();
  const execution = topology.modules.find((module) => module.id === "execution");
  assert.equal(execution.plane, "REALTIME_DECISION_EXECUTION");
  assert.equal(execution.realTime, true);
  assert.match(execution.responsibilities.join(" "), /single governed execution boundary/);
});

test("meta-ai and learning cannot enter the real-time path", () => {
  const topology = createDefaultPlatformTopology();
  for (const id of ["meta-ai", "learning"]) {
    const module = topology.modules.find((candidate) => candidate.id === id);
    assert.equal(module.plane, "RESEARCH_AI_LEARNING");
    assert.equal(module.realTime, false);
  }
});

test("rejects control modules placed in the real-time path", () => {
  const topology = createDefaultPlatformTopology();
  const modules = topology.modules.map((module) => module.id === "committee" ? { ...module, realTime: true } : { ...module });
  assert.throws(
    () => validatePlatformTopology({ ...topology, modules }),
    /control module cannot be in the real-time path/
  );
});

test("rejects research AI modules placed in the real-time path", () => {
  const topology = createDefaultPlatformTopology();
  const modules = topology.modules.map((module) => module.id === "meta-ai" ? { ...module, realTime: true } : { ...module });
  assert.throws(
    () => validatePlatformTopology({ ...topology, modules }),
    /(?:control module|research\/AI\/learning module) cannot be in the real-time path/
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
