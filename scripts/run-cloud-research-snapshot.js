"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SHA40 = /^[a-f0-9]{40}$/;
const DEFAULT_COST_MODEL_VERSION = "nusa-paper-cost-v1";

function buildResearchEnv(source = process.env) {
  const env = { ...source };
  const sourceCommitSha = String(env.NUSA_SOURCE_COMMIT_SHA || "").trim().toLowerCase();
  const sourceCommit = String(env.NUSA_SOURCE_COMMIT || "").trim().toLowerCase();
  if (sourceCommitSha && sourceCommit && sourceCommitSha !== sourceCommit) {
    throw new Error("NUSA_SOURCE_COMMIT and NUSA_SOURCE_COMMIT_SHA disagree");
  }
  const resolvedSourceCommit = sourceCommitSha || sourceCommit;
  if (!SHA40.test(resolvedSourceCommit)) throw new Error("cloud Research snapshot requires exact NUSA_SOURCE_COMMIT(_SHA)");
  env.NUSA_SOURCE_COMMIT_SHA = resolvedSourceCommit;
  if (!String(env.NUSA_RESEARCH_COST_MODEL_VERSION || "").trim()) {
    env.NUSA_RESEARCH_COST_MODEL_VERSION = DEFAULT_COST_MODEL_VERSION;
  }
  const stateDb = String(env.NUSA_CLOUD_STATE_DB_PATH || "").trim();
  const snapshotPath = String(env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH || "").trim();
  if (!snapshotPath) {
    if (!path.isAbsolute(stateDb) || stateDb === ":memory:") throw new Error("cloud Research snapshot requires a durable Cloud state path");
    env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH = path.join(path.dirname(stateDb), "research-replay-snapshots.json");
  } else if (!path.isAbsolute(snapshotPath) || snapshotPath === ":memory:") {
    throw new Error("cloud Research snapshot path must be absolute and durable");
  }
  return env;
}

function run(options = {}) {
  const env = buildResearchEnv(options.env ?? process.env);
  const cwd = options.cwd ?? process.cwd();
  const executable = options.executable ?? process.execPath;
  const spawn = options.spawnSync ?? spawnSync;
  const args = ["-r", "./scripts/research-replay-snapshot-capture.js", "scripts/research-real-market-run.js"];
  const result = spawn(executable, args, { cwd, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`cloud Research snapshot terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`cloud Research snapshot failed with exit ${String(result.status)}`);
  return Object.freeze({ status: "COMPLETED", sourceCommitSha: env.NUSA_SOURCE_COMMIT_SHA, snapshotPath: env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH, costModelVersion: env.NUSA_RESEARCH_COST_MODEL_VERSION });
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    console.error("[cloud-research-snapshot]", error instanceof Error ? error.message : "failed");
    process.exitCode = 1;
  }
}

module.exports = { buildResearchEnv, DEFAULT_COST_MODEL_VERSION, run };
