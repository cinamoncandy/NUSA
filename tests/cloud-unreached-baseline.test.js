"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

// WO-ARCH-20261028-UNREACHED-BASELINE: the set of cloud modules that nothing reaches can only shrink.
const baseline = JSON.parse(fs.readFileSync(".aipos/cloud-unreached-baseline.json", "utf8"));
const current = execFileSync(process.execPath, ["scripts/report-cloud-reachability.js", "--markdown"], { encoding: "utf8" })
  .split(/\r?\n/).filter((line) => line.includes("UNREACHED_CHECK")).map((line) => line.replace(/^\| `([^`]+)`.*$/, "$1")).sort();

test("no new unreached cloud module appears", () => {
  const added = current.filter((name) => !baseline.modules.includes(name));
  assert.deepEqual(added, [], `new module(s) no production, product or LIVE-boundary entry reaches: ${added.join(", ")}. Wire it in, or do not add it.`);
});

test("a module that is reachable or gone is removed from the baseline", () => {
  const stale = baseline.modules.filter((name) => !current.includes(name));
  assert.deepEqual(stale, [], `remove from .aipos/cloud-unreached-baseline.json: ${stale.join(", ")}`);
});

test("the baseline is sorted, unique and one-way", () => {
  assert.equal(new Set(baseline.modules).size, baseline.modules.length);
  assert.deepEqual([...baseline.modules].sort(), baseline.modules);
  assert.ok(baseline.modules.length <= 84, "the baseline can only shrink; lower this cap when entries are removed");
});
