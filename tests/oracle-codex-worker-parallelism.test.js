"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const WORKFLOW = readFileSync(join(__dirname, "..", ".github", "workflows", "oracle-codex-dev.yml"), "utf8");

/**
 * oracle-codex-dev.yml is the only Codex worker execution path in this repository, so whatever it
 * serializes is the real ceiling on #2117 worker parallelism -- ahead of any allocator or WIP
 * budget, and regardless of how many runners carry the label.
 */

function concurrencyGroup() {
  const match = WORKFLOW.match(/^concurrency:\n(?:\s+#.*\n)*\s+group:\s*(.+)$/m);
  assert.ok(match, "the workflow must declare a concurrency group");
  return match[1].trim();
}

// A tiny evaluator for the ${{ ... }} forms this group actually uses, so the test reasons about
// what GitHub would compute rather than about the string that spells it.
function renderGroup(group, inputs) {
  return group.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_whole, expression) => {
    const [primary, fallback] = expression.split("||").map((part) => part.trim());
    const key = primary.replace(/^inputs\./, "");
    const value = inputs[key];
    if (value !== undefined && value !== "") return String(value);
    if (fallback === undefined) return "";
    return fallback.replace(/^'|'$/g, "");
  });
}

test("two different Codex tasks are not serialized behind one global group", () => {
  const group = concurrencyGroup();
  const a = renderGroup(group, { mode: "task", task: "2117-worker-a" });
  const b = renderGroup(group, { mode: "task", task: "2117-worker-b" });
  assert.notEqual(a, b, "distinct tasks sharing a concurrency group cap the worker pool at 1");
});

test("re-dispatching the same task still shares a group, so duplicate work stays suppressed", () => {
  const group = concurrencyGroup();
  assert.equal(
    renderGroup(group, { mode: "task", task: "2117-worker-a" }),
    renderGroup(group, { mode: "task", task: "2117-worker-a" }),
  );
});

test("device login stays serialized, because two logins race the same credential", () => {
  const group = concurrencyGroup();
  assert.equal(renderGroup(group, { mode: "login" }), renderGroup(group, { mode: "login" }));
  assert.notEqual(renderGroup(group, { mode: "login" }), renderGroup(group, { mode: "task", task: "x" }));
});

test("a queued worker is never cancelled by the next dispatch", () => {
  // cancel-in-progress would discard a worker mid-implementation and count as rework, not throughput.
  assert.match(WORKFLOW, /^concurrency:\n(?:\s+#.*\n)*\s+group:.*\n\s+cancel-in-progress:\s*false$/m);
});

test("the worker boundary this path depends on is unchanged", () => {
  // Parallelism must not come at the cost of the execution boundary: this path proposes a patch,
  // it never commits, pushes, opens a PR, merges, or deploys.
  assert.match(WORKFLOW, /runs-on:\s*\[self-hosted, Linux, ARM64, nusa-codex-dev\]/);
  assert.match(WORKFLOW, /if:\s*github\.actor == 'cinamoncandy'/);
  assert.match(WORKFLOW, /Do not commit, push, open\/reopen a PR, merge, deploy, or trigger remote CI\./);
  assert.match(WORKFLOW, /aiAuthority=ZERO_AUTHORITY/);
  assert.match(WORKFLOW, /permissions:\n\s+contents: read/);
});
