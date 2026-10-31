const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// The chart, equity caption, decision rings and holo sphere labels are shown on real screens; a raw font size below the label floor (12) is not readable.
for (const file of ["chartView.tsx", "equityChart.tsx", "decisionRings.tsx", "holoSphere.tsx"]) {
  test(`${file} has no raw font size below the label floor`, () => {
    const source = fs.readFileSync(`apps/mobile/src/${file}`, "utf8");
    assert.doesNotMatch(source, /fontSize:\s*(?:[0-9]|1[01])(?:\.[0-9]+)?\s*[,}]/);
    assert.match(source, /labelFont\(/);
  });
}
