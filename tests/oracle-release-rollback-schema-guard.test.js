"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const script = fs.readFileSync(path.join(__dirname, "..", "deploy", "oracle", "nusa-release-step.sh"), "utf8");
const fn = script.slice(script.indexOf("rollback_schema_compatible() {"), script.indexOf("rollback_and_restore() {"));

function run(appliedIds, releaseIds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-guard-"));
  try {
    const dbPath = path.join(root, "state.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY)");
    for (const id of appliedIds) db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id);
    db.close();
    const release = path.join(root, "release");
    fs.mkdirSync(path.join(release, "packages", "storage", "src"), { recursive: true });
    fs.writeFileSync(path.join(release, "packages", "storage", "src", "index.ts"), releaseIds.map((id) => `{ id: "${id}", sql: "" },`).join("\n"));
    const env = path.join(root, "cloud-runtime.env");
    fs.writeFileSync(env, `NUSA_CLOUD_STATE_DB_PATH=${dbPath}\n`);
    const result = spawnSync("bash", ["-c", `set -uo pipefail\nRUNTIME_ENV=${JSON.stringify(env)}\n${fn}\nrollback_schema_compatible ${JSON.stringify(release)}`], { encoding: "utf8" });
    return result.status;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("the rollback guard accepts a release that knows every applied migration", () => {
  assert.equal(run(["027_research_holdout_usage"], ["026_research_closed_candles", "027_research_holdout_usage"]), 0);
});

test("the rollback guard refuses a release that does not know an applied migration (the 2026-10-13 outage)", () => {
  assert.equal(run(["027_research_holdout_usage", "028_research_market_microstructure"], ["027_research_holdout_usage"]), 1);
});

test("activation keeps the new release when the previous one cannot open the migrated database", () => {
  assert.match(script, /if ! rollback_schema_compatible "\$\(previous_release\)"; then[\s\S]*keeping \$1 active \(no rollback\)[\s\S]*exit 1/);
});
