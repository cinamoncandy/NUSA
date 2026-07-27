#!/usr/bin/env node
"use strict";
/**
 * CLI for the strategy research scorecard (WO-0031). Reads evidence, never writes to it.
 *
 * Usage:
 *   node scripts/run-strategy-research-promotion-gate.js --request <request.json> \
 *        [--evidence-root <dir>] --output <result.json>
 */
const fs = require("node:fs");
const path = require("node:path");
const { runStrategyResearchScorecard } = require("./lib/strategy-research-promotion-gate-runner.js");
const { verifyScorecard } = require("./lib/strategy-research-promotion-gate-verifier.js");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.request || !args.output) {
    console.error("usage: node scripts/run-strategy-research-promotion-gate.js --request <request.json> [--evidence-root <dir>] --output <result.json>");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const request = JSON.parse(fs.readFileSync(args.request, "utf8"));
  const result = runStrategyResearchScorecard(request, { evidenceRoot: args["evidence-root"] });
  const verification = verifyScorecard(request, result);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ result, verification }, null, 2));

  for (const dimension of result.dimensions) console.log(`[scorecard] ${dimension.id} ${dimension.name}: ${dimension.status} (${dimension.confidence})`);
  for (const blocker of result.blockers) console.log(`[scorecard] BLOCKER (${blocker.kind}): ${blocker.detail}`);
  console.log(`[scorecard] executionStatus: ${result.executionStatus} | researchDecision: ${result.researchDecision} | verification: ${verification.status}`);
  console.log("[scorecard] owner review is PENDING; this scorecard does not approve anything by itself.");

  if (result.executionStatus !== "PASS" || verification.status === "FAIL") process.exitCode = 1;
}

main();
