"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "broad-universe-probe.yml"), "utf8").replace(/\r\n/g, "\n");
const run = text.slice(text.indexOf("run: |"));

test("the probe is dispatch-only, read-only, on a hosted runner, with no checkout, action or secret, and not a release", () => {
  assert.match(text, /^on:\n  workflow_dispatch: \{\}/m);
  assert.doesNotMatch(text, /\n  (push|pull_request|schedule):/);
  assert.match(text, /permissions:\n  contents: read/);
  assert.match(text, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(text, /self-hosted|nusa-paper-host/, "never the PAPER host");
  assert.doesNotMatch(text, /uses:/);
  assert.doesNotMatch(text, /secrets\.|GITHUB_TOKEN|github\.token/);
  assert.doesNotMatch(text, /systemctl|sudo|\/opt\/nusa|\/etc\/nusa/);
  assert.doesNotMatch(run, /\$\{\{/, "no expression interpolation in the script");
});

test("only public Upbit GETs, a fixed small number of requests, and only status codes, the quota header and sizes are printed", () => {
  const urls = [...run.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(urls.length === 3 && urls.every((u) => u.startsWith("https://api.upbit.com/v1/")));
  assert.match(run, /for i in 1 2 3 4 5 6 7 8 9 10 11 12/);
  assert.doesNotMatch(run, /curl[^\n]*(-X (POST|PUT|DELETE)|--data|\s-d\s)/);
  assert.match(run, /-o "\$body"/, "bodies go to a temp file and are deleted, never printed");
  assert.doesNotMatch(run, /cat "\$body"|jq|cat "\$hdr"/);
  assert.match(run, /echo "\$label status=\$\{code:-000\} remaining=\$\{rem:-none\} bytes=\$size"/);
});

test("it fails on a regional block and succeeds only if at least one request got 200", () => {
  assert.match(run, /status=\(451\|403\|418\)/);
  assert.match(run, /\[ "\$blocked" = "0" \] && \[ "\$ok" -ge 1 \]/);
});
