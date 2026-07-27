#!/usr/bin/env node
"use strict";
/**
 * CLI for the deterministic cross-market validation runner (WO-0030).
 * No network, no real database.
 *
 * Usage:
 *   node scripts/run-cross-market-validation.js --request <request.json> --output <result.json>
 */
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation } = require("./lib/cross-market-validation-runner.js");
const { verifyCrossMarketResult } = require("./lib/cross-market-validation-verifier.js");

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
    console.error("usage: node scripts/run-cross-market-validation.js --request <request.json> --output <result.json>");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const request = JSON.parse(fs.readFileSync(args.request, "utf8"));
  console.log(`[cross-market] running request ${request.id}`);
  const result = runCrossMarketValidation(request);

  for (const cell of result.fullAvailablePeriod?.cells ?? []) {
    console.log(`[cross-market] cell ${cell.symbol}|${cell.periodLabel}: ${cell.status}`);
  }

  const verification = result.status === "FAIL" && result.fullAvailablePeriod == null
    ? { status: "SKIPPED_REQUEST_INVALID", errors: [] }
    : verifyCrossMarketResult(request, result);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ result, verification }, null, 2));

  console.log(`[cross-market] status: ${result.status}, assessment (full period): ${result.fullAvailablePeriod?.generalizationAssessment ?? "n/a"}, verification: ${verification.status}`);
  for (const warning of result.warnings ?? []) console.log(`[cross-market] WARNING: ${warning}`);

  if (result.status !== "PASS" || verification.status === "FAIL") process.exitCode = 1;
}

main();
