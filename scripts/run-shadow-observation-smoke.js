#!/usr/bin/env node
"use strict";
/**
 * Runs the WO-0034-A4 observation smoke test and prints the summary.
 *
 * Offline and deterministic: no socket is opened, no Upbit endpoint is called, and the clock
 * is fixed. Safe to run in CI. It is a rehearsal of the observation path, not an observation
 * -- it proves the machinery works, and says nothing whatsoever about market performance.
 *
 * Usage:
 *   node scripts/run-shadow-observation-smoke.js [--root <scratch dir>] [--candles <n>] [--json]
 *
 * With no --root a temporary directory is created and removed afterwards.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runShadowObservationSmoke } = require("./lib/shadow-observation-smoke.js");
const { formatShadowObservationSummary } = require("../dist/apps/desktop/src/shadow/shadowObservationSummary.js");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === "json") { args.json = true; continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    args[name] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candles = args.candles === undefined ? 6 : Number(args.candles);
  if (!Number.isSafeInteger(candles) || candles < 3) throw new Error("--candles must be an integer of at least 3");

  const owned = args.root === undefined;
  const root = owned ? await fsp.mkdtemp(path.join(os.tmpdir(), "shadow-a4-smoke-")) : path.resolve(args.root);
  try {
    const { preflight, summary, archiveDirectory } = await runShadowObservationSmoke({ root, candleCount: candles });

    if (preflight.status !== "PASS") {
      console.error(`[a4-smoke] preflight BLOCKED: ${preflight.blockers.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    if (args.json) {
      console.log(JSON.stringify({ preflight, summary }, null, 2));
    } else {
      console.log(`[a4-smoke] preflight PASS (${preflight.capabilityScanMethod})`);
      console.log(formatShadowObservationSummary(summary));
      // Printed as a boolean, never as a path: an archive path is a user path.
      console.log(`- archive written: ${archiveDirectory !== null}`);
    }
    if (summary.verdict !== "PASS") process.exitCode = 1;
  } finally {
    if (owned) fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[a4-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
