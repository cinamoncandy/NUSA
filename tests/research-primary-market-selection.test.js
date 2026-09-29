const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESEARCH_MARKETS,
  researchPrimaryMarket,
} = require("../scripts/research-real-market-run.js");

test("primary market defaults to the declared primary when unset", () => {
  assert.equal(researchPrimaryMarket(undefined), "KRW-BTC");
  assert.equal(researchPrimaryMarket(""), "KRW-BTC");
  assert.equal(researchPrimaryMarket("   "), "KRW-BTC");
});

test("primary market accepts every precommitted cohort member, case-insensitively", () => {
  for (const market of RESEARCH_MARKETS) {
    assert.equal(researchPrimaryMarket(market), market);
    assert.equal(researchPrimaryMarket(market.toLowerCase()), market);
    assert.equal(researchPrimaryMarket(` ${market} `), market);
  }
});

test("primary market fails closed outside the precommitted cohort", () => {
  // The cohort is an availability declaration made before returns were observed. A market that
  // was never declared has no such provenance, so it must not silently become the backtest basis.
  for (const market of ["KRW-SOL", "BTC-USD", "KRW-BTC-PERP", "nonsense"]) {
    assert.throws(() => researchPrimaryMarket(market), /precommitted cohort/);
  }
});
