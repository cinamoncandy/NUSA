import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { normalizeStrategyReplication, strategyReplicationPrecommit, type StrategyReplicationInput } from "../../contracts/src/researchExternalIntake";
import { SqliteResearchPrecommitRepository } from "./researchPrecommit";

const sourceSnapshot = "Published strategy rules: enter next open, exit below prior low.";
const sourceFingerprint = createHash("sha256").update(sourceSnapshot).digest("hex");
const sourceSha = "b".repeat(40);
const evaluationPlan = { pitWindow: { startAt: "2026-01-01T00:00:00Z", endAt: "2026-06-01T00:00:00Z" }, oosWindow: { startAt: "2026-06-02T00:00:00Z", endAt: "2026-07-01T00:00:00Z" }, latencyAssumptions: "modeled next-bar delay", missingDataPolicy: "reject incomplete windows" };
const costPlan = { feeModelVersion: "fee-v1", slippageModelVersion: "slippage-v1" };
const strategy = (patch: Partial<StrategyReplicationInput> = {}): StrategyReplicationInput => ({
  sourceUrl: "https://example.org/strategy", sourceFingerprint, sourceSnapshot, sourceObservedAt: "2026-10-25T00:00:00.000Z",
  strategyName: "Example", strategyFamily: "momentum", market: "KRW-XRP", instruments: ["KRW-XRP"], timeframe: "1m", dataRequirements: ["UPBIT_PUBLIC_CANDLES"],
  signalDefinition: "close > prior high", entryRule: "enter on next open", exitRule: "close below prior low", positionSizing: "fixed fraction", riskManagement: "bounded stop", rebalanceFrequency: "per bar", transactionCostAssumptions: "fee model v1", slippageAssumptions: "slippage model v1", ...patch,
});
function fixture() {
  const connection = new DatabaseSync(":memory:");
  const db = { connection, transaction<T>(fn: () => T): T { connection.exec("BEGIN IMMEDIATE"); try { const result = fn(); connection.exec("COMMIT"); return result; } catch (error) { connection.exec("ROLLBACK"); throw error; } }, close(): void { connection.close(); } };
  return { db, repo: new SqliteResearchPrecommitRepository(db) };
}
function precommit(spec: ReturnType<typeof normalizeStrategyReplication>, parentSpec?: ReturnType<typeof normalizeStrategyReplication>, parentPrecommit?: ReturnType<typeof strategyReplicationPrecommit>, createdAt = "2026-10-25T00:00:00Z", validationPolicyIdentity = "policy-v1") {
  return strategyReplicationPrecommit({ spec, ...(parentSpec ? { parentSpec } : {}), ...(parentPrecommit ? { parentPrecommit } : {}), sourceSha, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity, createdAt });
}

test("repeat source captures reuse one durable strategy evaluation precommit", () => {
  const { db, repo } = fixture();
  try {
    const firstSpec = normalizeStrategyReplication(strategy());
    const first = precommit(firstSpec);
    repo.create(first);

    const laterSpec = normalizeStrategyReplication(strategy({ sourceObservedAt: "2026-10-26T00:00:00.000Z" }));
    const later = precommit(laterSpec, undefined, undefined, "2026-10-26T00:00:01Z");
    assert.equal(laterSpec.strategyIdentity, firstSpec.strategyIdentity);
    assert.notEqual(laterSpec.sourceObservationFingerprint, firstSpec.sourceObservationFingerprint);
    assert.equal(later.experimentIdentity, first.experimentIdentity);
    assert.notEqual(later.fingerprint, first.fingerprint, "capture and invocation chronology remain in the immutable first receipt");

    const reused = repo.create(later);
    assert.equal(reused.fingerprint, first.fingerprint);
    assert.equal(repo.get(first.fingerprint)?.fingerprint, first.fingerprint);
    const row = db.connection.prepare("SELECT COUNT(*) AS count FROM research_precommits WHERE experiment_identity = ?").get(first.experimentIdentity) as { readonly count: number } | undefined;
    assert.equal(row?.count, 1);
  } finally { db.close(); }
});

test("strategy precommit identity changes when evaluator source or validation policy changes", () => {
  const spec = normalizeStrategyReplication(strategy());
  const original = precommit(spec);
  const differentPolicy = precommit(spec, undefined, undefined, "2026-10-25T00:00:00Z", "policy-v2");
  const differentSource = strategyReplicationPrecommit({ spec, sourceSha: "c".repeat(40), datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  assert.notEqual(differentPolicy.experimentIdentity, original.experimentIdentity);
  assert.notEqual(differentSource.experimentIdentity, original.experimentIdentity);
});

test("durable experiment identity index must match the immutable precommit payload", () => {
  const { db, repo } = fixture();
  try {
    const original = precommit(normalizeStrategyReplication(strategy()));
    repo.create(original);
    db.connection.prepare("UPDATE research_precommits SET experiment_identity = ? WHERE fingerprint = ?").run("f".repeat(64), original.fingerprint);
    assert.throws(() => repo.get(original.fingerprint), /PRECOMMIT_EXPERIMENT_STORAGE_KEY_MISMATCH/);
  } finally { db.close(); }
});

test("variant precommit cannot persist until its original parent precommit is durable", () => {
  const { db, repo } = fixture();
  try {
    const original = normalizeStrategyReplication(strategy());
    const variant = normalizeStrategyReplication(strategy({ variantOf: original.strategyIdentity, signalDefinition: "close > prior high plus regime filter" }), original);
    const originalPrecommit = precommit(original);
    const variantPrecommit = precommit(variant, original, originalPrecommit);

    assert.throws(() => repo.create(variantPrecommit), /STRATEGY_VARIANT_PARENT_NOT_PERSISTED/);
    assert.equal(repo.get(variantPrecommit.fingerprint), null);

    repo.create(originalPrecommit);
    const storedVariant = repo.create(variantPrecommit);
    assert.equal(storedVariant.fingerprint, variantPrecommit.fingerprint);
    assert.equal((storedVariant.parameterPlan.parentStrategySpec as typeof original).strategyIdentity, original.strategyIdentity);
  } finally { db.close(); }
});

test("caller-provided original with a valid identity cannot stand in for a persisted canonical parent", () => {
  const { db, repo } = fixture();
  try {
    const original = normalizeStrategyReplication(strategy());
    const variant = normalizeStrategyReplication(strategy({ variantOf: original.strategyIdentity, signalDefinition: "close > prior high plus regime filter" }), original);
    const fabricatedParentPrecommit = precommit(original);
    const variantPrecommit = precommit(variant, original, fabricatedParentPrecommit);
    assert.throws(() => repo.create(variantPrecommit), /STRATEGY_VARIANT_PARENT_NOT_PERSISTED/);
    assert.equal(repo.get(variantPrecommit.fingerprint), null);
  } finally { db.close(); }
});

test("legacy orphan variant rows fail closed on canonical precommit reads", () => {
  const { db, repo } = fixture();
  try {
    const original = normalizeStrategyReplication(strategy());
    const variant = normalizeStrategyReplication(strategy({ variantOf: original.strategyIdentity, signalDefinition: "close > prior high plus regime filter" }), original);
    const orphan = precommit(variant, original, precommit(original));
    db.connection.prepare("INSERT INTO research_precommits(fingerprint,experiment_identity,payload_json,created_at) VALUES(?,?,?,?)").run(orphan.fingerprint, orphan.experimentIdentity, JSON.stringify(orphan), orphan.createdAt);

    assert.throws(() => repo.get(orphan.fingerprint), /STRATEGY_VARIANT_PARENT_NOT_PERSISTED/);
  } finally { db.close(); }
});

test("parent payload stored under a different fingerprint key cannot establish lineage", () => {
  const { db, repo } = fixture();
  try {
    const original = normalizeStrategyReplication(strategy());
    const variant = normalizeStrategyReplication(strategy({ variantOf: original.strategyIdentity, signalDefinition: "close > prior high plus regime filter" }), original);
    const originalPrecommit = precommit(original);
    const variantPrecommit = precommit(variant, original, originalPrecommit);
    db.connection.prepare("INSERT INTO research_precommits(fingerprint,experiment_identity,payload_json,created_at) VALUES(?,?,?,?)").run("f".repeat(64), originalPrecommit.experimentIdentity, JSON.stringify(originalPrecommit), originalPrecommit.createdAt);

    assert.throws(() => repo.create(variantPrecommit), /STRATEGY_VARIANT_PARENT_NOT_PERSISTED/);
  } finally { db.close(); }
});

