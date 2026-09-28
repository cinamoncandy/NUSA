const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decideJevBoundedCodingAdmission,
  isJevBoundedCodingAdmissionCandidate,
} = require("../dist/apps/autopilot/src/jevBoundedCodingAdmission.js");
const { JevShadowProvider } = require("../dist/apps/cloud/src/ai/jevShadowProvider.js");

const testKey = () => ["unit", "jev", "credential"].join("-");
const HEAD = "a".repeat(40);

const request = {
  headSha: HEAD,
  workflowRunId: 42,
  executionId: "exec:42",
  dedupeKey: "dedupe:42",
  reason: `gha:42:${HEAD}:failure`,
};
const evidence = {
  workflowRunId: 42,
  headSha: HEAD,
  workflowName: "CI",
  workflowEvent: "pull_request",
  workflowConclusion: "failure",
  failedJobs: ["validation"],
  failedSteps: ["Preflight"],
};
const env = {
  NUSA_JEV_SHADOW_ENABLED: "true",
  NUSA_JEV_BOUNDED_ROUTING_ENABLED: "true",
  NUSA_JEV_API_KEY: testKey(),
  NUSA_JEV_ENDPOINT: "https://jev.invalid/classify",
};

test("disabled bounded routing preserves the existing coding path without calling Jev", async () => {
  let calls = 0;
  const result = await decideJevBoundedCodingAdmission(request, {}, { classify: async () => { calls += 1; return {}; } }, evidence);
  assert.equal(result.action, "PROCEED_EXISTING");
  assert.equal(result.reasonCode, "DISABLED");
  assert.equal(calls, 0);
});

test("canonical gha failure contract is eligible only when run/head identity matches", () => {
  assert.equal(isJevBoundedCodingAdmissionCandidate(request, env), true);
  assert.equal(isJevBoundedCodingAdmissionCandidate({ ...request, reason: `gha:43:${HEAD}:failure` }, env), false);
  assert.equal(isJevBoundedCodingAdmissionCandidate({ ...request, reason: `gha:42:${"b".repeat(40)}:failure` }, env), false);
});

test("ordinary feature work does not spend a Jev admission call", async () => {
  let calls = 0;
  const feature = { ...request, reason: "github-issue-2326" };
  const result = await decideJevBoundedCodingAdmission(feature, env, {
    classify: async () => { calls += 1; return {}; }
  }, evidence);
  assert.equal(result.action, "PROCEED_EXISTING");
  assert.equal(result.reasonCode, "NOT_ELIGIBLE");
  assert.equal(calls, 0);
});

test("verified failure evidence is required before Jev can suppress coding", async () => {
  let calls = 0;
  const result = await decideJevBoundedCodingAdmission(request, env, {
    classify: async () => { calls += 1; return { rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "HUMAN", confidence: 0.99 }; }
  });
  assert.equal(result.action, "PROCEED_EXISTING");
  assert.equal(result.reasonCode, "FAILURE_EVIDENCE_REQUIRED");
  assert.equal(calls, 0);
});

test("high-confidence non-code failure abstains only with bounded verified evidence", async () => {
  let captured;
  const result = await decideJevBoundedCodingAdmission(request, env, {
    classify: async (input) => {
      captured = input;
      return { rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "HUMAN", confidence: 0.97 };
    }
  }, evidence);
  assert.equal(result.action, "ABSTAIN_EXPENSIVE_INFERENCE");
  assert.equal(result.reasonCode, "NON_CODE_AUTOFIX_FORBIDDEN");
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.deepEqual(captured.failureEvidence.failedJobs, ["validation"]);
  assert.deepEqual(captured.failureEvidence.failedSteps, ["Preflight"]);
  assert.equal("log" in captured.failureEvidence, false);
});

test("repair proposal attempts reuse the initial admission and do not call Jev again", async () => {
  let calls = 0;
  const repair = { ...request, proposalFeedback: "attempt=2;rejection=SANDBOX_PATCH_APPLY_CHECK_FAILED" };
  const result = await decideJevBoundedCodingAdmission(repair, env, {
    classify: async () => { calls += 1; return {}; }
  }, evidence);
  assert.equal(result.action, "PROCEED_EXISTING");
  assert.equal(result.reasonCode, "REPAIR_ATTEMPT_REUSES_INITIAL_ADMISSION");
  assert.equal(calls, 0);
});

test("code/test decisions and low-confidence decisions preserve the existing coding path", async () => {
  for (const routed of [
    { rootCause: "CODE", safeToAutofix: "YES", severity: 2, requiredModel: "TERRA", confidence: 0.99 },
    { rootCause: "INFRA", safeToAutofix: "NO", severity: 2, requiredModel: "HUMAN", confidence: 0.70 },
  ]) {
    const result = await decideJevBoundedCodingAdmission(request, env, { classify: async () => routed }, evidence);
    assert.equal(result.action, "PROCEED_EXISTING");
  }
});

test("provider failure or malformed decision cannot block the existing coding path", async () => {
  for (const classify of [
    async () => { throw new Error("provider down"); },
    async () => ({ rootCause: "INFRA" }),
  ]) {
    const result = await decideJevBoundedCodingAdmission(request, env, { classify }, evidence);
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
