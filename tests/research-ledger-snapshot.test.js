"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RESEARCH_LEDGER_SNAPSHOT } = require("../dist/apps/cloud/src/researchLedgerSnapshot.js");

const KEYS = ["id", "source", "dataType", "timeframe", "universe", "methodClass", "configs", "discoveryPass", "holdoutPass", "designFlaw", "retryOf"];

test("the runtime ledger snapshot matches docs/research-ledger/experiments.json (regenerate with --emit-snapshot)", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "research-ledger", "experiments.json"), "utf8"));
  const expected = ledger.experiments.map((e) => Object.fromEntries(KEYS.filter((k) => k in e).map((k) => [k, e[k]])));
  assert.deepEqual(RESEARCH_LEDGER_SNAPSHOT.map((e) => ({ ...e })), expected);
});
