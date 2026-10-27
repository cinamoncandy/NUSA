const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

test("the cloud reachability report covers every module once and keeps LIVE boundaries out of the candidates", () => {
  const summary = JSON.parse(execFileSync(process.execPath, ["scripts/report-cloud-reachability.js"], { encoding: "utf8" }));
  assert.equal(summary.host + summary.productSurfaceKeep + summary.liveBoundaryKeep + summary.unreachedCheck, summary.modules);
  assert.ok(summary.host > 0);
  const rows = execFileSync(process.execPath, ["scripts/report-cloud-reachability.js", "--markdown"], { encoding: "utf8" }).trim().split("\n");
  for (const row of rows.filter((line) => /UNREACHED_CHECK/.test(line))) assert.doesNotMatch(row, /`live/, "a live* module is never a removal candidate");
  assert.ok(rows.some((line) => /`closedLearningProductionRuntime\.ts`/.test(line)) === false, "the host entry is reached");
});
