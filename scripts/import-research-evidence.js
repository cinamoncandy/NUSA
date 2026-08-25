#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  console.error("usage: node scripts/import-research-evidence.js --db <absolute.sqlite> --input <absolute.json>");
  process.exitCode = 2;
}

const args = process.argv.slice(2);
const databasePath = value(args, "--db");
const inputPath = value(args, "--input");
if (!databasePath || !inputPath || !path.isAbsolute(databasePath) || !path.isAbsolute(inputPath)) {
  usage();
} else {
  let store;
  try {
    const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    if (payload == null || typeof payload !== "object" || payload.manifest == null || payload.report == null) {
      throw new Error("input must contain manifest and report");
    }
    const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
    store = new DesktopPersistenceStore(databasePath);
    store.appendResearchEvidence(payload.manifest, payload.report);
    const manifests = store.loadResearchRunManifests();
    const reports = store.loadResearchValidationReports();
    const manifest = manifests.find((item) => item.runId === payload.manifest.runId);
    const report = reports.find((item) => item.runId === payload.report.runId && item.runType === payload.report.runType);
    if (manifest == null || report == null) throw new Error("persisted research evidence could not be reloaded");
    console.log(JSON.stringify({
      runId: manifest.runId,
      runType: manifest.runType,
      reportStatus: report.status,
      persisted: true,
      appendOnly: true,
      productionMutationAllowed: false,
    }, null, 2));
  } catch (error) {
    console.error(`[research-evidence-import] ${error instanceof Error ? error.message : "import failed"}`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}
