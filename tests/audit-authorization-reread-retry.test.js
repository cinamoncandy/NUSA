"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-deterministic-audit-release.yml"), "utf8").replace(/\r\n/g, "\n");
const step = text.slice(text.indexOf("- name: Publish exact-head release authorization"), text.indexOf("- name: Re-verify durable control-plane clearance before merge"));

test("the authorization re-read waits for the same status id (bounded) and the validation is unchanged", () => {
  assert.ok(step.length > 500, "step found");
  assert.match(step, /for attempt in 1 2 3 4 5; do/);
  assert.match(step, /select\(\.id == \$status_id\)/);
  assert.match(step, /\[ -n "\$observed_status" \] && break\n\s+sleep 2/);
  // both strict checks remain, after the loop, and still fail closed under set -e
  const loopEnd = step.indexOf("done", step.indexOf("for attempt in"));
  const after = step.slice(loopEnd);
  assert.match(after, /jq -e --argjson id "\$status_id"/);
  assert.match(after, /\.state == "success" and \.context == \$context/);
  assert.match(step, /set -euo pipefail/);
  assert.match(step, /\.creator\.login == \$creator/);
});

test("nothing else in the step was relaxed: head, base, hold, draft and main checks are all still there", () => {
  for (const needle of ['test "$(jq -r \'.state\' <<<"$pr")" = "open"', 'test "$release_hold" = "false"', 'test "$(jq -r \'.head.sha\' <<<"$pr")" = "$EXPECTED_HEAD"', 'test "$main" = "$AUDITED_BASE"', "nusa-release-authority[bot]"]) {
    assert.ok(step.includes(needle), needle);
  }
});
