import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createResearchMemoryRelationEvent,
  createResearchMemorySemanticEvent,
  type ResearchMemoryArtifactRef,
} from "../../contracts/src/researchMemorySemantic";
import {
  researchMemorySemanticOverlayMigration,
  SqliteResearchMemorySemanticOverlayRepository,
} from "./researchMemorySemanticOverlay";

class TestDatabase {
  readonly connection = new DatabaseSync(":memory:");
  transaction<T>(fn: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void { this.connection.close(); }
}

const authority = Object.freeze({
  authority: "PAPER_ONLY" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

const artifact = (
  id: string,
  digest = "b".repeat(64),
): ResearchMemoryArtifactRef => Object.freeze({
  artifactKind: "FACTORY_DECISION",
  artifactId: id,
  artifactContentSha256: digest,
  artifactDigestKind: "CANONICAL_EXISTING_SHA256",
});

function semantic(id = "decision-1") {
  return createResearchMemorySemanticEvent({
    schemaVersion: 1,
    artifact: artifact(id),
    semanticClass: "EVIDENCE",
    validity: "CURRENT",
    evidenceOrigin: "CANONICAL_EVALUATOR",
    causalAttribution: "SAMPLE_STATISTICS",
    evaluatorSemanticsId: "backtest-next-observation+warmup-v1",
    independenceGroupId: "search-group-1",
    actor: "research-factory",
    reason: "canonical deterministic qualification evidence",
    occurredAt: "2026-09-19T00:00:00.000Z",
    ...authority,
  });
}

function fixture() {
  const db = new TestDatabase();
  db.connection.exec(researchMemorySemanticOverlayMigration.sql);
  return { db, repo: new SqliteResearchMemorySemanticOverlayRepository(db) };
}

test("semantic overlay survives restart and exact replay is idempotent", () => {
  const { db, repo } = fixture();
  try {
    const event = semantic();
    assert.equal(repo.appendSemantic(event).appended, true);
    const restarted = new SqliteResearchMemorySemanticOverlayRepository(db);
    assert.equal(restarted.appendSemantic(event).appended, false);
    assert.deepEqual(restarted.listSemantic(), [event]);
    assert.match(restarted.headHash(), /^[a-f0-9]{64}$/);
  } finally { db.close(); }
});

test("same deterministic semantic identity with changed metadata fails closed", () => {
  const { db, repo } = fixture();
  try {
    const first = semantic();
    repo.appendSemantic(first);
    const { eventId: _eventId, ...input } = first;
    const changed = createResearchMemorySemanticEvent({
      ...input,
      occurredAt: "2026-09-19T01:00:00.000Z",
    });
    assert.equal(changed.eventId, first.eventId);
    assert.throws(
      () => repo.appendSemantic(changed),
      /RESEARCH_MEMORY_SEMANTIC_OVERLAY_REPLAY_MISMATCH/,
    );
    assert.equal(repo.listSemantic().length, 1);
  } finally { db.close(); }
});

test("relation events are append-only and exact replay is idempotent", () => {
  const { db, repo } = fixture();
  try {
    const relation = createResearchMemoryRelationEvent({
      schemaVersion: 1,
      relationType: "REVALIDATES",
      source: artifact("decision-new", "c".repeat(64)),
      target: artifact("decision-old", "d".repeat(64)),
      actor: "research-factory",
      reason: "new evaluator semantics revalidates legacy evidence",
      occurredAt: "2026-09-19T00:01:00.000Z",
      ...authority,
    });
    assert.equal(repo.appendRelation(relation).appended, true);
    assert.equal(repo.appendRelation(relation).appended, false);
    assert.deepEqual(repo.listRelations(), [relation]);
  } finally { db.close(); }
});

test("row and meta corruption fail closed", () => {
  const { db, repo } = fixture();
  try {
    repo.appendSemantic(semantic());
    db.connection.prepare(
      "UPDATE research_memory_semantic_overlay_events SET payload_json = ? WHERE sequence = 1",
    ).run("{}");
    assert.throws(
      () => repo.listSemantic(),
      /RESEARCH_MEMORY_SEMANTIC_OVERLAY_INTEGRITY_VIOLATION/,
    );
  } finally { db.close(); }

  const second = fixture();
  try {
    second.repo.appendSemantic(semantic("decision-2"));
    second.db.connection.prepare(
      "UPDATE research_memory_semantic_overlay_meta SET event_count = 2 WHERE id = 1",
    ).run();
    assert.throws(
      () => second.repo.listSemantic(),
      /RESEARCH_MEMORY_SEMANTIC_OVERLAY_META_MISMATCH/,
    );
  } finally { second.db.close(); }
});

test("forged authority cannot be persisted", () => {
  const { db, repo } = fixture();
  try {
    const forged = {
      ...semantic(),
      aiAuthority: "FULL_AUTHORITY",
    } as unknown as ReturnType<typeof semantic>;
    assert.throws(
      () => repo.appendSemantic(forged),
      /RESEARCH_MEMORY_SEMANTIC_AUTHORITY_INVALID/,
    );
    assert.equal(repo.listSemantic().length, 0);
  } finally { db.close(); }
});
