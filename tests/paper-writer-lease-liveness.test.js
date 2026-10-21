const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const productionRoot = "apps/cloud/src/closedLearningProductionRuntime.ts";
const riskGateway = "apps/cloud/src/cloudPaperCanonicalRiskGateway.ts";
const canonicalStorage = "packages/storage/src/index.ts";

test("PAPER startup completes Cloud AI durability integrity work before writer-lease acquisition", () => {
  const source = fs.readFileSync(productionRoot, "utf8");
  const ai = source.indexOf("const cloudAiRuntime = createCloudAiRuntime(env");
  const lease = source.indexOf("new SqliteCloudPaperAccountRepository(database");
  const runtime = source.indexOf("const baseHandle = startCloudRuntime(");

  assert.ok(ai >= 0, "prebuilt Cloud AI runtime must be explicit");
  assert.match(source.slice(ai, ai + 350), /verifiedSharedSqliteConnection:\s*database\.connection/, "the prebuilt Cloud AI runtime must reuse the exact canonical SQLite connection after its full integrity scan");
  assert.ok(lease > ai, "Cloud AI durability must open/verify before the PAPER repository acquires its renewable lease");
  assert.ok(runtime > lease, "the canonical PAPER repository still owns the lease before runtime composition");
  assert.match(source.slice(runtime, runtime + 1000), /researchExperiments\?\.orchestrator,\s*cloudAiRuntime,/);
  assert.doesNotMatch(source.slice(runtime, runtime + 1000), /createCloudAiRuntime\(env\)/);
});

test("full SQLite integrity remains fail-closed at canonical database open, not the PAPER risk hot path", () => {
  const storage = fs.readFileSync(canonicalStorage, "utf8");
  const risk = fs.readFileSync(riskGateway, "utf8");

  assert.match(storage, /prepare\("PRAGMA quick_check"\)/, "canonical SqliteDatabase startup must retain the full-file quick_check");
  assert.doesNotMatch(risk, /PRAGMA quick_check/, "a PAPER risk evaluation must never rescan the full database");
  assert.match(risk, /SELECT 1 AS ready/, "the hot path must still prove the canonical connection is responsive");
  for (const table of ["risk_paper_approvals", "risk_daily_loss_state", "risk_idempotency_records", "risk_order_state"]) {
    assert.ok(risk.includes(table), `Risk health must still require ${table}`);
  }
});
