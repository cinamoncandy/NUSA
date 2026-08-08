const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase, SqliteResearchHypothesisLifecycleRepository } = require("../dist/packages/storage/src/index.js");

test("hypothesis lifecycle events persist, replay, and reject tampering", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repository = new SqliteResearchHypothesisLifecycleRepository(db);
    repository.append({ hypothesisId: "h-1", type: "CREATED", title: "H", statement: "S", occurredAt: "2026-08-08T00:00:00.000Z" });
    repository.append({ hypothesisId: "h-1", type: "ACTIVATED", title: "H", statement: "S", occurredAt: "2026-08-08T00:00:01.000Z" });
    assert.equal(repository.current("h-1"), "ACTIVE");
    db.connection.prepare("UPDATE research_hypothesis_events SET hash = ? WHERE sequence = 2").run("f".repeat(64));
    assert.throws(() => repository.list(), /integrity/);
  } finally { db.close(); }
});
