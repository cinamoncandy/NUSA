import assert from "node:assert/strict";
import test from "node:test";
import { executeIndependentValidator, validateValidatorModelVerdict, validateValidatorRunnerRequest, type ValidatorRunnerRequest } from "./auditRunner";

const request: ValidatorRunnerRequest = Object.freeze({
  kind: "VALIDATOR_REQUEST", repository: "cinamoncandy/NUSA", prNumber: 2760, headSha: "a".repeat(40), baseSha: "b".repeat(40),
  workflowRunId: 123, executionId: "validator:test", dedupeKey: "validator:dedupe", mutationAllowed: false,
  liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY",
});

test("fresh VALIDATOR request is exact-head and zero-authority bound", () => {
  assert.deepEqual(validateValidatorRunnerRequest(request), request);
  assert.throws(() => validateValidatorRunnerRequest({ ...request, kind: "AUDIT_REQUEST" }), /VALIDATOR_RUNNER_KIND_INVALID/);
  assert.throws(() => validateValidatorRunnerRequest({ ...request, mutationAllowed: true }), /VALIDATOR_RUNNER_MUTATION_FORBIDDEN/);
  assert.throws(() => validateValidatorRunnerRequest({ ...request, headSha: "short" }), /VALIDATOR_RUNNER_HEAD_SHA_INVALID/);
});

test("VALIDATOR permits PASS or P2-only notes and classifies P0/P1 as blockers", () => {
  assert.equal(validateValidatorModelVerdict({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }).verdict, "PASS");
  assert.equal(validateValidatorModelVerdict({
    verdict: "PASS_WITH_NOTES", findings: [{ code: "P2_METADATA_NOTE", severity: "NOTE", message: "note", evidenceRef: null }],
    blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true,
  }).verdict, "PASS_WITH_NOTES");
  assert.equal(validateValidatorModelVerdict({
    verdict: "FAIL", findings: [{ code: "P1_RELEASE_BYPASS", severity: "BLOCKER", message: "bypass", evidenceRef: "x:+1" }],
    blockers: ["release bypass"], safetyInvariantResult: "FAIL", mergeAllowed: false,
  }).verdict, "FAIL");
});

test("VALIDATOR rejects missing priority prefixes and severity downgrades", () => {
  assert.throws(() => validateValidatorModelVerdict({
    verdict: "PASS_WITH_NOTES", findings: [{ code: "NOTE_ONLY", severity: "NOTE", message: "note", evidenceRef: null }], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true,
  }), /VALIDATOR_FINDING_PRIORITY_PREFIX_INVALID/);
  assert.throws(() => validateValidatorModelVerdict({
    verdict: "PASS_WITH_NOTES", findings: [{ code: "P1_BLOCKER_AS_NOTE", severity: "NOTE", message: "bad", evidenceRef: null }], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true,
  }), /VALIDATOR_BLOCKING_PRIORITY_SEVERITY_INVALID/);
  assert.throws(() => validateValidatorModelVerdict({
    verdict: "FAIL", findings: [{ code: "P2_NOTE_AS_BLOCKER", severity: "BLOCKER", message: "bad", evidenceRef: "x:+1" }], blockers: ["bad"], safetyInvariantResult: "FAIL", mergeAllowed: false,
  }), /VALIDATOR_NONBLOCKING_PRIORITY_SEVERITY_INVALID/);
});

const githubResponse = (status: number, payload: unknown, textValue?: string) => ({
  ok: status >= 200 && status < 300, status,
  async json() { return payload; },
  async text() { return textValue ?? JSON.stringify(payload); },
});

function validatorGithubFetch(options: { staleSecondPull?: boolean } = {}) {
  let pullReads = 0;
  const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+const safe = true;\n";
  const protocol = "# NUSA /grill-me protocol\n" + "adversarial exact-head fail-closed independent validation. ".repeat(8);
  return (async (input: string) => {
    const url = String(input);
    if (url.includes(`/pulls/${request.prNumber}`)) {
      pullReads += 1;
      return githubResponse(200, { state: "open", changed_files: 1, head: { sha: options.staleSecondPull && pullReads > 1 ? "c".repeat(40) : request.headSha, repo: { full_name: request.repository } }, base: { sha: request.baseSha, repo: { full_name: request.repository } } });
    }
    if (url.includes(`/actions/runs/${request.workflowRunId}`)) return githubResponse(200, { id: request.workflowRunId, name: "CI", event: "pull_request", status: "completed", conclusion: "success", head_sha: request.headSha, repository: { full_name: request.repository }, pull_requests: [{ number: request.prNumber }] });
    if (url.includes(`/compare/${request.baseSha}...${request.headSha}`)) return githubResponse(200, {}, diff);
    if (url.includes("/contents/docs/GRILL_ME_PROTOCOL.md?ref=")) return githubResponse(200, {}, protocol);
    throw new Error(`unexpected fetch ${url}`);
  }) as never;
}

test("fresh VALIDATOR independently reviews exact head using protected-base grill protocol", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch(), () => 999);
  assert.equal(result.status, "VALIDATOR_COMPLETED");
  assert.equal(result.auditAllowed, true);
  assert.equal(result.p0, 0);
  assert.equal(result.p1, 0);
  assert.equal(result.p2, 0);
  assert.equal(result.reviewedHeadSha, request.headSha);
  assert.equal(result.reviewedAt, 999);
  assert.match(prompt, /TRUSTED PROTECTED-BASE GRILL_ME_PROTOCOL/);
  assert.match(prompt, /NUSA \/grill-me protocol/);
});

test("fresh VALIDATOR fails if the exact head changes during review", async () => {
  const AI = { async run() { return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  await assert.rejects(executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ staleSecondPull: true })), /AUDIT_PR_HEAD_MISMATCH|VALIDATOR_VERIFIED_HEAD_MISMATCH/);
});

test("P1 blocker never advances to Audit", async () => {
  const AI = { async run() { return { response: JSON.stringify({ verdict: "FAIL", findings: [{ code: "P1_RELEASE_BYPASS", severity: "BLOCKER", message: "bypass", evidenceRef: "a.ts:+1" }], blockers: ["release bypass"], safetyInvariantResult: "FAIL", mergeAllowed: false }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch());
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.auditAllowed, false);
  assert.equal(result.p1, 1);
});
