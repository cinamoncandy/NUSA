"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const text = fs.readFileSync(path.join(root, ".github", "workflows", "broad-universe-discover.yml"), "utf8").replace(/\r\n/g, "\n");
const steps = text.slice(text.indexOf("    steps:")).split("\n      - name: ").slice(1);
const [prepare, build] = steps;
const pinsPath = "docs/research-data/broad-universe-discover-pins-2026-11-24.json";
const lf = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")).digest("hex");

test("dispatch-only, hosted runner, no action, no checkout, no Upbit request, read-only token visible to the download step only", () => {
  assert.match(text, /^on:\n  workflow_dispatch:\n    inputs:/m);
  assert.doesNotMatch(text, /\n  (push|pull_request|schedule):/);
  assert.match(text, /permissions:\n  contents: read\n  actions: read/);
  assert.match(text, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(text, /self-hosted|nusa-paper-host|systemctl|sudo|\/opt\/nusa|\/etc\/nusa/);
  assert.doesNotMatch(text, /\n\s+uses:/);
  assert.equal(steps.length, 2);
  assert.doesNotMatch(text, /api\.upbit\.com/);
  assert.equal([...text.matchAll(/github\.token/g)].length, 1);
  assert.match(prepare, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(build, /GH_TOKEN|github\.token|secrets\.|curl|gh api/);
  for (const s of [prepare, build]) assert.doesNotMatch(s.slice(s.indexOf("run: |")), /\$\{\{/, "no expression interpolation inside the scripts");
});

test("inputs are whole-value checked and every executed or read file is hash-pinned through the pins file", () => {
  assert.match(prepare, /\[\[ \$SOURCE_SHA =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(prepare, /\[\[ \$PINS_SHA256 =~ \^\[0-9a-f\]\{64\}\$ \]\]/);
  assert.match(prepare, /get docs\/research-data\/broad-universe-discover-pins-2026-11-24\.json "\$tree\/pins\.json" "\$PINS_SHA256"/);
  assert.match(prepare, /while read -r path hash; do get "\$path" "\$tree\/files\/\$path" "\$hash"; done/);
  assert.match(prepare, /hash mismatch/);
  assert.match(build, /BROAD_INPUTS_OK" = "1"/);
  assert.match(build, /node scripts\/build-broad-store\.js/);
  assert.match(build, /node scripts\/run-broad-mining\.js discover/);
});

test("the pins file lists every file the scripts load, with the right hashes, and the unchanged H2 script keeps its hash", () => {
  const pins = JSON.parse(fs.readFileSync(path.join(root, pinsPath), "utf8"));
  const all = { ...pins.scripts, ...pins.data };
  for (const [rel, hash] of Object.entries(all)) assert.equal(lf(rel), hash, rel);
  assert.equal(pins.scripts["scripts/run-history-mining.js"], "6914d619ff2724d94545e7417fba8529230a0b6d057dd455858ff0c19cd4da1d");
  for (const needed of ["scripts/build-broad-store.js", "scripts/run-broad-mining.js", "scripts/run-history-mining.js", "scripts/run-crossmarket-study.js", "scripts/lib/orderBookSource.js", "scripts/broad-universe-filter-count.js", "scripts/fetch-upbit-60m-history.js"]) assert.ok(pins.scripts[needed], needed);
  for (const needed of ["docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json", "docs/research-data/broad-universe-fetch-manifests-2026-11-24.json"]) assert.ok(pins.data[needed], needed);
  const record = JSON.parse(fs.readFileSync(path.join(root, "docs/research-data/broad-universe-fetch-manifests-2026-11-24.json"), "utf8"));
  assert.equal(pins.runs.g1, record.groups.g1.runId); assert.equal(pins.runs.g2, record.groups.g2.runId);
  // every relative require of the pinned scripts is itself pinned
  for (const rel of Object.keys(pins.scripts)) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    for (const m of src.matchAll(/require\("(\.[^"]+)"\)/g)) assert.ok(pins.scripts[path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]))], `${rel} requires ${m[1]}`);
  }
});

test("only the discovery window is read, nothing is kept, and the freeze record comes first in the annotation", () => {
  assert.doesNotMatch(text, /upload-artifact|retention-days/);
  assert.match(build, /grep -E '\^BROAD_MINING_\(FREEZE\|ERROR\)'/);
  assert.match(build, /::notice title=broad-universe-discover/);
  assert.match(build, /exit "\$status"/);
});
