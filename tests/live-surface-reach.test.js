"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const { UNREACHED_LIVE_MODULES, LIVE_REACH_DECLARATION_PREFIX } = require("../dist/apps/cloud/src/architecture/liveSurfaceReach.js");

const ROOT = join(__dirname, "..");

/**
 * Machinery for an authority that has never been granted should be unreachable. What must not
 * happen is losing track of which `live*` modules are unreachable by design and which lost their
 * caller by accident -- from the outside the two look identical.
 */

function callers(moduleName) {
  let output = "";
  try {
    output = execFileSync(
      "grep",
      ["-rl", "--include=*.ts", "--include=*.tsx", "--include=*.js", `\\b${moduleName}\\b`, "apps", "packages", "scripts", "services"],
      { cwd: ROOT, encoding: "utf8" }
    );
  } catch {
    return [];
  }
  return output.split("\n").filter((path) => {
    if (!path.trim()) return false;
    if (path.includes(`/${moduleName}.`)) return false;
    if (path.includes(".test.") || path.includes(".vitest.")) return false;
    // Declarations name modules as strings; naming is not calling.
    return !path.startsWith(LIVE_REACH_DECLARATION_PREFIX);
  });
}

const liveModules = () =>
  readdirSync(join(ROOT, "apps/cloud/src"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("live") && entry.name.endsWith(".ts"))
    .map((entry) => entry.name.replace(/\.ts$/, ""))
    .filter((name) => !name.includes(".test") && !name.includes(".vitest"))
    .sort();

test("each recorded module still exists", () => {
  for (const entry of UNREACHED_LIVE_MODULES) {
    assert.ok(
      existsSync(join(ROOT, `apps/cloud/src/${entry.module}.ts`)),
      `${entry.module} was removed -- delete its entry in the same commit`
    );
    assert.ok(entry.purpose.length > 15, `${entry.module} records no purpose`);
  }
});

test("nothing has started reaching LIVE machinery", () => {
  for (const entry of UNREACHED_LIVE_MODULES) {
    assert.deepEqual(
      callers(entry.module),
      [],
      `${entry.module} is now imported by the above. Something reaches LIVE machinery: confirm the ` +
        `authority boundary still holds before removing it from UNREACHED_LIVE_MODULES`
    );
  }
});

test("the record is complete: no other live* module has quietly lost its last caller", () => {
  const recorded = new Set(UNREACHED_LIVE_MODULES.map((entry) => entry.module));
  const newlyUnreached = liveModules().filter((name) => !recorded.has(name) && callers(name).length === 0);
  assert.deepEqual(
    newlyUnreached,
    [],
    "these live* modules have no caller and are not recorded -- either a refactor dropped their " +
      "last caller, or they belong in UNREACHED_LIVE_MODULES with a stated purpose"
  );
});

test("the unreachable set is a minority of the live surface, and that stays true", () => {
  const all = liveModules();
  assert.equal(all.length, 27);
  assert.equal(UNREACHED_LIVE_MODULES.length, 6);
  assert.ok(UNREACHED_LIVE_MODULES.every((entry) => all.includes(entry.module)));
});
