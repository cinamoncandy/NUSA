"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

const { FLAT_MODULE_DEBT } = require("../dist/apps/cloud/src/architecture/flatModuleDebt.js");

const CLOUD_SRC = join(__dirname, "..", "apps/cloud/src");

/**
 * A ratchet, not a rule about the past. Module boundaries in apps/cloud/src exist only as
 * filename prefixes, and a mass rename would collide with the several hundred open branches that
 * touch this directory. So the flat files that already existed are listed and frozen, and the
 * list may only shrink.
 */

function flatSourceFiles() {
  return readdirSync(CLOUD_SRC, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .filter((name) => !name.includes(".test.") && !name.includes(".vitest."))
    .sort();
}

test("no new file joins the flat namespace", () => {
  const added = flatSourceFiles().filter((name) => !FLAT_MODULE_DEBT.includes(name));
  assert.deepEqual(
    added,
    [],
    "a new module was placed directly in apps/cloud/src. Put it in a directory that names its " +
      "module (ai/ and alpha/ are the existing examples); this list is debt being paid down, not " +
      "a place to add to"
  );
});

test("the debt list stays exact, so paying it down is visible", () => {
  const present = new Set(flatSourceFiles());
  const stale = FLAT_MODULE_DEBT.filter((name) => !present.has(name));
  assert.deepEqual(
    stale,
    [],
    "these were moved or deleted -- remove them from FLAT_MODULE_DEBT in the same commit, so the " +
      "count going down is the record of the work"
  );
});

test("the debt is counted, and counted honestly", () => {
  // The first count of this directory in review said 253, which quietly included .vitest.ts
  // files. Same shape of error as counting 46 live* modules when 27 exist. The filter above is
  // the corrected one; this pins what it measures.
  //
  // The baseline moved from 233 to 235 when main added moduleReplacementPolicy10XS.ts and
  // moduleRuntimeManifest10XS.ts. Those are grandfathered rather than rejected: the ratchet is
  // not merged yet, so nobody was asked to place them in a directory. Once it is merged, a
  // rising number here is a rule being broken, not a baseline being refreshed.
  assert.equal(new Set(FLAT_MODULE_DEBT).size, FLAT_MODULE_DEBT.length, "duplicate entry");
  assert.equal(FLAT_MODULE_DEBT.length, 235);
  assert.ok(FLAT_MODULE_DEBT.every((name) => name.endsWith(".ts") && !name.includes("/")), "entries are bare filenames");
});

test("directories are the intended destination and already work", () => {
  const directories = readdirSync(CLOUD_SRC, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(directories, ["ai", "alpha", "architecture", "health"], "a new directory is progress -- update this list deliberately");
});
