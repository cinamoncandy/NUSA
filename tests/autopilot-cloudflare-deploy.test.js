const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readNulDelimitedPaths, selectLastSuccessfulDeploymentSha, workerRuntimeChanged } = require("../scripts/autopilot-worker-deploy-scope");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-deploy.yml"), "utf8");
const readiness = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "cloudflare-deployment-readiness.yml"), "utf8");

test("Cloudflare deployment recovers after a CI-only repair merge", () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[CI\]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /Wait for exact-head CI success before deploying/);
  assert.match(workflow, /Verify exact current main revision/);
  assert.match(workflow, /deploymentRevision/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /NUSA_AUTOPILOT_RUNTIME_TOKEN/);
  assert.match(workflow, /NUSA_AUTOPILOT_GITHUB_TOKEN/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /AI authority=ZERO_AUTHORITY/);
});

test("deployment is Worker-only and has no paid Cloudflare Containers rollout", () => {
  assert.match(workflow, /Workers Free-compatible runtime/);
  assert.match(workflow, /wrangler@4\.127\.1 deploy/);
  assert.match(workflow, /--var "NUSA_DEPLOYMENT_REVISION:\$\{HEAD_SHA\}"/);
  assert.doesNotMatch(workflow, /Determine Container rollout mode/);
  assert.doesNotMatch(workflow, /CONTAINERS_ROLLOUT/);
  assert.doesNotMatch(workflow, /--containers-rollout/);
  assert.doesNotMatch(workflow, /containers list/);
});

test("Jev shadow deployment does not override the global release freeze", () => {
  assert.match(workflow, /--var "NUSA_AUTOPILOT_ZERO_CREDIT_MODE:true"/);
  assert.match(workflow, /--var "NUSA_JEV_SHADOW_ENABLED:true"/);
  assert.match(workflow, /--var "NUSA_JEV_BOUNDED_ROUTING_ENABLED:false"/);
  assert.doesNotMatch(workflow, /--var "NUSA_GLOBAL_RELEASE_FREEZE:false"/);
});

test("deployment fail-closes and synchronizes the persistent runtime secret before Worker deploy", () => {
  const preflightIndex = workflow.indexOf("Verify Cloudflare deployment credentials and account access");
  const secretIndex = workflow.indexOf("Sync persistent Autopilot runtime bearer secret");
  const deployIndex = workflow.indexOf("Deploy exact CI-verified revision to Cloudflare Workers Free-compatible runtime");
  assert.ok(preflightIndex >= 0);
  assert.ok(secretIndex > preflightIndex);
  assert.ok(deployIndex > secretIndex);
  assert.match(workflow, /secrets\.NUSA_AUTOPILOT_RUNTIME_TOKEN/);
  assert.match(workflow, /secrets\.NUSA_AUTOPILOT_GITHUB_TOKEN/);
  assert.match(workflow, /\$\{#NUSA_AUTOPILOT_RUNTIME_TOKEN\}.*-lt 32/);
  assert.match(workflow, /wrangler@4\.127\.1 secret put NUSA_AUTOPILOT_RUNTIME_TOKEN/);
  assert.match(workflow, /printf '%s' "\$NUSA_AUTOPILOT_RUNTIME_TOKEN"/);
  assert.doesNotMatch(workflow, /echo\s+["']?\$\{?NUSA_AUTOPILOT_RUNTIME_TOKEN/, "the secret value itself must never be echoed");
});

test("deployment authenticates read-only before attempting Cloudflare mutation", () => {
  const preflightIndex = workflow.indexOf("Verify Cloudflare deployment credentials and account access");
  const deployIndex = workflow.indexOf("Deploy exact CI-verified revision to Cloudflare Workers Free-compatible runtime");
  assert.ok(preflightIndex >= 0);
  assert.ok(deployIndex > preflightIndex);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /wrangler@4\.127\.1 whoami/);
  assert.match(workflow, /Cloudflare authentication\/account preflight failed/);
  assert.match(workflow, /Cloudflare token\/account\/runtime-secret preflight passed/);
  assert.match(workflow, /NUSA_AUTOPILOT_GITHUB_TOKEN/);
});

test("daily read-only readiness guard detects broken Cloudflare credentials before deployment day", () => {
  assert.match(readiness, /schedule:/);
  assert.match(readiness, /cron: "30 0 \* \* \*"/);
  assert.match(readiness, /workflow_dispatch:/);
  assert.match(readiness, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(readiness, /contents: write/);
  assert.match(readiness, /wrangler@4\.127\.1 whoami/);
  assert.match(readiness, /CLOUDFLARE_API_TOKEN/);
  assert.match(readiness, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(readiness, /deploymentRevision/);
  assert.match(readiness, /liveAuthority == "NONE"/);
  assert.match(readiness, /productionMutationAllowed == false/);
  assert.doesNotMatch(readiness, /wrangler@4\.127\.1 deploy/);
});

test("deployment accepts a direct workflow_dispatch with exact head_sha for GITHUB_TOKEN-dispatched CI runs", () => {
  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*head_sha:/);
  assert.match(workflow, /required: true/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /inputs\.head_sha/);
});

test("deployment workflow remains read-only toward GitHub contents and cannot mutate the repository", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /Skipping stale push/);
  assert.match(workflow, /HUMAN_ONLY blocker/);
  assert.match(workflow, /Failing closed/);
});

test("only a token-dispatched fallback deploy directly dispatches Runtime Proof", () => {
  assert.match(workflow, /permissions:[^]*actions: write/);
  assert.match(workflow, /Dispatch Runtime Proof directly for token-dispatched fallback deploy/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.actor == 'github-actions\[bot\]'/);
  assert.match(workflow, /Normal push\/workflow_run Deploy completions already feed Runtime Proof/);
  assert.match(workflow, /actions\/workflows\/autopilot-cloudflare-runtime-proof\.yml\/dispatches/);
  assert.match(workflow, /-f ref=main/);
});

// An exact head can carry more than one CI run: the push-triggered one and the
// GITHUB_TOKEN-dispatched one that exists because a token-dispatched run fires no workflow_run
// listeners. Concurrency cancels whichever loses the race. Reading one arbitrary run and failing
// closed on it let a cancelled duplicate veto a deployment whose exact head had passed CI, which
// is what stalled e29be261 and, through the credential preflight, reopened the canonical P0.
test("the exact-head CI wait reads every run for that head, not one arbitrary run", () => {
  const start = workflow.indexOf("Wait for exact-head CI success before deploying");
  assert.ok(start > 0, "the wait step must exist");
  const step = workflow.slice(start, workflow.indexOf("Verify exact current main revision", start));

  assert.doesNotMatch(step, /\]\[0\]\.conclusion/, "a single indexed run is not evidence about the head");
  assert.match(step, /--paginate/, "one page of repository-wide runs can bury the matching run");
  assert.match(step, /run\?\.name === 'CI'/);
  assert.match(step, /run\?\.path === '\.github\/workflows\/ci\.yml'/);
  assert.match(step, /String\(run\?\.head_sha \|\| ''\)\.toLowerCase\(\) === expected/);
});

test("a cancelled duplicate does not count as a failed verdict, a real failure still does", () => {
  const start = workflow.indexOf("Wait for exact-head CI success before deploying");
  const step = workflow.slice(start, workflow.indexOf("Verify exact current main revision", start));

  assert.match(step, /conclusions\.has\('success'\)/, "any successful exact-head CI clears the gate");
  assert.match(step, /conclusions\.has\('failure'\) \|\| conclusions\.has\('timed_out'\)/, "a real negative verdict still fails closed");
  assert.doesNotMatch(step, /conclusions\.has\('cancelled'\)/, "a cancelled run is the absence of a verdict, not a negative one");
  // Absence of a decisive verdict keeps waiting rather than deploying.
  assert.match(step, /console\.log\('pending'\)/);
  assert.match(step, /Timed out waiting for exact-head CI/);
  assert.match(step, /exit 1/);
});

test("Worker deployment scope includes only runtime source and build inputs", () => {
  for (const file of [
    "apps/autopilot/src/worker.ts",
    "apps/autopilot/wrangler.jsonc",
    "packages/contracts/src/referenceIntelligence.ts",
    "apps/cloud/src/ai/jevShadowProvider.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
  ]) {
    assert.equal(workerRuntimeChanged([file]), true, `${file} affects the Worker runtime or build`);
  }
});

test("tests, docs, mobile, AIPOS, and workflow-only changes skip Worker deployment", () => {
  assert.equal(workerRuntimeChanged([
    "tests/autopilot-cloudflare-deploy.test.js",
    ".aipos/state.yaml",
    "docs/operations.md",
    "apps/mobile/App.tsx",
    ".github/workflows/autopilot-deterministic-audit-release.yml",
  ]), false);
  assert.equal(workerRuntimeChanged([]), false);
});

test("NUL-delimited git paths preserve spaces and reject malformed input", () => {
  assert.deepEqual(readNulDelimitedPaths(Buffer.from("apps/autopilot/src/worker test.ts\0docs/a b.md\0")), [
    "apps/autopilot/src/worker test.ts",
    "docs/a b.md",
  ]);
  assert.throws(() => readNulDelimitedPaths(Buffer.from("docs/no-terminator")), /NUL terminated/);
  assert.throws(() => workerRuntimeChanged(["../apps/autopilot/src/worker.ts"]), /invalid repository path/);
});

test("deployment baseline uses newest successful exact-main workflow run, not a queued or failed run", () => {
  const sha = (digit) => digit.repeat(40);
  const pages = [{ workflow_runs: [
    { id: 7, status: "completed", conclusion: "failure", head_branch: "main", head_repository: { full_name: "cinamoncandy/NUSA" }, head_sha: sha("7"), created_at: "2026-10-02T10:00:00Z" },
    { id: 8, status: "in_progress", conclusion: null, head_branch: "main", head_repository: { full_name: "cinamoncandy/NUSA" }, head_sha: sha("8"), created_at: "2026-10-02T11:00:00Z" },
    { id: 9, status: "completed", conclusion: "success", head_branch: "feature", head_repository: { full_name: "cinamoncandy/NUSA" }, head_sha: sha("9"), created_at: "2026-10-02T12:00:00Z" },
    { id: 10, status: "completed", conclusion: "success", head_branch: "main", head_repository: { full_name: "other/repo" }, head_sha: sha("a"), created_at: "2026-10-02T13:00:00Z" },
    { id: 11, status: "completed", conclusion: "success", head_branch: "main", head_repository: { full_name: "cinamoncandy/NUSA" }, head_sha: sha("b"), created_at: "2026-10-02T14:00:00Z" },
  ] }];
  assert.equal(selectLastSuccessfulDeploymentSha(pages, 12, "cinamoncandy/NUSA"), sha("b"));
  assert.equal(selectLastSuccessfulDeploymentSha(pages[0], 12, "cinamoncandy/NUSA"), sha("b"));
  assert.equal(selectLastSuccessfulDeploymentSha([{ workflow_runs: [] }], 12, "cinamoncandy/NUSA"), null);
  assert.throws(() => selectLastSuccessfulDeploymentSha([{}], 12, "cinamoncandy/NUSA"), /malformed/);
});

test("deploy scope runs after exact-main check, skips mutations, and preserves explicit dispatch", () => {
  const scopeIndex = workflow.indexOf("Determine whether exact main changes Worker runtime inputs");
  const credentialIndex = workflow.indexOf("Verify Cloudflare deployment credentials and account access");
  const secretIndex = workflow.indexOf("Sync persistent Autopilot runtime bearer secret");
  const deployIndex = workflow.indexOf("Deploy exact CI-verified revision to Cloudflare Workers Free-compatible runtime");
  const scope = workflow.slice(scopeIndex, credentialIndex);

  assert.ok(scopeIndex > workflow.indexOf("Verify exact current main revision"));
  assert.ok(credentialIndex > scopeIndex);
  assert.ok(secretIndex > credentialIndex);
  assert.ok(deployIndex > secretIndex);
  assert.match(scope, /actions\/workflows\/autopilot-cloudflare-deploy\.yml\/runs\?branch=main&status=completed&per_page=100/);
  assert.match(scope, /--last-successful-deployment/);
  assert.match(scope, /git merge-base --is-ancestor "\$baseline" "\$HEAD_SHA"/);
  assert.match(scope, /git diff --no-renames --name-only -z "\$baseline" "\$HEAD_SHA"/);
  assert.match(scope, /scripts\/autopilot-worker-deploy-scope\.js/);
  assert.match(scope, /workflow_dispatch/);
  assert.match(scope, /ACTOR.*github\.actor/);
  assert.match(scope, /\$ACTOR.*github-actions\[bot\]/);
  assert.match(scope, /worker_runtime_changed=true/);
  assert.match(scope, /exit 1/);
  assert.match(workflow, /fetch-depth: 0/, "full exact-main ancestry must be available to compare from the last deployment");

  for (const step of ["Deploy exact CI-verified revision to Cloudflare Workers Free-compatible runtime", "Verify deployed Worker reports the exact-head revision and fail-closed authority"]) {
    const index = workflow.indexOf(step);
    const conditionStart = workflow.indexOf("if:", index);
    assert.match(workflow.slice(conditionStart, workflow.indexOf("\n", conditionStart)), /steps\.deploy_scope\.outputs\.worker_runtime_changed == 'true'/, `${step} must be gated by a relevant exact-main delta`);
  }
  // A rotated credential must reach the live Worker even when the rollout is skipped.
  for (const step of ["Verify Cloudflare deployment credentials and account access", "Sync persistent Autopilot runtime bearer secret", "Sync Worker GitHub API credential"]) {
    const index = workflow.indexOf(step);
    const conditionStart = workflow.indexOf("if:", index);
    const condition = workflow.slice(conditionStart, workflow.indexOf("\n", conditionStart));
    assert.match(condition, /steps\.revision\.outputs\.current == 'true'/);
    assert.doesNotMatch(condition, /worker_runtime_changed/, `${step} must run on every exact-main deploy run`);
  }

  assert.doesNotMatch(workflow, /\.github\/workflows\/autopilot-cloudflare-deploy\.yml\"/);
});
