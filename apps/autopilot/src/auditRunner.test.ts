import assert from "node:assert/strict";
import test from "node:test";
import { executeIndependentAudit, validateAuditModelVerdict, validateAuditRunnerRequest, type AuditRunnerRequest } from "./auditRunner";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const request: AuditRunnerRequest = Object.freeze({
  kind: "AUDIT_REQUEST",
  repository: "cinamoncandy/NUSA",
  prNumber: 1362,
  headSha: HEAD,
  baseSha: BASE,
  workflowRunId: 33450000001,
  executionId: "audit:1362:33450000001",
  dedupeKey: `audit:1362:${HEAD}`,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

function response(status: number, payload: unknown, textValue?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return textValue ?? JSON.stringify(payload); },
  };
}

function pull(headSha = HEAD, baseSha = BASE) {
  return {
    state: "open",
    head: { sha: headSha, repo: { full_name: "cinamoncandy/NUSA" } },
    base: { sha: baseSha },
  };
}

function run(headSha = HEAD, id = request.workflowRunId) {
  return {
    id,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: headSha,
    repository: { full_name: "cinamoncandy/NUSA" },
    pull_requests: [{ number: request.prNumber }],
  };
}

function fetchSequence(options: {
  readonly firstPull?: unknown;
  readonly firstRun?: unknown;
  readonly diff?: string;
  readonly secondPull?: unknown;
  readonly secondRun?: unknown;
} = {}) {
  const queue = [
    response(200, options.firstPull ?? pull()),
    response(200, options.firstRun ?? run()),
    response(200, {}, options.diff ?? "diff --git a/a.ts b/a.ts\n+const safe = true;\n"),
    response(200, options.secondPull ?? options.firstPull ?? pull()),
    response(200, options.secondRun ?? options.firstRun ?? run()),
  ];
  return async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  };
}

function ai(responseBody: unknown) {
  return {
    async run() { return responseBody; },
  };
}

test("validates the immutable read-only audit request contract", () => {
  const validated = validateAuditRunnerRequest(request);
  assert.equal(validated.headSha, HEAD);
  assert.equal(validated.baseSha, BASE);
  assert.equal(validated.mutationAllowed, false);
  assert.equal(validated.liveAuthority, "NONE");
  assert.equal(validated.productionMutationAllowed, false);
  assert.equal(validated.aiAuthority, "ZERO_AUTHORITY");
});

test("rejects any repository or production mutation attempt", () => {
  assert.throws(() => validateAuditRunnerRequest({ ...request, mutationAllowed: true }), /AUDIT_RUNNER_MUTATION_FORBIDDEN/);
  assert.throws(() => validateAuditRunnerRequest({ ...request, productionMutationAllowed: true }), /AUDIT_RUNNER_MUTATION_FORBIDDEN/);
  assert.throws(() => validateAuditRunnerRequest({ ...request, liveAuthority: "LIVE" }), /AUDIT_RUNNER_LIVE_AUTHORITY_FORBIDDEN/);
  assert.throws(() => validateAuditRunnerRequest({ ...request, aiAuthority: "SELF_GRANT" }), /AUDIT_RUNNER_AI_AUTHORITY_INVALID/);
});

test("fails closed when the current PR head is stale", async () => {
  const stale = "c".repeat(40);
  await assert.rejects(
    executeIndependentAudit(request, { AI: ai({ response: "{}" }) }, fetchSequence({ firstPull: pull(stale) }) as never),
    /AUDIT_PR_HEAD_MISMATCH/,
  );
});

test("fails closed when canonical CI is bound to another head or run", async () => {
  await assert.rejects(
    executeIndependentAudit(request, { AI: ai({ response: "{}" }) }, fetchSequence({ firstRun: run("d".repeat(40)) }) as never),
    /AUDIT_CI_HEAD_MISMATCH/,
  );
  await assert.rejects(
    executeIndependentAudit(request, { AI: ai({ response: "{}" }) }, fetchSequence({ firstRun: run(HEAD, request.workflowRunId + 1) }) as never),
    /AUDIT_CI_RUN_ID_MISMATCH/,
  );
});

test("strict verdict schema rejects malformed, mutation-shaped, and inconsistent responses", () => {
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", patch: "diff" }), /AUDIT_VERDICT_KEYS_INVALID/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS", findings: [{ code: "NOTE", severity: "NOTE", message: "note", evidenceRef: null }], blockers: [], safetyInvariantResult: "PASS" }), /AUDIT_VERDICT_PASS_FINDINGS_FORBIDDEN/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS_WITH_NOTES", findings: [], blockers: ["blocker"], safetyInvariantResult: "PASS" }), /AUDIT_VERDICT_BLOCKERS_REQUIRE_FAIL/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS_WITH_NOTES", findings: [], blockers: [], safetyInvariantResult: "FAIL" }), /AUDIT_VERDICT_SAFETY_REQUIRES_FAIL/);
});

test("safety regression is preserved as FAIL and cannot become merge allowed", async () => {
  const model = ai({
    response: JSON.stringify({
      verdict: "FAIL",
      findings: [{ code: "SAFETY_REGRESSION", severity: "BLOCKER", message: "production mutation became possible", evidenceRef: "a.ts:+1" }],
      blockers: ["productionMutationAllowed invariant regressed"],
      safetyInvariantResult: "FAIL",
    }),
  });
  const result = await executeIndependentAudit(request, { AI: model }, fetchSequence() as never, () => 1234);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.safetyInvariantResult, "FAIL");
  assert.equal(result.reviewedHeadSha, HEAD);
});

test("detects PR head movement after model review", async () => {
  const model = ai({ response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS" }) });
  await assert.rejects(
    executeIndependentAudit(request, { AI: model }, fetchSequence({ secondPull: pull("e".repeat(40)) }) as never),
    /AUDIT_PR_HEAD_MISMATCH/,
  );
});

test("returns exact-head PASS_WITH_NOTES evidence without mutation authority", async () => {
  const model = ai({
    response: "```json\n" + JSON.stringify({
      verdict: "PASS_WITH_NOTES",
      findings: [{ code: "NON_BLOCKING_NOTE", severity: "NOTE", message: "reviewed exact diff", evidenceRef: "a.ts:+1" }],
      blockers: [],
      safetyInvariantResult: "PASS",
    }) + "\n```",
  });
  const result = await executeIndependentAudit(request, { AI: model }, fetchSequence() as never, () => 5678);
  assert.equal(result.status, "AUDIT_COMPLETED");
  assert.equal(result.verdict, "PASS_WITH_NOTES");
  assert.equal(result.mergeAllowed, true);
  assert.equal(result.reviewedHeadSha, HEAD);
  assert.equal(result.baseSha, BASE);
  assert.equal(result.workflowRunId, request.workflowRunId);
  assert.deepEqual(result.evidenceRefs, [
    `github:pull/${request.prNumber}@${HEAD}`,
    `github:base/${BASE}`,
    `github:actions/runs/${request.workflowRunId}`,
  ]);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("fails closed when no independent AI audit engine is configured", async () => {
  await assert.rejects(executeIndependentAudit(request, {}, fetchSequence() as never), /AUDIT_AI_NOT_CONFIGURED/);
});
