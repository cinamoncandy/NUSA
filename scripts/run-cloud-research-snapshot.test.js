"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { buildResearchEnv, DEFAULT_COST_MODEL_VERSION, run } = require("./run-cloud-research-snapshot.js");

const SHA = "a".repeat(40);

test("maps exact deployed source SHA and durable snapshot path into canonical Research env", () => {
  const env = buildResearchEnv({
    NUSA_SOURCE_COMMIT: SHA,
    NUSA_CLOUD_STATE_DB_PATH: path.resolve("/var/lib/nusa/state.sqlite"),
  });
  assert.equal(env.NUSA_SOURCE_COMMIT_SHA, SHA);
  assert.equal(env.NUSA_RESEARCH_COST_MODEL_VERSION, DEFAULT_COST_MODEL_VERSION);
  assert.equal(env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH, path.resolve("/var/lib/nusa/research-replay-snapshots.json"));
});

test("preserves an explicit cost-model identity and absolute snapshot path", () => {
  const env = buildResearchEnv({
    NUSA_SOURCE_COMMIT_SHA: SHA,
    NUSA_CLOUD_STATE_DB_PATH: path.resolve("/var/lib/nusa/state.sqlite"),
    NUSA_RESEARCH_COST_MODEL_VERSION: "declared-cost-v9",
    NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: path.resolve("/srv/nusa/research.json"),
  });
  assert.equal(env.NUSA_RESEARCH_COST_MODEL_VERSION, "declared-cost-v9");
  assert.equal(env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH, path.resolve("/srv/nusa/research.json"));
});

test("fails closed on missing source identity or non-durable state", () => {
  assert.throws(() => buildResearchEnv({ NUSA_CLOUD_STATE_DB_PATH: path.resolve("/var/lib/nusa/state.sqlite") }), /exact NUSA_SOURCE_COMMIT/);
  assert.throws(() => buildResearchEnv({ NUSA_SOURCE_COMMIT: SHA, NUSA_CLOUD_STATE_DB_PATH: ":memory:" }), /durable Cloud state/);
  assert.throws(() => buildResearchEnv({ NUSA_SOURCE_COMMIT: SHA, NUSA_CLOUD_STATE_DB_PATH: path.resolve("/var/lib/nusa/state.sqlite"), NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: "relative.json" }), /absolute and durable/);
});

test("runs only the canonical preload + real public-market Research script", () => {
  let observed;
  const result = run({
    env: { NUSA_SOURCE_COMMIT: SHA, NUSA_CLOUD_STATE_DB_PATH: path.resolve("/var/lib/nusa/state.sqlite") },
    cwd: path.resolve("/opt/nusa/current"),
    executable: path.resolve("/usr/bin/node"),
    spawnSync: (executable, args, options) => {
      observed = { executable, args, options };
      return { status: 0, signal: null };
    },
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(observed.executable, path.resolve("/usr/bin/node"));
  assert.deepEqual(observed.args, ["-r", "./scripts/research-replay-snapshot-capture.js", "scripts/research-real-market-run.js"]);
  assert.equal(observed.options.shell, false);
});
