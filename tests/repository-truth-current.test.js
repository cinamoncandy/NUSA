const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRepositoryTruth } = require("../scripts/validate-repository-truth.js");

test("current repository architecture truth is internally consistent", () => {
  const result = validateRepositoryTruth(process.cwd());
  assert.deepEqual(result, { ok: true, failures: [] });
});
