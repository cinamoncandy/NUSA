"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { inventory, TABLES } = require("../scripts/permit-inventory.js");

function makeDb(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-inventory-"));
  const file = path.join(dir, "state.sqlite");
  const db = new DatabaseSync(file); setup(db); db.close();
  return { dir, file };
}

test("counts rows of the tables that exist and reads a missing table as absent", () => {
  const { dir, file } = makeDb((db) => {
    db.exec("CREATE TABLE research_candidates (id INTEGER); INSERT INTO research_candidates VALUES (1), (2), (3);");
    db.exec("CREATE TABLE ai_calibration_durability_events (id INTEGER); INSERT INTO ai_calibration_durability_events VALUES (1);");
  });
  try {
    const r = inventory(file);
    assert.deepEqual(r.groups.research.research_candidates, { exists: true, rows: 3 });
    assert.deepEqual(r.groups.futures_data.research_futures_klines, { exists: false });
    assert.equal(r.summary.researchCandidates, 3); assert.equal(r.summary.calibrationSamples, 1); assert.equal(r.summary.futuresRows, 0); assert.equal(r.summary.permitRecords, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("it is read-only: the database file is byte-identical afterwards and a write attempt through it is impossible", () => {
  const { dir, file } = makeDb((db) => { db.exec("CREATE TABLE research_candidates (id INTEGER); INSERT INTO research_candidates VALUES (1);"); });
  try {
    const before = fs.readFileSync(file);
    inventory(file);
    assert.ok(before.equals(fs.readFileSync(file)));
    assert.deepEqual(fs.readdirSync(dir).sort(), ["state.sqlite"], "no journal or temp file is left behind");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("only the fixed allow-list of table names is ever queried, and every name is a plain identifier", () => {
  for (const tables of Object.values(TABLES)) for (const t of tables) assert.match(t, /^[a-z][a-z0-9_]*$/);
});

test("the command line prints JSON, refuses a missing argument and a missing file without printing row content", () => {
  const { dir, file } = makeDb((db) => { db.exec("CREATE TABLE research_candidates (secret TEXT); INSERT INTO research_candidates VALUES ('do-not-print-me');"); });
  try {
    const script = path.resolve(__dirname, "../scripts/permit-inventory.js");
    const ok = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr); assert.doesNotMatch(ok.stdout, /do-not-print-me/); assert.equal(JSON.parse(ok.stdout).summary.researchCandidates, 1);
    assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 64);
    assert.equal(spawnSync(process.execPath, [script, path.join(dir, "missing.sqlite")], { encoding: "utf8" }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
