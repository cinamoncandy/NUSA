#!/usr/bin/env node
"use strict";
/**
 * CLI wrapper for the deterministic market-regime analysis runner (WO-0029).
 * No network, no real database.
 *
 * Usage:
 *   node scripts/run-regime-analysis.js --request <request.json> --output <result.json>
 */
const fs = require("node:fs");
const path = require("node:path");
const { runRegimeAnalysisRequest } = require("./lib/regime-analysis-runner.js");
const { verifyRegimeAnalysisResult } = require("./lib/regime-analysis-verifier.js");

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
    console.error("usage: node scripts/run-regime-analysis.js --request <request.json> --output <result.json>");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const request = JSON.parse(fs.readFileSync(args.request, "utf8"));
  console.log(`[regime-analysis] running request ${request.id}`);
  const result = runRegimeAnalysisRequest(request);

  for (const segment of result.segments ?? []) console.log(`[regime-analysis] segment ${segment.segmentId}: ${segment.key} (${segment.candleCount} candles)`);

  const verification = result.status === "FAIL" && result.segments.length === 0
    ? { status: "SKIPPED_REQUEST_INVALID", errors: [] }
    : verifyRegimeAnalysisResult(request, result);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ result, verification }, null, 2));

  console.log(`[regime-analysis] status: ${result.status}, independent verification: ${verification.status}`);
  if (result.status !== "PASS" || verification.status === "FAIL") {
    process.exitCode = 1;
  }
}

main();
