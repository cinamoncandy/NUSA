const test = require("node:test");
const assert = require("node:assert/strict");
const { decideJevBoundedCodingAdmission } = require("../dist/apps/autopilot/src/jevBoundedCodingAdmission.js");
const { JevShadowProvider } = require("../dist/apps/cloud/src/ai/jevShadowProvider.js");

const testKey = () => ["unit", "jev", "credential"].join("-");

const request = {
  headSha: "a".repeat(40),
  workflowRunId: 42,
  executionId: "exec:42",
  dedupeKey: "dedupe:42",
  reason: "audit-recovery:pr:2330:workflow-failure",
};
const env = {
  NUSA_JEV_SHADOW_ENABLED: "true",
  NUSA_JEV_BOUNDED_ROUTING_ENABLED: "true",
  NUSA_JEV_API_KEY: testKey(),
  NUSA_JEV_ENDPOINT: "https://jev.invalid/classify",
};

test("disabled bounded routing preserves the existing coding path without calling Jev", async () => {
  let calls = 0;
  const result = await decideJevBoundedCodingAdmission(request, {}, { classify: async () => { calls += 1; return {}; } });
  assert.equal(result.action, "PROCEED_EXISTING");
  assert.equal(result.reasonCode, "DISABLED");
  assert.equal(calls, 0);
});

test("ordinary feature work does not spend a Jev admission call", async () => {
  let calls = 0;
  const result = await decideJevBoundedCodingAdmission({ ...request, reason: "github-issue-2326" }, env, {
    classify: async () => { calls += 1; return {}; }
  });
  assert.equal(result.action, "PROCEED_EXISTING");
  assert.equal(result.reasonCode, "NOT_ELIGIBLE");
  assert.equal(calls, 0);
});

test("high-confidence non-code failure abstains before expensive inference", async () => {
  const result = await decideJevBoundedCodingAdmission(request, env, {
    classify: async () => ({ rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "HUMAN", confidence: 0.97 })
  });
  assert.equal(result.action, "ABSTAIN_EXPENSIVE_INFERENCE");
  assert.equal(result.reasonCode, "NON_CODE_AUTOFIX_FORBIDDEN");
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
});

test("code/test decisions and low-confidence decisions preserve the existing coding path", async () => {
  for (const routed of [
    { rootCause: "CODE", safeToAutofix: "YES", severity: 2, requiredModel: "TERRA", confidence: 0.99 },
    { rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "HUMAN", confidence: 0.70 },
  ]) {
    const result = await decideJevBoundedCodingAdmission(request, env, { classify: async () => routed });
    assert.equal(result.action, "PROCEED_EXISTING");
  }
});

test("provider failure or malformed decision cannot block the existing coding path", async () => {
  for (const classify of [
    async () => { throw new Error("provider down"); },
    async () => ({ rootCause: "INFRA" }),
  ]) {
    const result = await decideJevBoundedCodingAdmission(request, env, { classify });
    assert.equal(result.action, "PROCEED_EXISTING");
    assert.equal(result.reasonCode, "PROVIDER_UNAVAILABLE");
  }
});

test("bounded provider transport uses explicit zero-authority BOUNDED_ROUTING mode", async () => {
  const capture = {};
  const provider = new JevShadowProvider({
    apiKey: testKey(),
    endpoint: "https://jev.invalid/classify",
    fetchImpl: async (url, init) => {
      capture.url = url;
      capture.init = init;
      return { ok: true, status: 200, async text() { return JSON.stringify({ rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "HUMAN", confidence: 0.97 }); } };
    },
  });
  await provider.classifyBounded({ task: "admission" });
  const body = JSON.parse(capture.init.body);
  assert.equal(body.mode, "BOUNDED_ROUTING");
  assert.equal(body.authority, "ZERO_AUTHORITY");
  assert.equal(capture.init.body.includes(testKey()), false);
});
