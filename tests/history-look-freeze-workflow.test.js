"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "history-look-freeze.yml"), "utf8").replace(/\r\n/g, "\n");
const run = text.slice(text.indexOf("run: |"));

test("the look workflow is dispatch-only, read-only, pinned and never a release", () => {
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /\n  (push|pull_request|schedule):/);
  assert.match(text, /permissions:\n  contents: read\n  actions: read/, "actions: read is needed to count earlier runs");
  assert.doesNotMatch(text, /uses:/);
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /systemctl|sudo|\/opt\/nusa\/current|\/etc\/nusa|NUSA_CLOUD_STATE_DB_PATH/);
  assert.match(run, /mining script hash mismatch/);
  assert.match(run, /fetch script hash mismatch/);
  assert.match(run, /freeze record hash mismatch/);
  assert.match(run, /manifest hash differs from the committed one; no look was run/);
  assert.match(run, /trap 'rm -rf "\$tree" "\$work"' EXIT/);
  assert.doesNotMatch(run, /\$\{\{/, "inputs only through env");
});

test("the look needs the owner's sentence and runs at most once", () => {
  assert.match(run, /\[\[ \$CONFIRM == "OWNER-WORD-ONE-LOOK-H2-2026-11-23" \]\]/);
  assert.match(run, /status=success&per_page=1/);
  assert.match(run, /the one look is already spent/);
  assert.ok(run.indexOf("the one look is already spent") < run.indexOf("run-history-mining.js\" look"), "the spent check precedes the look");
  assert.ok(run.indexOf("OWNER-WORD-ONE-LOOK") < run.indexOf("curl"), "the confirmation precedes any download");
  assert.equal((run.match(/run-history-mining\.js" look /g) || []).length, 1, "exactly one look invocation");
  assert.doesNotMatch(run, /run-history-mining\.js" discover/);
  assert.match(run, /HISTORY_MINING_LOOK /);
  assert.match(run, /grep -qE '\^HISTORY_MINING_LOOK \\\{"status":"LOOK_\(PASS\|FAIL\)"' && exit 0/, "a printed LOOK_PASS or LOOK_FAIL spends the look whatever the exit status");
  assert.match(run, /FREEZE_MISMATCH and ALREADY_LOOKED[^\n]*do not spend the look/);
  assert.match(run, /\[ "\$status" -ne 0 \] && exit "\$status"\n\s+exit 1\n/, "any other outcome fails the run");
});

test("the frozen record binds the look, the token is gone before unpinned code runs, and only allowed lines are shown", () => {
  assert.match(run, /history-mining-h2-freeze-record-2026-11-23\.json/);
  assert.match(run, /r\.freeze\.lookedAt !== null/);
  assert.ok(run.indexOf("unset GH_READ_TOKEN") > run.indexOf("freeze record hash mismatch") && run.indexOf("unset GH_READ_TOKEN") < run.indexOf("run-history-mining.js\" look"));
  assert.match(run, /grep -E '\^\(HISTORY_NODE_VERSION\|HISTORY_MINING_LOOK\|HISTORY_MINING_ERROR\)'/);
  assert.doesNotMatch(run, /history-mining-windows\.json/);
});
