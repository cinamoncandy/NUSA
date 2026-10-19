const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const runner = require("../scripts/run-futures-regime-study.js");
const history = require("../scripts/fetch-futures-history.js");

const text = fs.readFileSync(".github/workflows/futures-regime-study.yml", "utf8").replace(/\r\n/g, "\n");
const commands = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

test("the study workflow is dispatch-only, secret-free, read-only and runs only the deployed script", () => {
  assert.match(text, /^on:\n  workflow_dispatch: \{\}\n/m);
  assert.doesNotMatch(text, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write|uses:|\$\{\{\s*secrets\./);
  assert.match(text, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
  assert.match(commands, /script=\/opt\/nusa\/current\/scripts\/run-futures-regime-study\.js/);
  for (const forbidden of [/\brm\b/, /\bsudo\b/, /systemctl/, /\bmv\b/, /\bcp\b/, /\bcurl\b/, /\bwget\b/, /\.env\b/, /\/var\/lib\/nusa/, /Authorization|X-MBX-APIKEY|api[_-]?key/i]) {
    assert.doesNotMatch(commands, forbidden, `forbidden: ${forbidden}`);
  }
  assert.match(commands, /exit "\$status"/);
});

test("costs are the pre-registered base and doubled fee/slippage with unchanged maintenance margin", () => {
  assert.deepEqual({ ...runner.BASE_COSTS }, { takerFeeRate: 0.0005, slippageBps: 5, maintenanceMarginRate: 0.004 });
  assert.deepEqual({ ...runner.STRESS_COSTS }, { takerFeeRate: 0.001, slippageBps: 10, maintenanceMarginRate: 0.004 });
  assert.equal(runner.HOLDOUT_START, Date.parse("2025-10-15T00:00:00Z"));
});

test("only the holdout at N = 50 decides the verdict; development and other N are reported", () => {
  const files = {};
  for (const s of history.SYMBOLS) { files[`klines_${s}_4h.csv`] = "h\n1,1,1,1,1,0,2\n"; files[`funding_${s}.csv`] = "h\n1,0\n"; }
  const calls = [];
  const fake = {
    runRegimeStudy: (input) => { calls.push([input.windowStart, input.breakoutN, input.costs.takerFeeRate]); return { roundTrips: input.breakoutN }; },
    passRule: (base) => ({ pass: base.roundTrips === 20, failed: [] }),
  };
  const report = runner.evaluate(files, fake);
  assert.equal(calls.length, 12);
  assert.equal(report.splits.holdout.N20.rule.pass, true);
  assert.equal(report.verdict, "FAIL", "N = 20 passing must not pass the study");
});

test("it refuses to evaluate when the committed manifest is missing or the fresh fetch does not match", async () => {
  await assert.rejects(runner.main({ fetchImpl: async () => { throw new Error("no network in test"); } }), (e) => ["MANIFEST_NOT_COMMITTED", "HOLDOUT_ALREADY_EVALUATED"].includes(e.code) || e.message === "no network in test");
  assert.equal(history.verify({ manifest: { startMs: 1, endMs: 2, interval: "4h", symbols: [], files: { a: { sha256: "x", rows: 1 } } } }, { startMs: 1, endMs: 2, interval: "4h", symbols: [], files: { a: { sha256: "y", rows: 1 } } }).ok, false);
});
