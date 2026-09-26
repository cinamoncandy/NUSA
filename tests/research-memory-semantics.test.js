import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendResearchMemoryRelationEvent,
  appendResearchMemorySemanticEvent,
  assessResearchProtectedOosEligibility,
  isCanonicalEmpiricalResearchMemoryEvidence,
  replayResearchMemoryOverlayEvents,
  researchMemoryArtifactDigestV1,
  researchMemorySemanticEventIdentity
} from "../dist/packages/contracts/src/researchMemorySemantics.js";
import {
  SqliteDatabase,
  SqliteResearchSemanticMemoryRepository
} from "../dist/packages/storage/src/index.js";
import {
  createResearchMemoryRecord,
  projectLegacyResearchMemoryRecordSemantics,
  projectResearchMemorySemanticInput
} from "../dist/apps/cloud/src/researchMemoryV2.js";

const authority = Object.freeze({
  authority: "PAPER_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY"
});

const artifact = (
  id,
  sha = "a".repeat(64),
  artifactKind = "FACTORY_DECISION",
  artifactDigestKind = "CANONICAL_EXISTING_SHA256"
) => Object.freeze({
  artifactKind,
  artifactId: id,
  artifactContentSha256: sha,
  artifactDigestKind
});

const evidence = (overrides = {}) => ({
  artifact: artifact("decision-a"),
  semanticClass: "EVIDENCE",
  validity: "CURRENT",
  attribution: "SIGNAL",
  evidenceOrigin: "CANONICAL_RESEARCH",
  evaluatorSemanticsId: "eval-v1",
  semanticIdentity: "krw-btc:1d:original-window",
  independenceGroupId: "search-group-a",
  actor: "axiom",
  source: "canonical-research",
  reason: "frozen confirmatory evidence",
  occurredAt: "2026-09-19T00:00:00.000Z",
  ...authority,
  ...overrides
});

const relation = (sourceArtifact, targetArtifact, overrides = {}) => ({
  relationType: "SUPPORTS",
  sourceArtifact,
  targetArtifact,
  actor: "axiom",
  source: "canonical-research",
  reason: "bounded evidence relation",
  occurredAt: "2026-09-19T00:10:00.000Z",
  ...authority,
  ...overrides
});

test("semantic overlay is deterministic, append-only, and exact replay is idempotent", () => {
  const once = appendResearchMemorySemanticEvent([], evidence());
  const twice = appendResearchMemorySemanticEvent(once, evidence());
  assert.equal(twice, once);
  assert.equal(replayResearchMemoryOverlayEvents(once).length, 1);
  assert.equal(isCanonicalEmpiricalResearchMemoryEvidence(once[0]), true);
  assert.equal(once[0].authority, "PAPER_ONLY");
  assert.equal(once[0].liveAuthority, "NONE");
  assert.equal(once[0].productionMutationAllowed, false);
  assert.equal(once[0].aiAuthority, "ZERO_AUTHORITY");
});

test("event identity excludes timestamp/prose while exact metadata conflicts fail closed", () => {
  const firstInput = evidence();
  const changedMetadata = evidence({
    actor: "independent-auditor",
    reason: "same semantic transition, different prose",
    occurredAt: "2026-09-19T01:00:00.000Z"
  });
  assert.equal(
    researchMemorySemanticEventIdentity(firstInput),
    researchMemorySemanticEventIdentity(changedMetadata)
  );
  const records = appendResearchMemorySemanticEvent([], firstInput);
  assert.throws(
    () => appendResearchMemorySemanticEvent(records, changedMetadata),
    /deterministic identity conflict/
  );
});

test("exact artifact provenance is distinct from normalized semantic identity", () => {
  const first = evidence();
  const second = evidence({
    artifact: artifact("decision-b", "b".repeat(64)),
    reason: "same normalized search identity, distinct exact artifact",
    occurredAt: "2026-09-19T00:01:00.000Z"
  });
  let records = appendResearchMemorySemanticEvent([], first);
  records = appendResearchMemorySemanticEvent(records, second);
  assert.equal(records.length, 2);
  assert.equal(records[0].semanticIdentity, records[1].semanticIdentity);
  assert.notEqual(records[0].artifact.artifactContentSha256, records[1].artifact.artifactContentSha256);
});

test("AI/advisory CURRENT evidence and forged authority fail closed", () => {
  assert.throws(
    () => appendResearchMemorySemanticEvent([], evidence({ evidenceOrigin: "AI_ADVISORY" })),
    /canonical empirical evidence origin/
  );
  assert.throws(
    () => appendResearchMemorySemanticEvent([], evidence({ aiAuthority: "FULL_AUTHORITY" })),
    /authority boundary violation/
  );
});

test("a persisted hypothesis never becomes canonical empirical evidence", () => {
  const records = appendResearchMemorySemanticEvent([], evidence({
    artifact: artifact("hypothesis-1", "c".repeat(64), "RESEARCH_HYPOTHESIS"),
    semanticClass: "HYPOTHESIS",
    evidenceOrigin: "HYPOTHESIS_PRIOR",
    semanticIdentity: "mechanism:mean-reversion",
    independenceGroupId: "prior:mechanism-1"
  }));
  assert.equal(isCanonicalEmpiricalResearchMemoryEvidence(records[0]), false);
});

test("LESSON requires at least two independent canonical evidence groups", () => {
  const evidenceA = evidence({
    artifact: artifact("evidence-a", "1".repeat(64), "EVALUATION_LEDGER_RECORD"),
    independenceGroupId: "search-a"
  });
  const evidenceB = evidence({
    artifact: artifact("evidence-b", "2".repeat(64), "EVALUATION_LEDGER_RECORD"),
    independenceGroupId: "search-b"
  });
  const lessonArtifact = artifact("lesson-1", "3".repeat(64), "CLOUD_MEMORY_RECORD");
  const lesson = evidence({
    artifact: lessonArtifact,
    semanticClass: "LESSON",
    semanticIdentity: "lesson:mean-reversion-survives-costs",
    independenceGroupId: "lesson-adjudication"
  });

  let records = appendResearchMemorySemanticEvent([], evidenceA);
  records = appendResearchMemorySemanticEvent(records, evidenceB);
  records = appendResearchMemoryRelationEvent(records, relation(evidenceA.artifact, lessonArtifact));
  assert.throws(
    () => appendResearchMemorySemanticEvent(records, lesson),
    /repeated independent canonical evidence/
  );
  records = appendResearchMemoryRelationEvent(records, relation(evidenceB.artifact, lessonArtifact));
  records = appendResearchMemorySemanticEvent(records, lesson);
  assert.equal(records.at(-1).semanticClass, "LESSON");
});

test("multiple reviews of one independence group do not count as repeated evidence", () => {
  const evidenceA = evidence({
    artifact: artifact("review-a", "4".repeat(64), "EVALUATION_LEDGER_RECORD"),
    independenceGroupId: "same-underlying-result"
  });
  const evidenceB = evidence({
    artifact: artifact("review-b", "5".repeat(64), "EVALUATION_LEDGER_RECORD"),
    independenceGroupId: "same-underlying-result"
  });
  const lessonArtifact = artifact("lesson-2", "6".repeat(64), "CLOUD_MEMORY_RECORD");
  const lesson = evidence({
    artifact: lessonArtifact,
    semanticClass: "LESSON",
    semanticIdentity: "lesson:not-independent",
    independenceGroupId: "lesson-adjudication-2"
  });

  let records = appendResearchMemorySemanticEvent([], evidenceA);
  records = appendResearchMemorySemanticEvent(records, evidenceB);
  records = appendResearchMemoryRelationEvent(records, relation(evidenceA.artifact, lessonArtifact));
  records = appendResearchMemoryRelationEvent(records, relation(evidenceB.artifact, lessonArtifact));
  assert.throws(
    () => appendResearchMemorySemanticEvent(records, lesson),
    /repeated independent canonical evidence/
  );
});

test("conflicting evidence adds revalidation state without rewriting prior history", () => {
  const original = evidence({
    artifact: artifact("decision-revalidate", "7".repeat(64))
  });
  const contradictory = evidence({
    artifact: artifact("contradicting-run", "8".repeat(64), "EVALUATION_LEDGER_RECORD"),
    semanticIdentity: "krw-btc:1d:new-window",
    independenceGroupId: "search-new"
  });
  let records = appendResearchMemorySemanticEvent([], original);
  records = appendResearchMemorySemanticEvent(records, contradictory);
  records = appendResearchMemoryRelationEvent(records, relation(
    contradictory.artifact,
    original.artifact,
    { relationType: "CONTRADICTS" }
  ));
  records = appendResearchMemorySemanticEvent(records, {
    ...original,
    validity: "REVALIDATION_REQUIRED",
    reason: "new independent evidence contradicts the current conclusion",
    occurredAt: "2026-09-19T02:00:00.000Z"
  });
  const semantic = records.filter((event) => event.eventKind === "SEMANTIC");
  assert.equal(semantic.some((event) => event.validity === "CURRENT"), true);
  assert.equal(semantic.some((event) => event.validity === "REVALIDATION_REQUIRED"), true);
  assert.equal(records.some((event) => event.eventKind === "RELATION" && event.relationType === "CONTRADICTS"), true);
});

test("relations are append-only, idempotent, and self-influence is forbidden", () => {
  const source = artifact("source", "9".repeat(64));
  const target = artifact("target", "a".repeat(64));
  const once = appendResearchMemoryRelationEvent([], relation(source, target));
  const twice = appendResearchMemoryRelationEvent(once, relation(source, target));
  assert.equal(twice, once);
  assert.throws(
    () => appendResearchMemoryRelationEvent([], relation(source, source)),
    /self-influence relation is forbidden/
  );
});

test("REJECTED and RETIRED remain queryable historical classes", () => {
  let records = appendResearchMemorySemanticEvent([], evidence({
    artifact: artifact("rejected", "b".repeat(64)),
    semanticClass: "REJECTED",
    semanticIdentity: "candidate:rejected"
  }));
  records = appendResearchMemorySemanticEvent(records, evidence({
    artifact: artifact("retired", "c".repeat(64)),
    semanticClass: "RETIRED",
    semanticIdentity: "strategy:retired",
    occurredAt: "2026-09-19T00:02:00.000Z"
  }));
  assert.deepEqual(
    records.filter((event) => event.eventKind === "SEMANTIC").map((event) => event.semanticClass),
    ["REJECTED", "RETIRED"]
  );
});

test("SQLite owner preserves 021/022 semantic rows through later migrations and survives restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-memory-"));
  const file = path.join(dir, "memory.sqlite");
  try {
    let db = new SqliteDatabase(file);
    assert.equal(db.migrationResult.currentVersion, "024_research_intelligence_memory");
    const migrations = db.connection.prepare(
      "SELECT id FROM schema_migrations WHERE id IN (?, ?) ORDER BY id ASC"
    ).all("021_research_factory_decision_history", "022_research_memory_semantic_overlay");
    assert.deepEqual(migrations.map((row) => row.id), [
      "021_research_factory_decision_history",
      "022_research_memory_semantic_overlay"
    ]);

    db.connection.prepare(
      "INSERT INTO research_hypotheses (id, title, statement, status, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("legacy-h", "legacy", "preserve me", "DRAFT", "2026-09-19T00:00:00.000Z");

    const repo = new SqliteResearchSemanticMemoryRepository(db);
    const appended = repo.appendSemantic(evidence());
    assert.equal(appended.eventKind, "SEMANTIC");
    assert.equal(
      db.connection.prepare("SELECT COUNT(*) AS count FROM research_hypotheses WHERE id = ?").get("legacy-h").count,
      1
    );
    db.close();

    db = new SqliteDatabase(file);
    const restarted = new SqliteResearchSemanticMemoryRepository(db);
    assert.equal(restarted.listSemantic().length, 1);
    assert.equal(restarted.appendSemantic(evidence()).identity, appended.identity);
    assert.equal(restarted.listSemantic().length, 1);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("persisted overlay corruption fails closed", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repo = new SqliteResearchSemanticMemoryRepository(db);
    const event = repo.appendSemantic(evidence());
    db.connection.prepare(
      "UPDATE research_memory_semantic_events SET event_json = ? WHERE identity = ?"
    ).run(JSON.stringify({ ...event, reason: "rewritten after persistence" }), event.identity);
    assert.throws(
      () => repo.list(),
      /integrity violation/
    );
  } finally {
    db.close();
  }
});

test("legacy cloud EVIDENCE is projection-only and never bulk-upgraded to CURRENT", () => {
  const record = createResearchMemoryRecord({
    recordId: "review-1",
    researchId: "research-1",
    stage: "EVIDENCE",
    createdAt: "2026-09-19T00:00:00.000Z",
    author: "ai-zero-authority",
    summary: "critic output",
    payload: Object.freeze({ criticSeverity: "high" }),
    evidenceDirection: "REJECTS"
  });
  assert.deepEqual(projectLegacyResearchMemoryRecordSemantics(record), {
    semanticClass: "EVIDENCE",
    validity: "REVALIDATION_REQUIRED",
    evidenceOrigin: "AI_ADVISORY",
    attribution: "MIXED_UNRESOLVED"
  });
  assert.throws(
    () => projectResearchMemorySemanticInput(record, {
      evaluatorSemanticsId: "review-v1",
      semanticIdentity: "review:1",
      independenceGroupId: "same-underlying-result",
      validity: "CURRENT",
      attribution: "MIXED_UNRESOLVED",
      evidenceOrigin: "AI_ADVISORY",
      source: "ai-review",
      reason: "must remain advisory"
    }),
    /CURRENT EVIDENCE requires canonical empirical origin/
  );
});

test("legacy artifact digest v1 is exact-content provenance, not semantic identity", () => {
  const first = researchMemoryArtifactDigestV1({
    id: "legacy",
    payloadJson: "{\"a\":1}",
    createdAt: "t1"
  });
  const second = researchMemoryArtifactDigestV1({
    id: "legacy",
    payloadJson: "{\"a\":1}",
    createdAt: "t2"
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

const protectedExposure = (overrides = {}) => Object.freeze({
  hypothesisId: "hypothesis-parent",
  familyId: "family-a",
  searchId: "search-a",
  trialId: "trial-1",
  candidateIds: Object.freeze(["candidate-a"]),
  datasetId: "dataset-a",
  datasetContentSha256: "d".repeat(64),
  oosReuseFingerprint: "e".repeat(64),
  purpose: "CONFIRMATORY",
  precommittedAt: "2026-09-18T23:00:00.000Z",
  exposedAt: "2026-09-19T00:00:00.000Z",
  ...overrides
});

test("protected OOS exact replay is idempotent and not a fresh exposure", () => {
  const input = evidence({
    artifact: artifact("oos-eval-1", "f".repeat(64), "EVALUATION_LEDGER_RECORD"),
    attribution: "MULTIPLE_TESTING",
    protectedOosExposure: protectedExposure()
  });
  const once = appendResearchMemorySemanticEvent([], input);
  const twice = appendResearchMemorySemanticEvent(once, input);
  assert.equal(twice, once);
  assert.deepEqual(assessResearchProtectedOosEligibility(once, {
    hypothesisId: "hypothesis-parent",
    lineageHypothesisIds: Object.freeze(["hypothesis-parent"]),
    familyId: "family-a", searchId: "search-a", trialId: "trial-1", datasetId: "dataset-a",
    datasetContentSha256: "d".repeat(64), oosReuseFingerprint: "e".repeat(64), purpose: "CONFIRMATORY"
  }), { status: "REPLAY", reason: "EXACT_EXPOSURE_REPLAY", priorExposureCount: 1 });
});

test("descendant hypothesis cannot regain clean confirmatory eligibility on an exposed lockbox", () => {
  const records = appendResearchMemorySemanticEvent([], evidence({
    artifact: artifact("oos-parent", "1".repeat(64), "EVALUATION_LEDGER_RECORD"),
    attribution: "MULTIPLE_TESTING", protectedOosExposure: protectedExposure()
  }));
  assert.deepEqual(assessResearchProtectedOosEligibility(records, {
    hypothesisId: "hypothesis-child",
    lineageHypothesisIds: Object.freeze(["hypothesis-child", "hypothesis-parent"]),
    familyId: "family-a", searchId: "search-a", trialId: "trial-2", datasetId: "dataset-a",
    datasetContentSha256: "d".repeat(64), oosReuseFingerprint: "e".repeat(64), purpose: "CONFIRMATORY"
  }), { status: "HOLD", reason: "PROTECTED_OOS_ALREADY_EXPOSED", priorExposureCount: 1 });
});

test("an independently precommitted lockbox can remain confirmatory eligible", () => {
  const records = appendResearchMemorySemanticEvent([], evidence({
    artifact: artifact("oos-old", "2".repeat(64), "EVALUATION_LEDGER_RECORD"),
    attribution: "MULTIPLE_TESTING", protectedOosExposure: protectedExposure()
  }));
  assert.deepEqual(assessResearchProtectedOosEligibility(records, {
    hypothesisId: "hypothesis-child",
    lineageHypothesisIds: Object.freeze(["hypothesis-child", "hypothesis-parent"]),
    familyId: "family-a", searchId: "search-a", trialId: "trial-2", datasetId: "dataset-b",
    datasetContentSha256: "3".repeat(64), oosReuseFingerprint: "4".repeat(64), purpose: "CONFIRMATORY"
  }), { status: "ELIGIBLE", reason: "NEW_INDEPENDENT_LOCKBOX", priorExposureCount: 0 });
});

test("protected OOS exposure metadata fails closed unless it is canonical Research evidence", () => {
  assert.throws(() => appendResearchMemorySemanticEvent([], evidence({
    semanticClass: "HYPOTHESIS", evidenceOrigin: "HYPOTHESIS_PRIOR", protectedOosExposure: protectedExposure()
  })), /protected OOS exposure requires canonical Research EVIDENCE/);
  assert.throws(() => appendResearchMemorySemanticEvent([], evidence({
    protectedOosExposure: protectedExposure({ exposedAt: "2026-09-18T22:00:00.000Z" })
  })), /cannot precede precommit/);
});