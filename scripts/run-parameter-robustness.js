#!/usr/bin/env node
"use strict";
/**
 * CLI wrapper for the deterministic parameter-neighborhood robustness runner
 * (WO-0028). No network, no real database.
 *
 * Usage:
 *   node scripts/run-parameter-robustness.js --request <request.json> --output <result.json>
 */
const fs = require("node:fs");
const path = require("node:path");
const { runParameterRobustnessRequest } = require("./lib/parameter-robustness-runner.js");
const { verifyParameterRobustnessResult } = require("./lib/parameter-robustness-verifier.js");

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
    console.error("usage: node scripts/run-parameter-robustness.js --request <request.json> --output <result.json>");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const request = JSON.parse(fs.readFileSync(args.request, "utf8"));
  console.log(`[parameter-robustness] running request ${request.id}`);
  const result = runParameterRobustnessRequest(request);

  for (const candidate of result.candidates ?? []) console.log(`[parameter-robustness] candidate ${candidate.shortWindow}/${candidate.longWindow}: ${candidate.status}`);

  const verification = result.status === "FAIL" && result.candidates.length === 0
    ? { status: "SKIPPED_REQUEST_INVALID", errors: [] }
    : verifyParameterRobustnessResult(request, result);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ result, verification }, null, 2));

  console.log(`[parameter-robustness] status: ${result.status}, independent verification: ${verification.status}`);
  if (result.status !== "PASS" || verification.status === "FAIL") {
    process.exitCode = 1;
  }
}

main();
