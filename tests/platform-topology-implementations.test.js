"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const { createDefaultPlatformTopology } = require("../dist/apps/cloud/src/platformTopology.js");
const { TOPOLOGY_IMPLEMENTATIONS, modulesWithoutImplementation } = require("../dist/apps/cloud/src/platformTopologyImplementations.js");

const ROOT = join(__dirname, "..");

/**
 * `validatePlatformTopology` checks the topology literal against itself and never asks whether
 * the modules it names exist. These bind the map to the tree, so a module that is renamed,
 * deleted, or never built stops reading as present.
 */

const modules = createDefaultPlatformTopology().modules;
const byId = new Map(TOPOLOGY_IMPLEMENTATIONS.map((entry) => [entry.moduleId, entry]));

test("every module the topology declares says where it lives", () => {
  const undeclared = modules.map((module) => module.id).filter((id) => !byId.has(id));
  assert.deepEqual(undeclared, [], "a module was added to the topology with no implementation entry");
});

test("no implementation entry describes a module the topology does not declare", () => {
  const declared = new Set(modules.map((module) => module.id));
  const orphaned = TOPOLOGY_IMPLEMENTATIONS.map((entry) => entry.moduleId).filter((id) => !declared.has(id));
  assert.deepEqual(orphaned, [], "an implementation entry outlived the module it described");
});

test("every declared path exists", () => {
  for (const entry of TOPOLOGY_IMPLEMENTATIONS) {
    assert.ok(entry.paths.length > 0, `${entry.moduleId} names no path at all`);
    for (const path of entry.paths) {
      assert.ok(existsSync(join(ROOT, path)), `${entry.moduleId} points at ${path}, which does not exist`);
    }
  }
});

test("a module claiming to be implemented cannot be excused, and one that is not must say why", () => {
  for (const entry of TOPOLOGY_IMPLEMENTATIONS) {
    if (entry.status === "IMPLEMENTED") {
      assert.equal(entry.note, "", `${entry.moduleId} is implemented; a note here would be stale`);
    } else {
      assert.ok(entry.note.length > 40, `${entry.moduleId} is not implemented and states no reason`);
    }
  }
});

test("the real-time plugins are the ones whose emptiness would matter most", () => {
  // A CONTRACT_ONLY module in the real-time path is a signal source that cannot produce a signal.
  // This is not a failure to fix here -- it is a fact the topology should not be able to hide.
  const unimplemented = modulesWithoutImplementation().map((entry) => entry.moduleId);
  assert.deepEqual(unimplemented, ["polymarket"]);

  const polymarket = modules.find((module) => module.id === "polymarket");
  assert.equal(polymarket.layer, "PLUGIN");
  assert.equal(polymarket.realTime, true, "if this becomes non-real-time the note above needs rewriting");
});
