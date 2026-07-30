const test = require("node:test");
const assert = require("node:assert/strict");
const { reviewArchitecture } = require("../dist/apps/cloud/src/architectureReview.js");

const component = (overrides = {}) => ({ componentId: "world-model", dependencies: [], capabilities: ["READ_MARKET"], productionMutationAllowed: false, credentialAccessAllowed: false, ...overrides });

test("safe architecture passes review", () => {
  const result = reviewArchitecture([component()]);
  assert.equal(result.status, "PASS");
  assert.equal(result.componentCount, 1);
});

test("authority or credential access blocks review", () => {
  const result = reviewArchitecture([component({ componentId: "unsafe", productionMutationAllowed: true }), component({ componentId: "secret", credentialAccessAllowed: true })]);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.findings, ["PRODUCTION_MUTATION:unsafe", "CREDENTIAL_ACCESS:secret"]);
});
