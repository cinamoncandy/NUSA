#!/usr/bin/env node
"use strict";
/**
 * CLI for independent change-control verification (WO-0037). Re-verifies a previously
 * produced change-impact result against its own change set, without trusting the
 * analyzer that produced it.
 *
 * Usage:
 *   node scripts/verify-change-control.js --change-set <change-set.json> --result <change-impact.json>
 */
const fs = require("node:fs");
const { verifyChangeControlResult } = require("./lib/change-control-verifier.js");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) { args[argv[index].slice(2)] = argv[index + 1]; index += 1; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["change-set"] || !args.result) {
    console.error("usage: node scripts/verify-change-control.js --change-set <change-set.json> --result <change-impact.json>");
    process.exitCode = 1;
    return;
  }

  const changeSet = JSON.parse(fs.readFileSync(args["change-set"], "utf8"));
  const raw = JSON.parse(fs.readFileSync(args.result, "utf8"));
  const result = raw.result ?? raw;

  const verification = verifyChangeControlResult(changeSet, result);
  console.log(`[change-control-verify] ${verification.status}`);
  for (const error of verification.errors) console.log(`[change-control-verify] ERROR: ${error}`);

  if (verification.status !== "PASS") process.exitCode = 1;
}

main();
