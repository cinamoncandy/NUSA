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

function pull(
  headSha = HEAD,
  baseSha = BASE,
  changedFiles = 1,
  headRepository = "cinamoncandy/NUSA",
  baseRepository = "cinamoncandy/NUSA",
) {
  return {
    state: "open",
    changed_files: changedFiles,
    head: { sha: headSha, repo: { full_name: headRepository } },
    base: { sha: baseSha, repo: { full_name: baseRepository } },
  };
}

function run(
  headSha = HEAD,
  id = request.workflowRunId,
  pullRequests: readonly { readonly number: number }[] = [{ number: request.prNumber }],
) {
  return {
    id,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: headSha,
    repository: { full_name: "cinamoncandy/NUSA" },
    pull_requests: pullRequests,
  };
}

function headPulls(entries: readonly unknown[] = [{
  number: request.prNumber,
  state: "open",
  head: { sha: HEAD, repo: { full_name: "fork-owner/NUSA" } },
  base: { repo: { full_name: "cinamoncandy/NUSA" } },
}]) {
  return entries;
}

function needsFallback(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pullRequests = (value as { pull_requests?: unknown }).pull_requests;
  if (!Array.isArray(pullRequests)) return true;
  const numbers = [...new Set(pullRequests
    .map((entry) => entry && typeof entry === "object" ? (entry as { number?: unknown }).number : null)
    .filter((number): number is number => Number.isSafeInteger(number) && Number(number) > 0))];
  return numbers.length !== 1 || numbers[0] !== request.prNumber;
}

function fetchSequence(options: {
  readonly firstPull?: unknown;
  readonly firstRun?: unknown;
  readonly firstHeadPulls?: readonly unknown[];
  readonly diff?: string;
  readonly secondPull?: unknown;
  readonly secondRun?: unknown;
  readonly secondHeadPulls?: readonly unknown[];
} = {}) {
  const firstRun = options.firstRun ?? run();
  const secondRun = options.secondRun ?? firstRun;
  const queue = [
    response(200, options.firstPull ?? pull()),
    response(200, firstRun),
    ...(needsFallback(firstRun) ? [response(200, options.firstHeadPulls ?? headPulls())] : []),
    response(200, {}, options.diff ?? "diff --git a/a.ts b/a.ts\n+const safe = true;\n"),
    response(200, options.secondPull ?? options.firstPull ?? pull()),
    response(200, secondRun),
    ...(needsFallback(secondRun) ? [response(200, options.secondHeadPulls ?? options.firstHeadPulls ?? headPulls())] : []),
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

function aiSequence(responses: readonly unknown[]) {
  const queue = [...responses];
  return {
    async run() {
      if (queue.length === 0) throw new Error("unexpected extra AI.run call");
      return queue.shift();
    },
  };
}

function passingModel() {
  return ai({ response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS" }) });
}

function auditEnv(model?: ReturnType<typeof ai>) {
  return { AI: model, NUSA_GITHUB_TOKEN: "github-token" };
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

test("authenticates every GitHub evidence request without exposing the token", async () => {
  const sequence = fetchSequence();
  const requests: RequestInit[] = [];
  const result = await executeIndependentAudit(
    request,
    auditEnv(passingModel()),
    (async (_input: string, init?: RequestInit) => {
      if (init) requests.push(init);
      return sequence();
    }) as never,
  );
  assert.equal(result.verdict, "PASS");
  assert.ok(requests.length >= 5);
  for (const init of requests) {
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer github-token");
  }
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
    executeIndependentAudit(request, auditEnv(ai({ response: "{}" })), fetchSequence({ firstPull: pull(stale) }) as never),
    /AUDIT_PR_HEAD_MISMATCH/,
  );
});

test("fails closed when canonical CI is bound to another head or run", async () => {
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(ai({ response: "{}" })), fetchSequence({ firstRun: run("d".repeat(40)) }) as never),
    /AUDIT_CI_HEAD_MISMATCH/,
  );
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(ai({ response: "{}" })), fetchSequence({ firstRun: run(HEAD, request.workflowRunId + 1) }) as never),
    /AUDIT_CI_RUN_ID_MISMATCH/,
  );
});

test("resolves empty workflow_run.pull_requests through one open exact-head PR", async () => {
  const result = await executeIndependentAudit(
    request,
    auditEnv(passingModel()),
    fetchSequence({ firstRun: run(HEAD, request.workflowRunId, []), secondRun: run(HEAD, request.workflowRunId, []) }) as never,
    () => 101,
  );
  assert.equal(result.verdict, "PASS");
  assert.equal(result.mergeAllowed, true);
  assert.equal(result.reviewedHeadSha, HEAD);
});

test("allows a fork head while binding Audit to canonical base repository and exact head", async () => {
  const forkPull = pull(HEAD, BASE, 1, "contributor/NUSA", "cinamoncandy/NUSA");
  const result = await executeIndependentAudit(
    request,
    auditEnv(passingModel()),
    fetchSequence({
      firstPull: forkPull,
      secondPull: forkPull,
      firstRun: run(HEAD, request.workflowRunId, []),
      secondRun: run(HEAD, request.workflowRunId, []),
    }) as never,
  );
  assert.equal(result.verdict, "PASS");
});

test("fails closed when empty PR identity resolves to zero or multiple exact-head open PRs", async () => {
  const emptyRun = run(HEAD, request.workflowRunId, []);
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(passingModel()), fetchSequence({ firstRun: emptyRun, firstHeadPulls: [] }) as never),
    /AUDIT_CI_PR_IDENTITY_UNRESOLVED/,
  );
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(passingModel()), fetchSequence({
      firstRun: emptyRun,
      firstHeadPulls: headPulls([
        { number: request.prNumber, state: "open", head: { sha: HEAD }, base: { repo: { full_name: "cinamoncandy/NUSA" } } },
        { number: request.prNumber + 1, state: "open", head: { sha: HEAD }, base: { repo: { full_name: "cinamoncandy/NUSA" } } },
      ]),
    }) as never),
    /AUDIT_CI_PR_IDENTITY_UNRESOLVED/,
  );
});

test("fails closed when unique exact-head fallback points at a different PR", async () => {
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(passingModel()), fetchSequence({
      firstRun: run(HEAD, request.workflowRunId, []),
      firstHeadPulls: headPulls([{ number: request.prNumber + 1, state: "open", head: { sha: HEAD }, base: { repo: { full_name: "cinamoncandy/NUSA" } } }]),
    }) as never),
    /AUDIT_CI_PR_MISMATCH/,
  );
});

test("fails closed when current PR targets a different base repository", async () => {
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(passingModel()), fetchSequence({ firstPull: pull(HEAD, BASE, 1, "fork-owner/NUSA", "other/NUSA") }) as never),
    /AUDIT_PR_BASE_REPOSITORY_MISMATCH/,
  );
});

test("fails closed when GitHub diff evidence does not cover every changed file", async () => {
  const model = passingModel();
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(model), fetchSequence({ firstPull: pull(HEAD, BASE, 2), secondPull: pull(HEAD, BASE, 2) }) as never),
    /AUDIT_DIFF_FILE_COUNT_MISMATCH/,
  );
});

test("strict verdict schema rejects malformed, mutation-shaped, and inconsistent responses", () => {
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", patch: "diff" }), /AUDIT_VERDICT_KEYS_INVALID/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS", findings: [{ code: "NOTE", severity: "NOTE", message: "note", evidenceRef: null }], blockers: [], safetyInvariantResult: "PASS" }), /AUDIT_VERDICT_PASS_FINDINGS_FORBIDDEN/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS_WITH_NOTES", findings: [], blockers: ["blocker"], safetyInvariantResult: "PASS" }), /AUDIT_VERDICT_BLOCKERS_REQUIRE_FAIL/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS_WITH_NOTES", findings: [], blockers: [], safetyInvariantResult: "PASS" }), /AUDIT_VERDICT_NOTES_REQUIRED/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "PASS_WITH_NOTES", findings: [{ code: "NOTE", severity: "NOTE", message: "note", evidenceRef: null }], blockers: [], safetyInvariantResult: "FAIL" }), /AUDIT_VERDICT_SAFETY_REQUIRES_FAIL/);
  assert.throws(() => validateAuditModelVerdict({ verdict: "FAIL", findings: [], blockers: [], safetyInvariantResult: "FAIL" }), /AUDIT_VERDICT_FAIL_BLOCKER_REQUIRED/);
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
  const result = await executeIndependentAudit(request, auditEnv(model), fetchSequence() as never, () => 1234);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.safetyInvariantResult, "FAIL");
  assert.equal(result.reviewedHeadSha, HEAD);
});

test("detects PR head movement after model review", async () => {
  const model = passingModel();
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(model), fetchSequence({ secondPull: pull("e".repeat(40)) }) as never),
    /AUDIT_PR_HEAD_MISMATCH/,
  );
});

test("returns exact-head PASS_WITH_NOTES evidence but does not auto-authorize merge", async () => {
  const model = ai({
    response: "```json\n" + JSON.stringify({
      verdict: "PASS_WITH_NOTES",
      findings: [{ code: "NON_BLOCKING_NOTE", severity: "NOTE", message: "reviewed exact diff", evidenceRef: "a.ts:+1" }],
      blockers: [],
      safetyInvariantResult: "PASS",
    }) + "\n```",
  });
  const result = await executeIndependentAudit(request, auditEnv(model), fetchSequence() as never, () => 5678);
  assert.equal(result.status, "AUDIT_COMPLETED");
  assert.equal(result.verdict, "PASS_WITH_NOTES");
  assert.equal(result.mergeAllowed, false);
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

test("retries a malformed model response before failing, and returns the eventual valid verdict", async () => {
  const passing = JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS" });
  const model = aiSequence([{ response: "not json at all" }, { response: "{}" }, { response: passing }]);
  const result = await executeIndependentAudit(request, auditEnv(model), fetchSequence() as never, () => 1234);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.mergeAllowed, true);
});

test("does not retry AI provider or transport failures", async () => {
  let calls = 0;
  const model = {
    async run() {
      calls += 1;
      throw new Error("AUDIT_AI_PROVIDER_UNAVAILABLE");
    },
  };
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(model), fetchSequence() as never),
    /AUDIT_AI_PROVIDER_UNAVAILABLE/,
  );
  assert.equal(calls, 1);
});

test("fails closed after exhausting retries when the model response stays malformed every time (never fabricates a verdict)", async () => {
  const model = aiSequence([{ response: "not json" }, { response: "{}" }, { response: "still not json" }]);
  await assert.rejects(
    executeIndependentAudit(request, auditEnv(model), fetchSequence() as never),
    /AUDIT_VERDICT_INVALID|AUDIT_VERDICT_JSON_INVALID/,
  );
});

test("does not retry beyond the bounded attempt limit even if given more valid-eventually responses", async () => {
  const passing = JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS" });
  // 4 malformed responses queued; only 3 attempts are made, so this must still fail closed rather
  // than retry indefinitely -- an unbounded retry loop is exactly the "duplicate control-plane
  // waiting forever" failure mode this bound exists to prevent.
  const model = aiSequence([{ response: "bad-1" }, { response: "bad-2" }, { response: "bad-3" }, { response: passing }]);
  await assert.rejects(executeIndependentAudit(request, auditEnv(model), fetchSequence() as never));
});

test("fails closed when no independent AI audit engine is configured", async () => {
  await assert.rejects(executeIndependentAudit(request, { NUSA_GITHUB_TOKEN: "github-token" }, fetchSequence() as never), /AUDIT_AI_NOT_CONFIGURED/);
});

test("fails closed when GitHub evidence credentials are unavailable", async () => {
  await assert.rejects(executeIndependentAudit(request, { AI: passingModel() }, fetchSequence() as never), /AUDIT_GITHUB_TOKEN_NOT_CONFIGURED/);
});
