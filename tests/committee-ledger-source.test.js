const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { loadCommitteeDashboardSource } = require("../dist/apps/desktop/src/persistence/committeeLedgerStore.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteInvestmentCommitteeStore } = require("../dist/packages/storage/src/investmentCommitteeStore.js");

const decision = (overrides = {}) => ({
  outcome: "PAPER_ONLY",
  confidence: 0.8,
  edge: 0.05,
  risk: 0.2,
  reasons: Object.freeze(["test"]),
  decidedAt: 1_100,
  ...overrides,
});

test("empty ledger reports UNAVAILABLE without a decision", () => {
  const db = new SqliteDatabase(":memory:");
  new SqliteInvestmentCommitteeStore(db);
  const result = loadCommitteeDashboardSource(db.connection);
  assert.equal(result.integrity, "UNAVAILABLE");
  assert.equal(result.decision, null);
  assert.ok(Object.isFrozen(result));
  db.close();
});

test("appended decision replays to VALID with the latest decision", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteInvestmentCommitteeStore(db);
  store.append(decision());
  store.append(decision({ outcome: "WAIT", decidedAt: 1_200 }));
  const result = loadCommitteeDashboardSource(db.connection);
  assert.equal(result.integrity, "VALID");
  assert.equal(result.decision.outcome, "WAIT");
  assert.equal(result.decision.decidedAt, 1_200);
  db.close();
});

test("tampered event payload fails closed to INVALID", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteInvestmentCommitteeStore(db);
  store.append(decision());
  db.connection.exec("UPDATE investment_committee_events SET decision_json = '{\"outcome\":\"APPROVE\"}' WHERE sequence = 1");
  const result = loadCommitteeDashboardSource(db.connection);
  assert.equal(result.integrity, "INVALID");
  assert.equal(result.decision, null);
  db.close();
});

test("missing ledger table fails closed to INVALID instead of throwing", () => {
  const db = new DatabaseSync(":memory:");
  const result = loadCommitteeDashboardSource(db);
  assert.equal(result.integrity, "INVALID");
  assert.equal(result.decision, null);
  db.close();
});
