"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const ROOT = join(__dirname, "..");
const AUTOPILOT_SRC = join(ROOT, "apps", "autopilot", "src");
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
const SEARCHED = ["apps", "packages", "scripts", "tests"];

const { UNWIRED_CONTROL_PLANE_DEBT } = require("../dist/apps/autopilot/src/unwiredControlPlaneDebt.js");

/**
 * Keeps `apps/autopilot/src` honest about which of its exports anything actually calls.
 *
 * A test that exercises a function proves the function works, not that the system runs it. The
 * ledger this checks against is the measured set of exports nothing but their own tests reach; this
 * test requires it to match the tree exactly, in both directions, so the number can only come down.
 */

function walk(directory, matches, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { walk(full, matches, found); continue; }
    if (matches.test(entry)) found.push(full);
  }
  return found;
}

const isTestFile = (path) => /\.(test|vitest)\.(ts|tsx|js|mjs|cjs)$/.test(path);

function measureUnwiredExports() {
  const sources = walk(AUTOPILOT_SRC, /\.ts$/).filter((file) => !isTestFile(file) && !/\.d\.ts$/.test(file));
  const corpus = SEARCHED.flatMap((directory) => walk(join(ROOT, directory), /\.(ts|tsx|js|mjs|cjs)$/));
  const contents = new Map(corpus.map((file) => [file, readFileSync(file, "utf8")]));
  const unwired = [];

  for (const file of sources) {
    const source = contents.get(file) ?? readFileSync(file, "utf8");
    const moduleName = relative(AUTOPILOT_SRC, file).split("\\").join("/");
    for (const declaration of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
      const name = declaration[1];
      const callSite = new RegExp(`\\b${name}\\s*\\(`, "g");
      let production = 0;
      for (const candidate of corpus) {
        let count = (contents.get(candidate).match(callSite) ?? []).length;
        // The declaration itself is not a call site.
        if (candidate === file) count -= 1;
        if (count > 0 && !isTestFile(candidate)) production += count;
      }
      if (production === 0) unwired.push(`${moduleName}#${name}`);
    }
  }
  return unwired.sort();
}

test("the unwired ledger matches the tree exactly, so the count cannot drift", () => {
  const measured = measureUnwiredExports();
  const listed = [...UNWIRED_CONTROL_PLANE_DEBT].sort();

  const undeclared = measured.filter((entry) => !listed.includes(entry));
  const staleEntries = listed.filter((entry) => !measured.includes(entry));

  assert.deepEqual(undeclared, [], [
    "New exports in apps/autopilot/src that nothing but their own tests call.",
    "Wire them to a real caller, or add them to UNWIRED_CONTROL_PLANE_DEBT with the reason they are",
    "not wired yet. A passing test is not evidence the system runs the function.",
  ].join("\n"));

  assert.deepEqual(staleEntries, [], [
    "These are listed as unwired but now have a production call site. Remove them from",
    "UNWIRED_CONTROL_PLANE_DEBT. The list only shrinks, and the diff that shrinks it is the record.",
  ].join("\n"));
});

test("the measurement counts intra-module calls, which an earlier version of it did not", () => {
  // A sweep that skips the defining file reports a function called only from its own module as
  // unwired. That mistake inflated an earlier count from 22 to 31, so it is pinned here.
  const measured = measureUnwiredExports();
  const source = readFileSync(join(AUTOPILOT_SRC, "productionExecutionSpine.ts"), "utf8");
  assert.match(source, /createExecutionState\(/, "fixture assumption: the spine calls this");
  assert.ok(!measured.includes("autonomousExecutionState.ts#createExecutionState"), "a function with a real caller must never be reported as unwired");
});

test("the live spine's three wired lifecycle calls are still the wired ones", () => {
  // If this changes, the ledger's explanation of the happy-path/guard split is out of date and the
  // comment in unwiredControlPlaneDebt.ts needs rewriting rather than quietly becoming wrong.
  const spine = readFileSync(join(AUTOPILOT_SRC, "productionExecutionSpine.ts"), "utf8");
  for (const wired of ["createExecutionState", "acquireExecutionLease", "transitionExecution"]) {
    assert.match(spine, new RegExp(`\\b${wired}\\(`), `${wired} should still be driven by the live spine`);
  }
});
