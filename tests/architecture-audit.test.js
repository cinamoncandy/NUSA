const test = require("node:test");
const assert = require("node:assert/strict");
const { createDefaultPlatformTopology } = require("../dist/apps/cloud/src/platformTopology.js");
const { auditPlatformArchitecture } = require("../dist/apps/cloud/src/architectureAudit.js");

const cloneTopology = (topology) => ({
  corePipeline: [...topology.corePipeline],
  controlTriggers: [...topology.controlTriggers],
  modules: topology.modules.map((module) => ({
    ...module,
    dependencies: [...module.dependencies],
    responsibilities: [...module.responsibilities]
  }))
});

test("approved default architecture passes with immutable audit report", () => {
  const report = auditPlatformArchitecture(createDefaultPlatformTopology(), 1000);
  assert.equal(report.status, "PASS");
  assert.equal(report.criticalCount, 0);
  assert.equal(report.highCount, 0);
  assert.equal(report.automaticRemediationAllowed, false);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.findings));
});

test("fails when core dependency direction is inverted", () => {
  const topology = cloneTopology(createDefaultPlatformTopology());
  topology.modules.find((module) => module.id === "probability").dependencies.push("execution");
  const report = auditPlatformArchitecture(topology, 1000);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some((item) => item.id === "CORE_DIRECTION_VIOLATION:probability:execution"));
});

test("fails when plugin bypasses protected downstream modules", () => {
  const topology = cloneTopology(createDefaultPlatformTopology());
  topology.modules.find((module) => module.id === "funding-carry").dependencies.push("execution");
  const report = auditPlatformArchitecture(topology, 1000);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some((item) => item.id === "PLUGIN_BYPASS_RISK:funding-carry:execution"));
});

test("fails when a required safety responsibility is removed", () => {
  const topology = cloneTopology(createDefaultPlatformTopology());
  topology.modules.find((module) => module.id === "risk").responsibilities = ["hard limits", "liquidity"];
  const report = auditPlatformArchitecture(topology, 1000);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some((item) => item.id === "SAFETY_RESPONSIBILITY_MISSING:risk:kill switch"));
});

test("fails when an operator application exposes unsafe mutation", () => {
  const topology = cloneTopology(createDefaultPlatformTopology());
  topology.modules.find((module) => module.id === "desktop").responsibilities.push("submit order");
  const report = auditPlatformArchitecture(topology, 1000);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some((item) => item.id === "APPLICATION_MUTATION_SURFACE:desktop"));
});

test("rejects invalid audit timestamp", () => {
  assert.throws(
    () => auditPlatformArchitecture(createDefaultPlatformTopology(), -1),
    /generatedAt/
  );
});
