"use strict";
/**
 * CLI wrapper around scripts/lib/paper-scenario-runner.js.
 *
 * Usage:
 *   node scripts/run-paper-scenario.js <fixture-path>
 *
 * Exits 0 on PASS, 1 on FAIL or a malformed fixture. No network, no Electron, no real
 * userData -- the runner uses the compiled production classes directly with an
 * in-memory persistence stand-in.
 */
const fs = require("node:fs");
const path = require("node:path");
const { runPaperScenario } = require("./lib/paper-scenario-runner.js");

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error("Usage: node scripts/run-paper-scenario.js <fixture-path>");
  process.exit(1);
}

const resolvedPath = path.resolve(fixturePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Fixture not found: ${resolvedPath}`);
  process.exit(1);
}

let fixture;
try {
  fixture = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
} catch (error) {
  console.error(`Failed to parse fixture as JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const result = runPaperScenario(fixture);
console.log(JSON.stringify(result, null, 2));

if (result.status !== "PASS") {
  console.error(`Scenario ${result.scenarioId} FAILED:`);
  for (const failure of result.failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Scenario ${result.scenarioId} PASSED (${result.eventsProcessed} events).`);
process.exit(0);
