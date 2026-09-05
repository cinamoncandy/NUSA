const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { SqliteDatabase, SqliteResearchMemoryRepository } = require("../dist/packages/storage/src/index.js");

const file = () => join(mkdtempSync(join(tmpdir(), "nusa-research-memory-")), "research.db");
const hypothesis = () => ({ id: "hypothesis.sma.v1", title: "SMA crossover", statement: "A crossover may outperform after costs.", status: "DRAFT", createdAt: "2026-01-01T00:00:00.000Z" });
const experiment = () => ({ id: "experiment.sma.v1", datasetId: "upbit_KRW-BTC_1m_20260101_20260101_abc123", contentSha256: "a".repeat(64), manifestSchemaVersion: 1, market: "KRW-BTC", interval: "1m", startOpenTime: 0, endCloseTime: 60_000, walkForwardConfigJson: "{\"trainSize\":3}", resultJson: "{\"markedTotalReturn\":0.01}", createdAt: "2026-01-02T00:00:00.000Z", hypothesisId: "hypothesis.sma.v1" });

test("research memory stores immutable hypothesis and experiment linked to dataset identity", () => {
  const db = new SqliteDatabase(); const memory = new SqliteResearchMemoryRepository(db);
  const storedHypothesis = memory.appendHypothesis(hypothesis());
  const storedExperiment = memory.appendExperiment(experiment());
  assert.equal(storedExperiment.datasetId, experiment().datasetId);
  assert.equal(storedExperiment.contentSha256, "a".repeat(64));
  assert.equal(memory.listHypotheses().length, 1); assert.equal(memory.listExperiments().length, 1);
  assert.equal(Object.isFrozen(storedHypothesis), true); assert.equal(Object.isFrozen(storedExperiment), true); db.close();
});

test("research memory duplicate append is idempotent and conflicting append fails closed", () => {
  const db = new SqliteDatabase(); const memory = new SqliteResearchMemoryRepository(db); memory.appendHypothesis(hypothesis());
  assert.deepEqual(memory.appendExperiment(experiment()), memory.appendExperiment(experiment()));
  assert.throws(() => memory.appendExperiment({ ...experiment(), resultJson: "{\"markedTotalReturn\":0.02}" }), error => error.code === "ID_CONFLICT");
  assert.equal(memory.listExperiments().length, 1); db.close();
});

test("research memory rejects an experiment with an unknown hypothesis", () => {
  const db = new SqliteDatabase(); const memory = new SqliteResearchMemoryRepository(db);
  assert.throws(() => memory.appendExperiment(experiment()), error => error.code === "HYPOTHESIS_NOT_FOUND"); db.close();
});

test("research memory transaction rollback preserves prior durable state on write failure", () => {
  const db = new SqliteDatabase(); const memory = new SqliteResearchMemoryRepository(db); memory.appendHypothesis(hypothesis());
  db.connection.exec("CREATE TRIGGER reject_research_experiment BEFORE INSERT ON research_experiment_records BEGIN SELECT RAISE(ABORT, 'forced write failure'); END");
  assert.throws(() => memory.appendExperiment(experiment()), /forced write failure/);
  assert.equal(memory.getExperiment(experiment().id), undefined); db.close();
});

test("research memory survives restart and retains dataset-linked experiment", () => {
  const filename = file(); const first = new SqliteDatabase(filename); let memory = new SqliteResearchMemoryRepository(first); memory.appendHypothesis(hypothesis()); memory.appendExperiment(experiment()); first.close();
  const reopened = new SqliteDatabase(filename); memory = new SqliteResearchMemoryRepository(reopened);
  assert.equal(memory.getExperiment(experiment().id).contentSha256, "a".repeat(64)); assert.equal(memory.listExperiments(experiment().datasetId).length, 1); reopened.close();
});

test("research memory fails closed for corrupt databases and malformed persisted records", () => {
  const corrupt = file(); writeFileSync(corrupt, "not sqlite"); assert.throws(() => new SqliteDatabase(corrupt));
  const db = new SqliteDatabase(); const memory = new SqliteResearchMemoryRepository(db); memory.appendHypothesis(hypothesis());
  db.connection.prepare("INSERT INTO research_experiment_records (id, dataset_id, content_sha256, manifest_schema_version, market, interval, start_open_time, end_close_time, walk_forward_config_json, result_json, created_at, hypothesis_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("invalid.json", "dataset", "b".repeat(64), 1, "KRW-BTC", "1m", 0, 60_000, "not-json", "{}", "2026-01-01T00:00:00.000Z", "hypothesis.sma.v1");
  assert.throws(() => memory.getExperiment("invalid.json"), error => error.code === "INVALID_RECORD"); db.close();
});

