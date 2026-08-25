"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readPersistedPaperLearningIds } = require("../scripts/actual-paper-runtime-e2e.js");

test("persisted PAPER replay baseline uses the exact newest projection ordering", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-replay-"));
  const databasePath = join(directory, "state.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("CREATE TABLE paper_learning_observability_events (event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL)");
    const insert = database.prepare("INSERT INTO paper_learning_observability_events (event_id, occurred_at, schema_version, payload_json) VALUES (?, ?, ?, ?)");
    insert.run("old", 100, 1, "{}");
    insert.run("new-b", 300, 1, "{}");
    insert.run("new-a", 300, 1, "{}");
    insert.run("ignored-future-schema", 400, 2, "{}");
  } finally {
    database.close();
  }

  try {
    assert.deepEqual(readPersistedPaperLearningIds(databasePath), ["new-a", "new-b", "old"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
