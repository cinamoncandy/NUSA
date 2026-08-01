const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqlitePaperScenarioEvidenceStore } = require("../dist/packages/storage/src/paperScenarioEvidenceStore.js");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const path = () => join(mkdtempSync(join(tmpdir(), "nusa-evidence-store-")), "evidence.db");
const event = (eventId, type, occurredAt, scenario) => ({ eventId, type, occurredAt, ...(scenario ? { scenario } : {}) });

test("persists and replays scenario evidence after restart", () => {
  const filename = path();
  const first = new SqliteDatabase(filename); const store = new SqlitePaperScenarioEvidenceStore(first);
  store.append(event("s1", "SESSION_OBSERVED", 1)); store.append(event("o1", "ORDER_COMPLETED", 2)); store.append(event("r1", "REGIME_OBSERVED", 3, "TREND")); first.close();
  const reopened = new SqliteDatabase(filename); const restored = new SqlitePaperScenarioEvidenceStore(reopened);
  try { assert.equal(restored.replay().completedOrderCount, 1); assert.equal(restored.replay().regimeCount, 1); restored.verify(); } finally { reopened.close(); }
});

test("duplicate append and tampered persisted chain fail closed", () => {
  const db = new SqliteDatabase(":memory:"); const store = new SqlitePaperScenarioEvidenceStore(db); store.append(event("s1", "SESSION_OBSERVED", 1));
  assert.throws(() => store.append(event("s1", "SESSION_OBSERVED", 2)), /duplicate/);
  db.connection.prepare("UPDATE paper_scenario_evidence SET hash = ? WHERE sequence = 1").run("f".repeat(64));
  assert.throws(() => store.verify(), /hash chain/); db.close();
});
