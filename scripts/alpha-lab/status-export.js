#!/usr/bin/env node
"use strict";

// Read-only, display-only projection for the future phone Lab tab.
// This exports no measurements, prices, order information, or registry evidence hashes.
const { DEFAULT_REGISTRY, projectRegistry, readRegistry } = require("./registry.js");

const SCHEMA_VERSION = 1;
const EXPORT_KEYS = Object.freeze(["id", "shortNameKo", "state", "nextLookDate", "lastVerdictCode"]);

function buildStatus(registryPath = DEFAULT_REGISTRY) {
  const hypotheses = projectRegistry(readRegistry(registryPath)).map((entry) => ({
    id: entry.id,
    shortNameKo: entry.shortNameKo,
    state: entry.state,
    nextLookDate: entry.nextLookDate,
    lastVerdictCode: entry.lastVerdictCode,
  }));
  return { schemaVersion: SCHEMA_VERSION, hypotheses };
}

function serializeStatus(status) {
  return `${JSON.stringify(status, null, 2)}\n`;
}

function runCli(argv = process.argv.slice(2), io = process) {
  if (argv.length !== 0) {
    io.stderr.write("Usage: node scripts/alpha-lab/status-export.js\n");
    return 2;
  }
  try {
    io.stdout.write(serializeStatus(buildStatus()));
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = runCli();

module.exports = { EXPORT_KEYS, SCHEMA_VERSION, buildStatus, runCli, serializeStatus };
