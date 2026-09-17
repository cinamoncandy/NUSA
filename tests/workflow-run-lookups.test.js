const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { validateWorkflowRunLookups } = require("../scripts/validate-workflow-run-lookups.js");

/**
 * Regression for the 2026-09-16 deployment deadlock.
 *
 * An unpaginated repository-wide `actions/runs?head_sha=...` reads only the 100 most recent runs
 * across all workflows. With main parked on one SHA, scheduled runs bury the real CI and deploy
 * runs, and the gate reports missing evidence for runs that exist. The credential preflight failed
 * that way, reopening canonical P0 #1461, which serialized Release behind the repair and blocked
 * the very PRs carrying it, while Android and Firebase distribution stayed down.
 */

function sandbox(files) {
  const root = mkdtempSync(join(tmpdir(), "nusa-run-lookups-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, ".github", "workflows", name), body, "utf8");
  return root;
}

const wf = (body) => ["name: X", "on:", "  push:", "jobs:", "  a:", "    steps:", `      - run: ${body}`, ""].join("\n");

test("the repository has no unpaginated repository-wide run lookups", () => {
  const result = validateWorkflowRunLookups();
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("the exact query that caused the deadlock fails", () => {
  const root = sandbox({ "bad.yml": wf('gh api "repos/$R/actions/runs?head_sha=$SHA&status=completed&per_page=100"') });
  const result = validateWorkflowRunLookups(root);
  assert.ok(result.failures.some((f) => f.startsWith("UNPAGINATED_REPOSITORY_WIDE_RUN_LOOKUP:bad.yml")), JSON.stringify(result.failures));
  rmSync(root, { recursive: true, force: true });
});

test("paginating the same query passes", () => {
  const root = sandbox({ "ok.yml": wf('gh api --paginate "repos/$R/actions/runs?head_sha=$SHA&per_page=100"') });
  assert.deepEqual(validateWorkflowRunLookups(root).failures, []);
  rmSync(root, { recursive: true, force: true });
});

test("scoping to a specific workflow passes without pagination", () => {
  const root = sandbox({ "ok.yml": wf('gh api "repos/$R/actions/workflows/ci.yml/runs?head_sha=$SHA&per_page=100"') });
  assert.deepEqual(validateWorkflowRunLookups(root).failures, []);
  rmSync(root, { recursive: true, force: true });
});

test("a wrapped call with --paginate on the previous line passes", () => {
  const body = [
    "name: X", "on:", "  push:", "jobs:", "  a:", "    steps:", "      - run: |",
    "          gh api --paginate \\",
    '            "repos/$R/actions/runs?head_sha=$SHA&per_page=100" \\',
    "            --jq '.workflow_runs[]'", ""
  ].join("\n");
  const root = sandbox({ "wrapped.yml": body });
  assert.deepEqual(validateWorkflowRunLookups(root).failures, []);
  rmSync(root, { recursive: true, force: true });
});

test("a second unpaginated lookup in the same file is reported on its own line", () => {
  const body = [
    "name: X", "on:", "  push:", "jobs:", "  a:", "    steps:", "      - run: |",
    '          gh api "repos/$R/actions/runs?head_sha=$A&per_page=100"',
    '          gh api "repos/$R/actions/runs?head_sha=$B&per_page=100"', ""
  ].join("\n");
  const root = sandbox({ "two.yml": body });
  const result = validateWorkflowRunLookups(root);
  assert.equal(result.failures.length, 2, JSON.stringify(result.failures));
  rmSync(root, { recursive: true, force: true });
});
