"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toRunnableTest } = require("../scripts/run-changed-tests-fast.js");

test("changed-test fast gate recognizes runnable JavaScript tests", () => {
  assert.equal(toRunnableTest("tests/research-trial-ledger.test.js"), "tests/research-trial-ledger.test.js");
  assert.equal(toRunnableTest("tests\\windows-path.test.cjs"), "tests/windows-path.test.cjs");
});

test("changed-test fast gate runs co-located TypeScript tests from source", () => {
  assert.equal(
    toRunnableTest("apps/desktop/src/cloud/example.test.ts"),
    "apps/desktop/src/cloud/example.test.ts"
  );
  assert.equal(
    toRunnableTest("apps/cloud/src/liveBrokerTransportBoundaryV3.vitest.ts"),
    "apps/cloud/src/liveBrokerTransportBoundaryV3.vitest.ts"
  );
});

test("changed-test fast gate ignores non-test files", () => {
  assert.equal(toRunnableTest("apps/desktop/src/cloud/example.ts"), null);
  assert.equal(toRunnableTest("docs/example.test.md"), null);
  assert.equal(toRunnableTest(""), null);
});
