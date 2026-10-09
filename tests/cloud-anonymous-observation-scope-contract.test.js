const test = require("node:test");
const assert = require("node:assert/strict");
const { ANONYMOUS_OBSERVATION_ROUTES, anonymousObservationEnabled, isAnonymousObservationRoute, createAnonymousObservationScope } = require("../dist/apps/cloud/src/observation/anonymousObservationScope.js");

test("anonymous observation is default-off and explicitly opt-in", () => {
  assert.equal(anonymousObservationEnabled({}), false);
  assert.equal(anonymousObservationEnabled({ NUSA_CLOUD_ANONYMOUS_OBSERVATION: "0" }), false);
  assert.equal(anonymousObservationEnabled({ NUSA_CLOUD_ANONYMOUS_OBSERVATION: "true" }), false);
  assert.equal(anonymousObservationEnabled({ NUSA_CLOUD_ANONYMOUS_OBSERVATION: "1" }), true);
});

test("anonymous observation allowlist excludes control and REAL surfaces", () => {
  assert.ok(ANONYMOUS_OBSERVATION_ROUTES.includes("/api/paper-operations"));
  for (const route of ANONYMOUS_OBSERVATION_ROUTES) {
    assert.ok(!route.startsWith("/api/operator/"));
    assert.ok(!route.startsWith("/v1/mobile/"));
    assert.ok(!route.startsWith("/v1/desktop/"));
    assert.notEqual(route, "/api/real-readonly-operations");
    assert.notEqual(route, "/api/paper-orders");
    assert.notEqual(route, "/api/settings/investment-allocation");
    assert.notEqual(route, "/api/ux-telemetry");
  }
  assert.equal(isAnonymousObservationRoute("/api/operator/users"), false);
});

test("anonymous principal has dashboard read only", () => {
  const scope = createAnonymousObservationScope();
  assert.deepEqual(scope.principal.scopes, ["dashboard:read"]);
  assert.ok(!scope.principal.scopes.includes("paper:trade"));
  assert.ok(!scope.principal.scopes.includes("telemetry:write"));
});
