"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "history-fetch-freeze.yml"), "utf8").replace(/\r\n/g, "\n");

test("history fetch workflow is dispatch-only, read-only, pinned and never a release", () => {
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /\n  (push|pull_request|schedule):/);
  assert.match(text, /permissions:\n  contents: read/);
  assert.doesNotMatch(text, /uses:/, "no third-party action, no checkout");
  assert.doesNotMatch(text, /secrets\./, "no secret");
  assert.doesNotMatch(text, /systemctl|sudo|\/opt\/nusa\/current|\/etc\/nusa/, "does not touch the service or its files");
  assert.match(text, /\[0-9a-f\]\{40\}/);
  assert.match(text, /\[0-9a-f\]\{64\}/);
  assert.match(text, /script hash mismatch/);
  assert.match(text, /env -u GH_READ_TOKEN ionice -c3 nice -n19 node/);
  assert.match(text, /trap 'rm -rf "\$tree" "\$dir"' EXIT/);
});

test("inputs reach the shell only through env, never interpolated into the script body", () => {
  const run = text.slice(text.indexOf("run: |"));
  assert.doesNotMatch(run, /\$\{\{/);
});

test("the annotation carries the manifest and failure lines and cannot drop the hash line", () => {
  assert.match(text, /grep -E '\^\(HISTORY_MANIFEST\|HISTORY_FETCH_FAILED\)'/);
  assert.match(text, /\$\{key:0:8000\}/);
  assert.doesNotMatch(text, /\$\{out:0:3500\}/);
});
