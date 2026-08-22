#!/usr/bin/env node
"use strict";

const path = require("node:path");

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const databasePath = value(process.argv.slice(2), "--db");
if (!databasePath || !path.isAbsolute(databasePath)) {
  console.error("usage: node scripts/research-evidence-status.js --db <absolute.sqlite>");
  process.exitCode = 2;
} else {
  let store;
  try {
    const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
    const { buildPersistedResearchDashboardSection } = require("../dist/apps/desktop/src/cloud/researchDashboardProjection.js");
    store = new DesktopPersistenceStore(databasePath, { readOnly: true });
    const manifests = store.loadResearchRunManifests();
    const reports = store.loadResearchValidationReports();
    const section = buildPersistedResearchDashboardSection({ manifests, reports, generatedAt: Date.now() });
    console.log(JSON.stringify({
      status: section.status,
      availability: section.availability,
      paperPromotionEligible: section.paperPromotionEligible,
      reportCount: reports.length,
      manifestCount: manifests.length,
      reasons: section.reasons,
      productionMutationAllowed: false,
    }, null, 2));
    if (section.status !== "HEALTHY") process.exitCode = 1;
  } catch (error) {
    console.error(`[research-evidence-status] ${error instanceof Error ? error.message : "status unavailable"}`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}
