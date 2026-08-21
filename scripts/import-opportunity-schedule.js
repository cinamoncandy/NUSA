#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function value(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
const args = process.argv.slice(2);
const databasePath = value(args, "--db");
const inputPath = value(args, "--input");
if (!databasePath || !inputPath || !path.isAbsolute(databasePath) || !path.isAbsolute(inputPath)) {
  console.error("usage: node scripts/import-opportunity-schedule.js --db <absolute.sqlite> --input <absolute.json>");
  process.exitCode = 2;
} else {
  let store;
  try {
    const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    if (!payload || typeof payload.scheduleId !== "string" || typeof payload.source !== "string" || !Number.isSafeInteger(payload.generatedAt) || payload.schedule == null) throw new Error("input must contain scheduleId, source, generatedAt, and schedule");
    const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
    store = new DesktopPersistenceStore(databasePath);
    store.appendOpportunitySchedule(payload);
    const loaded = store.loadLatestOpportunitySchedule();
    if (!loaded || loaded.scheduleId !== payload.scheduleId) throw new Error("opportunity schedule could not be reloaded");
    console.log(JSON.stringify({ scheduleId: loaded.scheduleId, source: loaded.source, generatedAt: loaded.generatedAt, persisted: true, readOnlyDashboardSource: true, productionMutationAllowed: false }, null, 2));
  } catch (error) {
    console.error(`[opportunity-schedule-import] ${error instanceof Error ? error.message : "import failed"}`);
    process.exitCode = 1;
  } finally { store?.close(); }
}
