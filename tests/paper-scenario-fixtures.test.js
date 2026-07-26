const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runPaperScenario, validateFixture } = require("../scripts/lib/paper-scenario-runner.js");

const fixturesDir = path.join(__dirname, "fixtures", "paper-scenarios");
const fixtureFiles = fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

test("at least one deterministic Paper scenario fixture exists", () => {
  assert.ok(fixtureFiles.length > 0);
});

for (const fileName of fixtureFiles) {
  test(`fixture ${fileName} is schema-valid and passes end to end (production + independent verification)`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, fileName), "utf8"));
    assert.deepEqual(validateFixture(fixture), []);
    const result = runPaperScenario(fixture);
    assert.equal(result.status, "PASS", JSON.stringify(result.failures, null, 2));
    assert.equal(result.expectedComparison.status, "PASS");
    assert.equal(result.independentVerification.status, "PASS", JSON.stringify(result.independentVerification.errors));
  });
}
