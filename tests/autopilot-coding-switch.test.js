const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const yaml = require("js-yaml");

const workflow = yaml.load(fs.readFileSync(".github/workflows/autopilot-execution-consumer.yml", "utf8"));

test("Autopilot coding runs only when the owner sets NUSA_AUTOPILOT_CODING_ENABLED to 'true'", () => {
  const condition = String(workflow.jobs.consume.if);
  assert.match(condition, /client_payload\.kind == 'REPOSITORY_AUTOPILOT'/);
  assert.match(condition, /vars\.NUSA_AUTOPILOT_CODING_ENABLED == 'true'/);
});

test("the coding switch never gates Audit or Release", () => {
  for (const job of ["audit-request", "release-handoff", "audit-recovery"]) {
    assert.doesNotMatch(String(workflow.jobs[job].if ?? ""), /NUSA_AUTOPILOT_CODING_ENABLED/, job);
  }
  const audit = fs.readFileSync(".github/workflows/autopilot-deterministic-audit-release.yml", "utf8");
  assert.doesNotMatch(audit, /NUSA_AUTOPILOT_CODING_ENABLED/);
});
