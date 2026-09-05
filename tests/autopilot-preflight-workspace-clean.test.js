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
});

test("workspace cleanliness remains fail-closed for unrelated paths", () => {
  assert.equal(checkIgnored("unexpected-autopilot-workspace-file.txt"), false);
  assert.equal(checkIgnored("package.json"), false);
});
