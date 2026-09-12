const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "lib", "parameter-robustness-runner.js"),
  "utf8"
);

test("parameter robustness OOS scoring warms strategy state with strictly prior observations", () => {
  assert.match(
    source,
    /function runScoredOosBacktest\([\s\S]*warmupPoints:\s*points\.slice\(0,\s*boundary\.testStartIndex\)[\s\S]*?\n\}/
  );

  const callSites = source.match(/runScoredOosBacktest\(modules, points, boundary, factory, execConfig\)/g) ?? [];
  assert.equal(callSites.length, 2, "legacy SMA and generic family OOS paths must share the warm-up helper");

  assert.doesNotMatch(
    source,
    /runBacktest\(points\.slice\(boundary\.testStartIndex,\s*boundary\.testEndIndex \+ 1\),\s*factory,\s*execConfig\)/,
    "OOS parameter robustness must never cold-start directly at the scored boundary"
  );
});
