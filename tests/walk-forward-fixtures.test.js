const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runWalkForwardRequest } = require("../scripts/lib/walk-forward-runner.js");
const { verifyWalkForwardResult } = require("../scripts/lib/walk-forward-verifier.js");

const fixturesDir = path.join(__dirname, "fixtures", "walk-forward");
const fixtureFiles = fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

test("at least one deterministic Walk-Forward fixture exists", () => {
  assert.ok(fixtureFiles.length > 0);
});

for (const fileName of fixtureFiles) {
  test(`fixture ${fileName} runs end to end and passes independent verification`, () => {
    const request = JSON.parse(fs.readFileSync(path.join(fixturesDir, fileName), "utf8"));
    const result = runWalkForwardRequest(request);
    assert.equal(result.status, "PASS", JSON.stringify(result.failures, null, 2));
    const verification = verifyWalkForwardResult(request, result);
    assert.equal(verification.status, "PASS", JSON.stringify(verification.errors, null, 2));
  });
}
