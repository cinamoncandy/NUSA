const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "runtime.ts"), "utf8");

test("a rejected PAPER market observation records the store error code without changing the fail-closed signal", () => {
  assert.match(source, /PAPER_MARKET_OBSERVATION_REJECTED:\$\{error instanceof PaperMarketObservationStoreError \? error\.code : "UNKNOWN"\}/);
  // The suffix must never look like the PUBLIC_MARKET_EVENT_REJECTED diagnostic-only prefix,
  // otherwise a durable-evidence failure could stop being treated as a halting error.
  assert.doesNotMatch(source, /PUBLIC_MARKET_EVENT_REJECTED:\$\{error/);
});
