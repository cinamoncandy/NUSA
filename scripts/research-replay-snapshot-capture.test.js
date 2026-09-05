"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCapture, requiredSnapshotPath } = require("./research-replay-snapshot-capture.js");

function dependencies() {
  const calls = [];
  const leagueBridge = {
    buildResearchRunLeague: (candidates, options) => Object.freeze({ provenance: Object.freeze({ sourceCommitSha: "a".repeat(40), runFingerprintSha256: "b".repeat(64) }), candidates, options })
  };
  class Store {
    constructor(filename) { this.filename = filename; }
    save(snapshot) { calls.push(Object.freeze({ filename: this.filename, snapshot })); return snapshot; }
  }
  return {
    calls,
    leagueBridge,
    loadSnapshotModules: () => ({
      createResearchRunReplaySnapshot: (candidates, options, run) => Object.freeze({ schemaVersion: 1, candidates, options, originalRunFingerprintSha256: run.provenance.runFingerprintSha256, snapshotSha256: "c".repeat(64) }),
      FileResearchRunReplaySnapshotStore: Store
    })
  };
}

const env = Object.freeze({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: path.resolve("/tmp/nusa-research-replay-snapshots.json") });

test("captures exact canonical League inputs and persists one immutable replay snapshot", () => {
  const deps = dependencies();
  const capture = createCapture(env, deps);
  const candidates = Object.freeze([{ id: "c1" }]);
  const options = Object.freeze({ generatedAt: "2026-09-05T00:00:00.000Z" });
  const run = capture.wrappedBuildResearchRunLeague(candidates, options);
  const snapshot = capture.persistCapturedSnapshot();
  assert.equal(run.provenance.runFingerprintSha256, "b".repeat(64));
  assert.equal(snapshot.originalRunFingerprintSha256, run.provenance.runFingerprintSha256);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].filename, env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH);
  assert.equal(capture.persistCapturedSnapshot(), undefined);
});

test("fails closed when no canonical League run was captured", () => {
  const capture = createCapture(env, dependencies());
  assert.throws(() => capture.persistCapturedSnapshot(), /no canonical League result/);
});

test("uses the durable Cloud-state sibling path when no explicit replay snapshot path is supplied", () => {
  const stateDb = path.resolve("/var/lib/nusa/state.sqlite");
  assert.equal(requiredSnapshotPath({ NUSA_CLOUD_STATE_DB_PATH: stateDb }), path.join(path.dirname(stateDb), "research-replay-snapshots.json"));
});

test("requires an explicit snapshot path or an absolute durable Cloud state path", () => {
  assert.throws(() => requiredSnapshotPath({}), /absolute durable NUSA_CLOUD_STATE_DB_PATH/);
  assert.throws(() => requiredSnapshotPath({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: ":memory:" }), /absolute durable path/);
  assert.throws(() => requiredSnapshotPath({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: "relative.json" }), /absolute durable path/);
  assert.throws(() => requiredSnapshotPath({ NUSA_CLOUD_STATE_DB_PATH: ":memory:" }), /absolute durable NUSA_CLOUD_STATE_DB_PATH/);
  assert.throws(() => requiredSnapshotPath({ NUSA_CLOUD_STATE_DB_PATH: "relative.sqlite" }), /absolute durable NUSA_CLOUD_STATE_DB_PATH/);
});

test("the canonical real-market Research command cannot bypass replay snapshot capture", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.match(pkg.scripts["research:real-run"], /node -r \.\/scripts\/research-replay-snapshot-capture\.js scripts\/research-real-market-run\.js/);
});