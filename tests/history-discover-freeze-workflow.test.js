"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "history-discover-freeze.yml"), "utf8").replace(/\r\n/g, "\n");
const run = text.slice(text.indexOf("run: |"));

test("history discover workflow is dispatch-only, read-only, pinned and never a release", () => {
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /\n  (push|pull_request|schedule):/);
  assert.match(text, /permissions:\n  contents: read/);
  assert.doesNotMatch(text, /uses:/);
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /systemctl|sudo|\/opt\/nusa\/current|\/etc\/nusa|NUSA_CLOUD_STATE_DB_PATH/);
  assert.match(run, /mining script hash mismatch/);
  assert.match(run, /fetch script hash mismatch/);
  assert.match(run, /manifest hash differs from the committed one/);
  assert.match(run, /trap 'rm -rf "\$tree" "\$work"' EXIT/);
});

test("only the discover phase runs, with the fixed historical windows, never the host windows file or the look", () => {
  assert.match(run, /run-history-mining\.js" discover /);
  assert.doesNotMatch(run, /run-history-mining\.js" look/);
  assert.doesNotMatch(run, /history-mining-windows\.json|run-history-mining-discover\.js/);
  assert.match(run, /--discovery-start 2021-12-20T00:00:00\.000Z --discovery-end 2023-06-30T00:00:00\.000Z --holdback-start 2023-07-05T00:00:00\.000Z --holdback-end 2024-10-31T23:00:00\.000Z/);
  assert.match(run, /--db "\$work\/store\.sqlite"/);
});

test("inputs reach the shell only through env and the annotation carries only the allowed line kinds", () => {
  assert.doesNotMatch(run, /\$\{\{/);
  assert.match(run, /grep -E '\^\(HISTORY_MANIFEST_SHA256\|HISTORY_MINING_DISCOVER\|HISTORY_MINING_FREEZE\|HISTORY_MINING_ERROR\)'/);
});
