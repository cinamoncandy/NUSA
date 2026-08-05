const test = require("node:test");
const assert = require("node:assert/strict");
const { scan, SAFETY_INPUT_FIELDS, WAIVER } = require("../scripts/check-safety-input-literals.js");

test("the checker watches the capability fields that gate real money, and only those", () => {
  // Narrow on purpose. An earlier version also covered killSwitch, openP0, warmedUp and
  // reconciliation, which scenario runners legitimately build by hand; it produced 37 findings
  // against almost entirely correct code. A check that needs thirty waivers on its first run
  // teaches people to write waivers.
  //
  // openP0 was added back after an audit of the cloud paper-engine port found a real, unwaived
  // instance of the pattern this file exists to catch (apps/cloud/src/paperEngineControlState.ts
  // hands the risk gate a hardcoded absent value with no P0 alert ledger behind it). killSwitch,
  // warmedUp, and reconciliation stay excluded for the original reason above.
  assert.deepEqual([...SAFETY_INPUT_FIELDS].sort(), [
    "credentialAbsent",
    "liveAbsent",
    "liveCapabilityDetected",
    "openP0",
    "privateApiAbsent",
    "privateApiCapabilityDetected"
  ]);
});

test("a waiver can be stated across a multi-line comment block", () => {
  // risk-safety-drill-runner.js carries the only waiver in the tree, and its reason needs more
  // than one line: the fixture exists so that two of the required drills can assert these very
  // fields block when set. If the marker only counted on the line immediately above, authors
  // would be pushed toward one-line reasons or none.
  const findings = scan();
  const waivedFile = findings.filter((finding) => finding.file.includes("risk-safety-drill-runner"));
  assert.deepEqual(waivedFile, [], "the drill fixture's multi-line waiver must be honoured");
});

test("the exported waiver marker is what the checker actually looks for", () => {
  assert.equal(WAIVER, "safety-input-literal-ok:");
});
