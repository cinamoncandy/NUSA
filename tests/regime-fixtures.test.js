const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runRegimeAnalysisRequest } = require("../scripts/lib/regime-analysis-runner.js");
const { verifyRegimeAnalysisResult } = require("../scripts/lib/regime-analysis-verifier.js");

const fixturesDir = path.join(__dirname, "fixtures", "regime-analysis");
const fixtureFiles = fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

test("at least one deterministic regime-analysis fixture exists", () => {
  assert.ok(fixtureFiles.length > 0);
});

for (const fileName of fixtureFiles) {
  test(`fixture ${fileName} runs end to end and passes independent verification`, () => {
    const request = JSON.parse(fs.readFileSync(path.join(fixturesDir, fileName), "utf8"));
    const result = runRegimeAnalysisRequest(request);
    assert.equal(result.status, "PASS", JSON.stringify(result.failures, null, 2));
    const verification = verifyRegimeAnalysisResult(request, result);
    assert.equal(verification.status, "PASS", JSON.stringify(verification.errors, null, 2));
  });
}
