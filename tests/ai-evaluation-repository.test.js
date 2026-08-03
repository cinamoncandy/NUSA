const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { evaluateAiOutput } = require("../dist/apps/execution/src/ai-evaluation-framework.js");
const { SqliteAiEvaluationRepository, AiEvaluationRepositoryError } = require("../dist/packages/storage/src/ai-evaluation-repository.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function envelope(overrides = {}) {
  return {
    schemaVersion: 1, subjectType: "STRATEGY_GENERATION", subjectId: "strategy-candidate-1",
    producedAt: "2026-08-03T00:00:00.000Z", producerIdentifier: "test",
    claims: [{ claimId: "c1", statement: "backtest shows improved Sharpe", citedEvidenceIds: ["e1"] }],
    evidenceBundle: [{ evidenceId: "e1", sourceType: "BACKTEST_REPORT", contentSha256: sha256("report"), provenance: "REAL" }],
    datasetContentSha256: sha256("dataset"), operationalDataPoints: 10, ...overrides
  };
}

function repository() { return new SqliteAiEvaluationRepository({ connection: new DatabaseSync(":memory:") }); }

test("appending an evaluation makes it retrievable by id and as the subject's latest", () => {
  const repo = repository();
  const record = evaluateAiOutput(envelope(), { evaluationId: "eval-1", evaluatedAt: "2026-08-03T00:00:00.000Z" });
  repo.append(record);
  assert.deepEqual(repo.getById("eval-1"), record);
  assert.deepEqual(repo.latestForSubject("strategy-candidate-1"), record);
});

test("re-evaluating the same subject preserves every prior version rather than overwriting it", () => {
  const repo = repository();
  const first = evaluateAiOutput(envelope(), { evaluationId: "eval-1", evaluatedAt: "2026-08-01T00:00:00.000Z" });
  const second = evaluateAiOutput(envelope({ claims: [{ claimId: "c1", statement: "unbacked", citedEvidenceIds: [] }] }), { evaluationId: "eval-2", evaluatedAt: "2026-08-02T00:00:00.000Z" });
  repo.append(first);
  repo.append(second);

  const history = repo.historyForSubject("strategy-candidate-1");
  assert.equal(history.length, 2, "both versions must still be present");
  assert.deepEqual(history.map((r) => r.evaluationId), ["eval-1", "eval-2"], "oldest first");
  assert.equal(repo.latestForSubject("strategy-candidate-1").evaluationId, "eval-2", "latest reads the newest, but does not delete the older one");
  assert.equal(history[0].verdict, "PASS");
  assert.equal(history[1].verdict, "FAIL");
});

test("a record whose stored hash does not match its own content is rejected before it reaches the database", () => {
  const repo = repository();
  const record = evaluateAiOutput(envelope(), { evaluationId: "eval-1" });
  const tampered = { ...record, verdict: "FAIL" }; // recordSha256 now stale relative to the changed verdict
  assert.throws(() => repo.append(tampered), AiEvaluationRepositoryError);
  assert.equal(repo.getById("eval-1"), undefined, "the rejected record must not have been written");
});

test("the same evaluationId cannot be appended twice", () => {
  const repo = repository();
  const record = evaluateAiOutput(envelope(), { evaluationId: "eval-1" });
  repo.append(record);
  assert.throws(() => repo.append(record), AiEvaluationRepositoryError);
});

test("history for a subject with no evaluations is empty, not an error", () => {
  const repo = repository();
  assert.deepEqual(repo.historyForSubject("never-evaluated"), []);
  assert.equal(repo.latestForSubject("never-evaluated"), undefined);
});
