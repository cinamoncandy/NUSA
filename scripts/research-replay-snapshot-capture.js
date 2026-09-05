"use strict";

const path = require("node:path");

function requiredSnapshotPath(env) {
  const explicit = String(env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH || "").trim();
  if (explicit) {
    if (explicit === ":memory:" || !path.isAbsolute(explicit)) throw new Error("NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH must be an absolute durable path");
    return path.resolve(explicit);
  }
  const stateDb = String(env.NUSA_CLOUD_STATE_DB_PATH || "").trim();
  if (!stateDb || stateDb === ":memory:" || !path.isAbsolute(stateDb)) {
    throw new Error("NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH or an absolute durable NUSA_CLOUD_STATE_DB_PATH is required");
  }
  return path.join(path.dirname(path.resolve(stateDb)), "research-replay-snapshots.json");
}

function defaultDependencies() {
  const leagueBridge = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
  return {
    leagueBridge,
    loadSnapshotModules: () => ({
      ...require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js"),
      ...require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js")
    })
  };
}

function createCapture(env = process.env, dependencies = defaultDependencies()) {
  const snapshotPath = requiredSnapshotPath(env);
  const originalBuild = dependencies.leagueBridge.buildResearchRunLeague;
  if (typeof originalBuild !== "function") throw new Error("research League builder is unavailable");
  let captured;
  let persisted = false;

  const wrappedBuildResearchRunLeague = (candidates, options) => {
    const run = originalBuild(candidates, options);
    captured = Object.freeze({ candidates, options, run });
    return run;
  };

  const persistCapturedSnapshot = () => {
    if (persisted) return undefined;
    if (captured == null) throw new Error("real Research run produced no canonical League result to snapshot");
    persisted = true;
    dependencies.leagueBridge.buildResearchRunLeague = originalBuild;
    const modules = dependencies.loadSnapshotModules();
    if (typeof modules.createResearchRunReplaySnapshot !== "function" || typeof modules.FileResearchRunReplaySnapshotStore !== "function") {
      throw new Error("research replay snapshot modules are unavailable");
    }
    const snapshot = modules.createResearchRunReplaySnapshot(captured.candidates, captured.options, captured.run);
    const store = new modules.FileResearchRunReplaySnapshotStore(snapshotPath);
    return store.save(snapshot);
  };

  return Object.freeze({ wrappedBuildResearchRunLeague, persistCapturedSnapshot, snapshotPath, restore: () => { dependencies.leagueBridge.buildResearchRunLeague = originalBuild; } });
}

function install(env = process.env, dependencies = defaultDependencies()) {
  const capture = createCapture(env, dependencies);
  dependencies.leagueBridge.buildResearchRunLeague = capture.wrappedBuildResearchRunLeague;
  process.once("beforeExit", () => {
    if ((process.exitCode ?? 0) !== 0) {
      capture.restore();
      return;
    }
    capture.persistCapturedSnapshot();
  });
  return capture;
}

if (process.argv[1] && path.basename(process.argv[1]) === "research-real-market-run.js") {
  install();
}

module.exports = { createCapture, install, requiredSnapshotPath };