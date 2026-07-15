const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("desktop IPC rejects coerced control values and startup does not stream without persistence", () => {
  const source = readFileSync("apps/desktop/src/main.ts", "utf8");
  assert.match(source, /typeof enabled !== "boolean"/);
  assert.match(source, /typeof quantity !== "number" \\|\\| !Number\.isFinite\(quantity\)/);
  assert.match(source, /typeof candidate\.quantity !== "number" \\|\\| !Number\.isFinite\(candidate\.quantity\)/);
  assert.doesNotMatch(source, /setAutoTrade\(Boolean\(enabled\)\)/);
  assert.match(source, /if \(paperTradingAvailable\) stream\.start\(\)/);
  assert.doesNotMatch(source, /fetch\(|axios|Authorization|jwt|withdraw/i);
});
