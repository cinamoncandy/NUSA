const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// The baseline may only shrink (WO-ARCH-20261028-BOUNDARIES). Lower this cap when entries are removed; never raise it.
const BASELINE_CAP = 68;

test("the app-boundary baseline never grows and has no duplicates", () => {
  const { references } = JSON.parse(fs.readFileSync(".aipos/architecture-boundary-baseline.json", "utf8"));
  assert.ok(Array.isArray(references));
  assert.equal(new Set(references).size, references.length, "duplicate baseline entry");
  assert.ok(references.length <= BASELINE_CAP, `baseline has ${references.length} entries, cap is ${BASELINE_CAP}; remove references instead of adding baseline entries`);
});
