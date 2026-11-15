"use strict";
// R1 review P1 (PR #3136): GitHub Environment required reviewers cannot be enforced or read from code, so the workflow must fail closed until the owner
// enables it, and must stay a dispatch-only, read-only-token, no-secret, no-third-party-action workflow whose only host action is the helper's stop or start.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "paper-run-mode.yml"), "utf8").replace(/\r\n/g, "\n");
const lines = text.split("\n");
const code = lines.filter((l) => !/^\s*#/.test(l)).join("\n");

function job(name) {
  const start = code.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} exists`);
  const next = code.slice(start + 1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? code.slice(start) : code.slice(start, start + 1 + next);
}

test("dispatch only: no push, pull_request, schedule or workflow_run trigger", () => {
  assert.match(code, /\non:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(code, /\n\s+(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch|issue_comment):/);
  assert.match(code, /options:\n\s+- STOPPED\n\s+- COLLECT_ONLY\n/);
  assert.doesNotMatch(code, /PAPER_ORDERS|ORDERS_ON|options:[\s\S]*ON\b/, "no mode starts the order path");
});

test("least authority: contents read only, no secret, no third-party action", () => {
  assert.match(code, /\npermissions:\n  contents: read\n/);
  assert.doesNotMatch(code, /:\s*write\b/);
  assert.doesNotMatch(code, /secrets\./);
  assert.doesNotMatch(code, /\n\s*(-\s+)?uses:/, "no third-party action");
});

test("the guard job fails closed unless the owner enabled it and the actor is the repository owner", () => {
  const guard = job("guard");
  assert.match(guard, /runs-on: ubuntu-latest/);
  assert.match(guard, /ENABLED: \$\{\{ vars\.PAPER_RUN_MODE_ENABLED \}\}/);
  assert.match(guard, /\[ "\$ENABLED" != "true" \][\s\S]*exit 1/);
  assert.match(guard, /\[ "\$ACTOR" != "\$OWNER" \][\s\S]*exit 1/);
  assert.match(guard, /OWNER: \$\{\{ github\.repository_owner \}\}/);
});

test("the host job needs the guard, runs in the approval Environment on the host runner and shares the release concurrency group", () => {
  const apply = job("apply");
  assert.match(apply, /needs: guard\n/);
  assert.match(apply, /environment: paper-host-control\n/);
  assert.match(apply, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
  assert.match(code, /concurrency:\n  group: oracle-paper-release\n  cancel-in-progress: false/);
});

test("the mode reaches the script only through an environment variable, and the only host actions are the helper's stop and start", () => {
  const apply = job("apply");
  const interpolations = [...apply.matchAll(/\$\{\{[^}]*inputs\.mode[^}]*\}\}/g)].map((m) => m[0]);
  assert.deepEqual(interpolations, ["${{ inputs.mode }}"], "inputs.mode appears exactly once, in the env block");
  assert.match(apply, /MODE: \$\{\{ inputs\.mode \}\}/);
  const sudoCalls = [...apply.matchAll(/sudo\s+"\$STEP"\s+(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(sudoCalls, ["start", "stop"]);
  assert.doesNotMatch(apply, /systemctl\s+(start|stop|restart|enable|disable|mask|kill|daemon-reload)/, "no direct service control, only the helper");
});
