const test = require("node:test");
const assert = require("node:assert/strict");
const { projectJevCalibration } = require("../dist/apps/cloud/src/ai/jevCalibration.js");

test("Jev calibration stores comparison metadata only and carries zero authority", () => {
  const existing = { rootCause: "TEST", safeToAutofix: "NO", requiredModel: "SOL" };
  const shadow = {
    mode: "SHADOW",
    decision: { rootCause: "TEST", safeToAutofix: "YES", severity: 2, requiredModel: "TERRA", confidence: 0.93 },
    usableForRouting: false,
    aiAuthority: "ZERO_AUTHORITY",
    productionMutationAllowed: false,
    liveAuthority: "NONE",
    fallbackApplied: false
  };
  const record = projectJevCalibration(existing, shadow);
  assert.deepEqual(record, {
    schemaVersion: 1,
    mode: "SHADOW",
    fallbackApplied: false,
    confidence: 0.93,
    rootCauseAgreement: true,
    autofixAgreement: false,
    modelAgreement: false,
    usableForRouting: false,
    aiAuthority: "ZERO_AUTHORITY",
    productionMutationAllowed: false,
    liveAuthority: "NONE"
  });
  const serialized = JSON.stringify(record);
  for (const forbidden of ["apiKey", "credential", "input", "log", "prompt", "secret"]) assert.equal(serialized.includes(forbidden), false);
});
