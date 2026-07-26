#!/usr/bin/env node
"use strict";
/**
 * CLI wrapper for the deterministic Walk-Forward runner (WO-0027). No network, no
 * real database. See scripts/lib/walk-forward-runner.js for scope notes and
 * scripts/lib/walk-forward-verifier.js for independent verification.
 *
 * Usage:
 *   node scripts/run-walk-forward.js --request <request.json> --output <result.json>
 */
const fs = require("node:fs");
const path = require("node:path");
const { runWalkForwardRequest } = require("./lib/walk-forward-runner.js");
const { verifyWalkForwardResult } = require("./lib/walk-forward-verifier.js");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) { args[argv[index].slice(2)] = argv[index + 1]; index += 1; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.request || !args.output) {
    console.error("usage: node scripts/run-walk-forward.js --request <request.json> --output <result.json>");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const request = JSON.parse(fs.readFileSync(args.request, "utf8"));
  console.log(`[walk-forward] running request ${request.id}`);
  const result = runWalkForwardRequest(request);

  for (const window of result.windows ?? []) console.log(`[walk-forward] window ${window.index}: ${window.status}`);

  const verification = result.status === "FAIL" && result.windows.length === 0
    ? { status: "SKIPPED_REQUEST_INVALID", errors: [] }
    : verifyWalkForwardResult(request, result);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ result, verification }, null, 2));

  console.log(`[walk-forward] status: ${result.status}, independent verification: ${verification.status}`);
  if (result.status !== "PASS" || verification.status === "FAIL") {
    process.exitCode = 1;
  }
}

main();
