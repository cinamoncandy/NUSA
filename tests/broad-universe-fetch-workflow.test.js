"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const text = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "broad-universe-fetch.yml"), "utf8").replace(/\r\n/g, "\n");
const steps = text.slice(text.indexOf("    steps:")).split("\n      - name: ").slice(1);
const [prepare, fetchStep, upload] = steps;

test("dispatch-only, read-only, hosted runner, never the PAPER host, not a release", () => {
  assert.match(text, /^on:\n  workflow_dispatch:\n    inputs:/m);
  assert.doesNotMatch(text, /\n  (push|pull_request|schedule):/);
  assert.match(text, /permissions:\n  contents: read/);
  assert.match(text, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(text, /self-hosted|nusa-paper-host/);
  assert.doesNotMatch(text, /systemctl|sudo|\/opt\/nusa|\/etc\/nusa/);
  assert.doesNotMatch(text, /actions\/checkout/);
  assert.equal(steps.length, 3);
});

test("the only action is the first-party upload-artifact pinned by the same commit sha as ci.yml; the token is visible to the download step only", () => {
  const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(uses, ["actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"]);
  const ci = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
  assert.ok(ci.includes("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"));
  assert.equal([...text.matchAll(/github\.token/g)].length, 1);
  assert.match(prepare, /GH_READ_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(fetchStep, /GH_READ_TOKEN|github\.token|secrets\./);
  assert.doesNotMatch(text, /secrets\./);
});

test("inputs are checked as whole values and both scripts and the pool file must match pinned hashes before anything runs", () => {
  assert.match(prepare, /\[\[ \$SOURCE_SHA =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(prepare, /for v in UNIVERSE_SHA256 BASE_SHA256 POOL_SHA256; do \[\[ \$\{!v\} =~ \^\[0-9a-f\]\{64\}\$ \]\]/);
  assert.match(prepare, /\[\[ \$GROUP =~ \^\[12\]\$ \]\]/);
  assert.match(prepare, /\[\[ \$REPRODUCE =~ \^\(true\|false\)\$ \]\]/);
  assert.match(prepare, /get scripts\/fetch-upbit-60m-universe\.js .*"\$UNIVERSE_SHA256"/);
  assert.match(prepare, /get scripts\/fetch-upbit-60m-history\.js .*"\$BASE_SHA256"/);
  assert.match(prepare, /get docs\/research-data\/broad-universe-filter-count-20bp-2026-11-24\.json .*"\$POOL_SHA256"/);
  assert.match(prepare, /hash mismatch/);
  for (const s of [prepare, fetchStep]) assert.doesNotMatch(s.slice(s.indexOf("run: |")), /\$\{\{/, "no expression interpolation inside the scripts");
  assert.match(fetchStep, /BROAD_INPUTS_OK" = "1"/);
});

test("the market list comes only from the committed pool, sorted and split in two halves; the input cannot name a market", () => {
  assert.doesNotMatch(text, /inputs\.markets|MARKETS:/);
  assert.match(prepare, /pool\.length < 40/);
  assert.match(prepare, /sorted\.slice\(0, half\) : sorted\.slice\(half\)/);
});

test("the fetch step prints only counts and hashes, honours the reproduction check and fails closed", () => {
  assert.match(fetchStep, /node "\$script" "\$BROAD_WORK\/run1" "g\$GROUP"/);
  assert.match(fetchStep, /UNIVERSE_REPRODUCTION_MISMATCH/);
  assert.match(fetchStep, /\[ "\$h1" != "\$h2" \]/);
  assert.match(fetchStep, /exit "\$status"/);
  assert.doesNotMatch(fetchStep, /curl|cat .*\.csv|head .*\.csv|\.csv"? *\|/);
  assert.match(fetchStep, /::notice title=broad-universe-fetch/);
});

test("only the first run's files are kept, for three days, and only after a successful fetch", () => {
  assert.match(upload, /if: env\.BROAD_FETCH_OK == '1'/);
  assert.match(upload, /retention-days: 3/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /path: \$\{\{ env\.BROAD_WORK \}\}\/run1/);
  assert.match(fetchStep, /rm -rf "\$BROAD_WORK\/run2"/);
});
