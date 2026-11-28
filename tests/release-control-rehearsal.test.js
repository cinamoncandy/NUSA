"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { rehearse } = require("../scripts/release-control-rehearsal.js");

const clean = fs.readFileSync("config/release-control.json", "utf8");
const workflow = fs.readFileSync(".github/workflows/release-control-rehearsal.yml", "utf8").replace(/\r\n/g, "\n");
const commands = workflow.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");

test("the real gate refuses every case and clears the controls", () => {
  const { rows, pass } = rehearse(clean);
  assert.equal(pass, true, JSON.stringify(rows.filter((r) => !r.ok)));
  assert.equal(rows.filter((r) => r.expect === "BLOCK").length, 30);
  assert.deepEqual(rows.filter((r) => r.expect === "CLEAR").map((r) => r.name), ["control-clear", "control-worker-unreachable"]);
});

test("a gate that releases anything, or blocks everything, fails the rehearsal", () => {
  assert.equal(rehearse(clean, () => ({ decision: "CLEAR", code: "X" })).pass, false);
  assert.equal(rehearse(clean, () => ({ decision: "BLOCK", code: "X" })).pass, false, "always-BLOCK is caught by the controls");
  const onlyOne = rehearse(clean, (i) => (i.worker && i.worker.decision === "BLOCK" ? { decision: "CLEAR", code: "X" } : require("../scripts/release-control-gate").decideRelease(i)));
  assert.equal(onlyOne.pass, false);
  assert.deepEqual(onlyOne.rows.filter((r) => !r.ok).map((r) => r.name), ["12-worker-block"]);
});

test("the command line prints one line per case and exits 0 only on PASS", () => {
  const ok = spawnSync(process.execPath, ["scripts/release-control-rehearsal.js", "config/release-control.json"], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /RELEASE_CONTROL_REHEARSAL_RESULT PASS cases=32/);
  assert.equal(ok.stdout.trim().split("\n").length, 33);
  assert.doesNotMatch(ok.stdout, /ok=false/);
});

test("the workflow is dispatch-only, read-only, secret-free and publishes nothing", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.doesNotMatch(workflow, /: write|secrets\.|id-token|create-github-app-token/);
  assert.doesNotMatch(commands, /--method|-X\s|\bPOST\b|statuses|merge|workers\.dev|\buses:/);
  assert.match(commands, /env -i PATH="\$PATH" node "\$dir\/release-control-rehearsal\.js"/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
});

test("case 1 survives the shell's -e: the expected failed read is captured with || instead of ending the step", () => {
  assert.match(workflow, /rc=0; err="\$\(timeout 20 gh api [^\n]*\)" \|\| rc=\$\?/);
  assert.doesNotMatch(workflow, /missing\.json"\)"; rc=\$\?/);
});
