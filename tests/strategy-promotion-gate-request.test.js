const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runStrategyResearchScorecard, validateRequest } = require("../scripts/lib/strategy-research-promotion-gate-runner.js");

const dir = path.join(__dirname, "fixtures", "strategy-promotion-gate");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

test("a well-formed request validates cleanly", () => {
  assert.deepEqual(validateRequest(load("promote-review")), []);
});

test("missing schemaVersion is rejected", () => {
  const request = load("promote-review"); delete request.schemaVersion;
  assert.ok(validateRequest(request).some((m) => m.includes("schemaVersion")));
});

test("an unsupported strategy kind is rejected", () => {
  const request = load("promote-review"); request.strategy.kind = "LSTM";
  assert.ok(validateRequest(request).some((m) => m.includes("strategy.kind")));
});

test("a missing strategy fingerprint is rejected", () => {
  const request = load("promote-review"); delete request.strategy.strategyFingerprint;
  assert.ok(validateRequest(request).some((m) => m.includes("strategyFingerprint")));
});

test("independent verification cannot be switched off in policy", () => {
  const request = load("promote-review"); request.policy.requireIndependentVerification = false;
  assert.ok(validateRequest(request).some((m) => m.includes("requireIndependentVerification")));
});

test("operational Paper safety cannot be switched off in policy", () => {
  const request = load("promote-review"); request.policy.requireOperationalPaperSafety = false;
  assert.ok(validateRequest(request).some((m) => m.includes("requireOperationalPaperSafety")));
});

test("a negative sample threshold is rejected", () => {
  const request = load("promote-review"); request.policy.minimumMarketCount = -1;
  assert.ok(validateRequest(request).some((m) => m.includes("minimumMarketCount")));
});

test("an invalid request yields executionStatus INVALID and no dimensions", () => {
  const request = load("promote-review"); delete request.manifest;
  const result = runStrategyResearchScorecard(request);
  assert.equal(result.executionStatus, "INVALID");
  assert.equal(result.researchDecision, "INVALID");
  assert.deepEqual(result.dimensions, []);
});

test("the prohibited-action list is present even on an invalid request", () => {
  const request = load("promote-review"); delete request.manifest;
  const result = runStrategyResearchScorecard(request);
  assert.ok(result.prohibitedActions.includes("Enable Live Trading"));
  assert.ok(result.prohibitedActions.includes("Place real orders"));
});
