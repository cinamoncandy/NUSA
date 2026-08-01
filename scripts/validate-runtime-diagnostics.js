#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  console.error(`[runtime-diagnostics] ${message}`);
  process.exitCode = 1;
}

const inputPath = value(process.argv.slice(2), "--input");
if (!inputPath || !path.isAbsolute(inputPath)) {
  console.error("usage: node scripts/validate-runtime-diagnostics.js --input <absolute.json>");
  process.exitCode = 2;
} else {
  try {
    const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const snapshots = Array.isArray(payload) ? payload : payload?.snapshots;
    if (!Array.isArray(snapshots) || snapshots.length < 1) throw new Error("diagnostics snapshots are required");
    const sessionIds = new Set(snapshots.map((snapshot) => snapshot?.sessionId).filter((sessionId) => typeof sessionId === "string"));
    if (sessionIds.size !== 1) throw new Error("diagnostics must contain exactly one sessionId");
    const numericCounters = ["actualOrderCount", "actualFillCount", "cashMutationCount", "positionMutationCount", "brokerCallCount", "privateApiCallCount"];
    for (const snapshot of snapshots) {
      if (snapshot.sessionState === undefined || typeof snapshot.sessionState !== "string") throw new Error("sessionState is required");
      for (const field of numericCounters) {
        if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) throw new Error(`${field} is invalid`);
        if (snapshot[field] !== 0) throw new Error(`${field} must remain zero`);
      }
      for (const field of ["activeIntervalCount", "activeTimeoutCount", "marketListenerCount", "marketSubscriptionCount"]) {
        if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) throw new Error(`${field} is invalid`);
      }
    }
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    if (last.activeIntervalCount > first.activeIntervalCount || last.activeTimeoutCount > first.activeTimeoutCount || last.marketListenerCount > first.marketListenerCount || last.marketSubscriptionCount > first.marketSubscriptionCount) {
      throw new Error("runtime resource counts increased across diagnostics");
    }
    console.log(JSON.stringify({
      status: "PASS",
      sessionId: [...sessionIds][0],
      snapshotCount: snapshots.length,
      mutationCounters: 0,
      privateApiCalls: 0,
      resourcesStable: true,
      productionMutationAllowed: false,
    }, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : "diagnostics validation failed");
  }
}
