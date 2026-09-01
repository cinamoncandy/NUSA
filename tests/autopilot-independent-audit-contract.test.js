const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const workflow = fs.readFileSync(".github/workflows/autopilot-execution-consumer.yml", "utf8");
const worker = fs.readFileSync("apps/autopilot/src/worker.ts", "utf8");
const auditRunner = fs.readFileSync("apps/autopilot/src/auditRunner.ts", "utf8");

test("execution consumer removes workflow-wide mutation permissions", () => {
  assert.match(workflow, /permissions: \{\}/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("jobs:")), /contents: write|actions: write|pull-requests: write/);
});

test("Audit job has bounded read/OIDC/comment permissions only", () => {
  const auditJob = workflow.slice(workflow.indexOf("  audit-request:"));
  const permissionBlock = auditJob.match(/permissions:\n([\s\S]*?)    steps:/)?.[1] ?? "";
  assert.match(permissionBlock, /contents: read/);
  assert.match(permissionBlock, /actions: read/);
  assert.match(permissionBlock, /pull-requests: write/);
  assert.match(permissionBlock, /id-token: write/);
  assert.doesNotMatch(permissionBlock, /contents: write|actions: write/);
});

test("Audit execution is isolated from coding mutation endpoint", () => {
  assert.match(worker, /url\.pathname === "\/audit\/execute"/);
  assert.match(worker, /executeIndependentAudit\(auditRequest, env\)/);
  const auditHandler = worker.slice(worker.indexOf("async function handleAuditExecute"), worker.indexOf("const worker ="));
  assert.doesNotMatch(auditHandler, /GithubValidatedPatchPublisher|SandboxCodingRuntime|publish\(|create_branch|commit|merge/);
  assert.match(auditHandler, /verifyGithubActionsOidcToken/);
  assert.doesNotMatch(auditHandler, /NUSA_CODING_RUNNER_TOKEN/);
});

test("independent Audit re-fetches exact PR/head/base/CI and uses GET-only GitHub evidence", () => {
  assert.match(auditRunner, /verifyCurrentPullAndCi\(request, fetchImpl\)/);
  assert.equal((auditRunner.match(/await verifyCurrentPullAndCi\(request, fetchImpl\);/g) ?? []).length, 2);
  assert.match(auditRunner, /method: "GET"/);
  assert.doesNotMatch(auditRunner, /method: "POST"|method: "PATCH"|method: "PUT"|method: "DELETE"/);
  assert.match(auditRunner, /AUDIT_PR_HEAD_MISMATCH/);
  assert.match(auditRunner, /AUDIT_PR_BASE_MISMATCH/);
  assert.match(auditRunner, /AUDIT_CI_HEAD_MISMATCH/);
  assert.match(auditRunner, /AUDIT_CI_PR_MISMATCH/);
});

test("Audit request is idempotent and verdict is exact-head machine-readable evidence", () => {
  const auditJob = workflow.slice(workflow.indexOf("  audit-request:"));
  assert.match(auditJob, /nusa-audit-verdict:\$\{PR_NUMBER\}:\$\{WORKFLOW_RUN_ID\}:\$\{REQUESTED_HEAD\}/);
  assert.match(auditJob, /Detect existing exact-head Audit verdict/);
  assert.match(auditJob, /skip=true/);
  assert.match(auditJob, /Re-verify PR identity after Audit execution/);
  assert.match(auditJob, /PR head moved during Audit/);
  assert.match(auditJob, /PR base moved during Audit/);
  assert.match(auditJob, /JSON\.stringify\(result\)/);
});

test("FAIL and malformed safety evidence cannot advance Release", () => {
  const auditJob = workflow.slice(workflow.indexOf("  audit-request:"));
  assert.match(auditJob, /result\.verdict === 'FAIL'/);
  assert.match(auditJob, /result\.mergeAllowed !== true/);
  assert.match(auditJob, /result\.safetyInvariantResult !== 'PASS'/);
  assert.match(auditJob, /process\.exit\(1\)/);
  assert.match(auditRunner, /AUDIT_VERDICT_KEYS_INVALID/);
  assert.match(auditRunner, /AUDIT_VERDICT_SAFETY_REQUIRES_FAIL/);
  assert.match(auditRunner, /AUDIT_RUNNER_MUTATION_FORBIDDEN/);
});
