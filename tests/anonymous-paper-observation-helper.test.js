const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const helper = fs.readFileSync(path.join(__dirname, "../scripts/wire-anonymous-paper-observation.mjs"), "utf8");

test("wiring helper is bounded to server and mobile app integration", () => {
  assert.match(helper, /apps\/cloud\/src\/server\.ts/);
  assert.match(helper, /apps\/mobile\/App\.tsx/);
  assert.doesNotMatch(helper, /\/health.*replace|deploymentHealthPayload/);
  assert.doesNotMatch(helper, /real-readonly-operations.*observationRequest/);
  assert.doesNotMatch(helper, /paper-orders.*observationRequest/);
  assert.doesNotMatch(helper, /operator\/users.*observationRequest/);
});
