const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function checkIgnored(path) {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

test("Autopilot preflight evidence does not dirty the GitHub runner workspace", () => {
  assert.equal(checkIgnored("artifacts/autopilot-execution/cited-run.json"), true);
  assert.equal(checkIgnored("artifacts/autopilot-execution/dispatch-freshness.json"), true);
  // Written by the superseded-success freshness check since 2026-10-12; unignored it failed every
  // real coding attempt with CODING_RUNTIME_WORKSPACE_DIRTY (run 38375920359).
  assert.equal(checkIgnored("artifacts/autopilot-execution/cited-workflow-runs.json"), true);
});

test("workspace cleanliness remains fail-closed for unrelated paths", () => {
  assert.equal(checkIgnored("unexpected-autopilot-workspace-file.txt"), false);
  assert.equal(checkIgnored("package.json"), false);
});
