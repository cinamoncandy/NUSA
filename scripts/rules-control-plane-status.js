#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const ledgerPath = argument(process.argv.slice(2), "--ledger");
if (!ledgerPath || !path.isAbsolute(ledgerPath)) {
  console.error("usage: node scripts/rules-control-plane-status.js --ledger <absolute.json>");
  process.exitCode = 2;
} else {
  try {
    const { projectRulesLedger } = require("../dist/apps/cloud/src/rulesControlPlane.js");
    const records = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    if (!Array.isArray(records)) throw new Error("ledger must be a JSON array");
    const projection = projectRulesLedger(records);
    console.log(JSON.stringify({ ...projection, productionMutationAllowed: false }, null, 2));
  } catch (error) {
    console.error(`[rules-status] ${error instanceof Error ? error.message : "rules status unavailable"}`);
    process.exitCode = 1;
  }
}
