#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const databasePath = value(args, "--db");
const inputPath = value(args, "--input");
if (!databasePath || !inputPath || !path.isAbsolute(databasePath) || !path.isAbsolute(inputPath)) {
  console.error("usage: node scripts/import-research-evidence-bundle.js --db <absolute.sqlite> --input <absolute.json>");
  process.exitCode = 2;
} else {
  let store;
  try {
    const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    if (!payload || !Array.isArray(payload.entries) || payload.entries.length !== 4) throw new Error("input must contain exactly four manifest/report entries");
    const types = payload.entries.map((entry) => entry?.manifest?.runType);
    if (new Set(types).size !== 4 || !["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"].every((type) => types.includes(type))) throw new Error("bundle must contain one entry for each research gate");
    const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
    store = new DesktopPersistenceStore(databasePath);
    store.appendResearchEvidenceBundle(payload.entries);
    const manifests = store.loadResearchRunManifests();
    const reports = store.loadResearchValidationReports();
    const runIds = payload.entries.map((entry) => entry.manifest.runId);
    if (runIds.some((runId) => !manifests.some((manifest) => manifest.runId === runId) || !reports.some((report) => report.runId === runId))) throw new Error("persisted research bundle could not be reloaded");
    console.log(JSON.stringify({ runIds, persisted: true, appendOnly: true, productionMutationAllowed: false }, null, 2));
  } catch (error) {
    console.error(`[research-evidence-bundle-import] ${error instanceof Error ? error.message : "import failed"}`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}
