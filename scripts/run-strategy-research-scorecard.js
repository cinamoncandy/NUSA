#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createStrategyResearchScorecard } = require("./lib/strategy-research-scorecard.js");
const { verifyStrategyResearchScorecard } = require("./lib/strategy-research-scorecard-verifier.js");
function parse(argv) { const args = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index].startsWith("--")) { args[argv[index].slice(2)] = argv[index + 1]; index += 1; } return args; }
const args = parse(process.argv.slice(2));
if (!args.request || !args.output) { console.error("usage: node scripts/run-strategy-research-scorecard.js --request <request.json> --output <scorecard.json>"); process.exitCode = 1; }
else if (fs.existsSync(args.output)) { console.error(`refusing to overwrite existing output file: ${args.output}`); process.exitCode = 1; }
else { const request = JSON.parse(fs.readFileSync(args.request, "utf8")); const scorecard = createStrategyResearchScorecard(request); const verification = verifyStrategyResearchScorecard(request, scorecard); fs.mkdirSync(path.dirname(args.output), { recursive: true }); fs.writeFileSync(args.output, JSON.stringify({ scorecard, verification }, null, 2)); console.log(`[research-scorecard] ${scorecard.decision}; verification: ${verification.status}; productionMutationAllowed: false`); if (verification.status !== "PASS") process.exitCode = 1; }
