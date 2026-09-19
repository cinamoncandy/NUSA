const test = require("node:test");
const assert = require("node:assert/strict");
const {
  JEV_DETERMINISTIC_FALLBACK,
  JevShadowRouter,
  validateJevShadowDecision
} = require("../dist/apps/cloud/src/ai/jevShadowRouter.js");

const valid = (overrides = {}) => ({
  rootCause: "TEST",
  safeToAutofix: "YES",
  severity: 2,
  requiredModel: "TERRA",
  confidence: 0.94,
  ...overrides
});

test("Jev is disabled by default and never calls the classifier", async () => {
  let calls = 0;
  const router = new JevShadowRouter(async () => { calls += 1; return valid(); });
  const result = await router.observe(Object.freeze({ event: "ci" }), {});
  assert.equal(calls, 0);
  assert.equal(result.mode, "DISABLED");
  assert.equal(result.fallbackApplied, true);
  assert.deepEqual(result.decision, JEV_DETERMINISTIC_FALLBACK);
});

test("valid Jev result remains observation-only ZERO_AUTHORITY", async () => {
  const router = new JevShadowRouter(async () => valid());
  const result = await router.observe(Object.freeze({ event: "ci" }), { NUSA_JEV_SHADOW_ENABLED: "true" });
  assert.equal(result.mode, "SHADOW");
  assert.deepEqual(result.decision, valid());
  assert.equal(result.usableForRouting, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.fallbackApplied, false);
});

test("low confidence deterministically falls back without routing authority", async () => {
  const router = new JevShadowRouter(async () => valid({ confidence: 0.79 }));
  const result = await router.observe({}, { NUSA_JEV_SHADOW_ENABLED: "true" });
  assert.deepEqual(result.decision, JEV_DETERMINISTIC_FALLBACK);
  assert.equal(result.usableForRouting, false);
  assert.equal(result.fallbackApplied, true);
});

test("provider unavailable and timeout-like failures preserve deterministic fallback", async () => {
  for (const error of [new Error("provider unavailable"), Object.assign(new Error("timeout"), { name: "TimeoutError" })]) {
    const router = new JevShadowRouter(async () => { throw error; });
    const result = await router.observe({}, { NUSA_JEV_SHADOW_ENABLED: "true" });
    assert.deepEqual(result.decision, JEV_DETERMINISTIC_FALLBACK);
    assert.equal(result.usableForRouting, false);
  }
});

test("malformed and authority-shaped responses fail closed", async () => {
  const malformed = [
    null,
    valid({ rootCause: "OTHER" }),
    valid({ safeToAutofix: "MAYBE" }),
    valid({ severity: 0 }),
    valid({ severity: 6 }),
    valid({ requiredModel: "JEV" }),
    valid({ confidence: -0.1 }),
    valid({ confidence: 1.1 }),
    { ...valid(), productionMutationAllowed: true },
    { ...valid(), liveAuthority: "LIVE" }
  ];
  for (const value of malformed) assert.throws(() => validateJevShadowDecision(value));
});

test("Jev output cannot express trading, LIVE mutation, merge, release, or secret authority", () => {
  const decision = validateJevShadowDecision(valid());
  const serialized = JSON.stringify(decision);
  for (const forbidden of ["order", "withdraw", "transfer", "merge", "release", "secret", "productionMutationAllowed", "liveAuthority"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(Object.keys(decision).sort(), ["confidence", "requiredModel", "rootCause", "safeToAutofix", "severity"]);
});
