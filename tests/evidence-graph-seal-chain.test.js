const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  sealEvidenceGraph, verifyEvidenceGraphSeal, verifySealChainIntegrity,
  SealChainIntegrityDecision, GENESIS_SEAL_HASH,
  InMemoryEvidenceGraphSealRepository
} = require('../dist/apps/execution/src/index.js');
const storage = require("../dist/packages/storage/src/index.js");
const sealStorage = require("../dist/packages/storage/src/evidence-graph-seal.js");

const nodesA = [
  { evidenceId: "freeze", kind: "FREEZE", candidateId: "rc-1" },
  { evidenceId: "promotion", kind: "PROMOTION", candidateId: "rc-1" }
];
const edgesA = [{ fromEvidenceId: "freeze", toEvidenceId: "promotion", relation: "ENABLES" }];

test("first seal in a chain links to GENESIS and later seals link to the prior chainHash", () => {
  const seal1 = sealEvidenceGraph({ sealId: "s1", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 1 });
  assert.equal(seal1.previousSealHash, GENESIS_SEAL_HASH);
  const seal2 = sealEvidenceGraph({ sealId: "s2", candidateId: "rc-1", nodes: nodesA, edges: edgesA, previousSealHash: seal1.chainHash, nowMs: 2 });
  assert.equal(seal2.previousSealHash, seal1.chainHash);
  assert.notEqual(seal1.chainHash, seal2.chainHash);
});

test("verifyEvidenceGraphSeal now also checks chain hash, not just graph hash", () => {
  const seal = sealEvidenceGraph({ sealId: "s1", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 1 });
  assert.equal(verifyEvidenceGraphSeal({ seal, nodes: nodesA, edges: edgesA }), true);
  const tampered = { ...seal, chainHash: "0".repeat(64) };
  assert.equal(verifyEvidenceGraphSeal({ seal: tampered, nodes: nodesA, edges: edgesA }), false);
});

test("verifySealChainIntegrity detects an intact chain and a broken one", () => {
  const seal1 = sealEvidenceGraph({ sealId: "s1", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 1 });
  const seal2 = sealEvidenceGraph({ sealId: "s2", candidateId: "rc-1", nodes: nodesA, edges: edgesA, previousSealHash: seal1.chainHash, nowMs: 2 });
  const intact = verifySealChainIntegrity([seal1, seal2]);
  assert.equal(intact.decision, SealChainIntegrityDecision.INTACT);

  const rewrittenSeal1 = { ...seal1, graphHash: "tampered-hash" };
  const broken = verifySealChainIntegrity([rewrittenSeal1, seal2]);
  assert.equal(broken.decision, SealChainIntegrityDecision.BROKEN);
  assert.equal(broken.brokenAtSealId, "s1");
});

test("in-memory seal repository is append-only and enforces chain linkage", () => {
  const repo = new InMemoryEvidenceGraphSealRepository();
  const seal1 = sealEvidenceGraph({ sealId: "s1", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 1 });
  repo.appendSeal(seal1);
  assert.throws(() => repo.appendSeal(seal1));

  const disconnected = sealEvidenceGraph({ sealId: "s2", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 2 });
  assert.throws(() => repo.appendSeal(disconnected));

  const seal2 = sealEvidenceGraph({ sealId: "s3", candidateId: "rc-1", nodes: nodesA, edges: edgesA, previousSealHash: seal1.chainHash, nowMs: 3 });
  repo.appendSeal(seal2);
  assert.deepEqual(repo.listChain().map(s => s.sealId), ["s1", "s3"]);
  assert.equal(repo.getLatestSeal().sealId, "s3");
});

test("sqlite seal repository persists the chain and rejects tampering-equivalent inserts", () => {
  const db = new storage.SqliteDatabase(":memory:");
  const repo = new sealStorage.SqliteEvidenceGraphSealRepository(db);
  const seal1 = sealEvidenceGraph({ sealId: "s1", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 1 });
  repo.appendSeal(seal1);
  const seal2 = sealEvidenceGraph({ sealId: "s2", candidateId: "rc-1", nodes: nodesA, edges: edgesA, previousSealHash: seal1.chainHash, nowMs: 2 });
  repo.appendSeal(seal2);

  assert.deepEqual(repo.listChain().map(s => s.sealId), ["s1", "s2"]);
  assert.equal(repo.getLatestSeal().sealId, "s2");
  assert.equal(verifySealChainIntegrity(repo.listChain()).decision, SealChainIntegrityDecision.INTACT);

  // a seal that does not chain to the current head is rejected before it ever reaches SQL
  const disconnected = sealEvidenceGraph({ sealId: "s3", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 3 });
  assert.throws(() => repo.appendSeal(disconnected));

  // re-inserting seal1's sealId is rejected by the UNIQUE constraint even if bypassing the JS guard
  assert.throws(() => db.connection.prepare(
    "INSERT INTO evidence_graph_seals (seal_id, candidate_id, graph_hash, previous_seal_hash, chain_hash, node_count, edge_count, sealed_at_ms, deployment_allowed, production_mutation_allowed) VALUES (?,?,?,?,?,?,?,?,0,0)"
  ).run("s1", "rc-1", "x", "y", "z", 1, 1, 4));

  db.close();
});


test("legacy graph without provenance preserves the v1 canonical fingerprint", () => {
  const seal = sealEvidenceGraph({ sealId: "legacy", candidateId: "rc-1", nodes: nodesA, edges: edgesA, nowMs: 1 });
  const canonical = JSON.stringify({
    nodes: [
      { evidenceId: "freeze", kind: "FREEZE", candidateId: "rc-1" },
      { evidenceId: "promotion", kind: "PROMOTION", candidateId: "rc-1" }
    ],
    edges: [{ fromEvidenceId: "freeze", toEvidenceId: "promotion", relation: "ENABLES" }]
  });
  assert.equal(seal.graphHash, createHash("sha256").update(canonical).digest("hex"));
});

test("external claims cannot be VERIFIED without linked verifier evidence", () => {
  const nodes = [
    { evidenceId: "vendor-claim", kind: "EXTERNAL_CLAIM", candidateId: "rc-1", provenance: {
      sourceType: "EXTERNAL", verificationState: "VERIFIED", sourceRef: "https://example.test/claim",
      sourceFingerprint: "a".repeat(64), observedAtMs: 1, verifierEvidenceId: "review-1"
    }},
    { evidenceId: "review-1", kind: "INDEPENDENT_REVIEW", candidateId: "rc-1" }
  ];
  assert.throws(() => sealEvidenceGraph({ sealId: "missing-verifier-edge", candidateId: "rc-1", nodes, edges: [], nowMs: 2 }), /INDEPENDENTLY_VERIFIES/);
  const seal = sealEvidenceGraph({
    sealId: "verified-external-claim", candidateId: "rc-1", nodes,
    edges: [{ fromEvidenceId: "review-1", toEvidenceId: "vendor-claim", relation: "INDEPENDENTLY_VERIFIES" }],
    nowMs: 2
  });
  assert.equal(verifyEvidenceGraphSeal({ seal, nodes, edges: [{ fromEvidenceId: "review-1", toEvidenceId: "vendor-claim", relation: "INDEPENDENTLY_VERIFIES" }] }), true);
});

test("expired provenance must be explicitly stale and model claims require source references", () => {
  const expired = [{ evidenceId: "e1", kind: "OBSERVATION", candidateId: "rc-1", provenance: {
    sourceType: "CANONICAL", verificationState: "VERIFIED", observedAtMs: 1, validUntilMs: 2, verifierEvidenceId: "review"
  }}, { evidenceId: "review", kind: "REVIEW", candidateId: "rc-1" }];
  const edge = [{ fromEvidenceId: "review", toEvidenceId: "e1", relation: "INDEPENDENTLY_VERIFIES" }];
  assert.throws(() => sealEvidenceGraph({ sealId: "expired-current", candidateId: "rc-1", nodes: expired, edges: edge, nowMs: 2 }), /marked STALE/);
  const stale = expired.map(n => n.evidenceId === "e1" ? { ...n, provenance: { ...n.provenance, verificationState: "STALE" } } : n);
  assert.doesNotThrow(() => sealEvidenceGraph({ sealId: "expired-stale", candidateId: "rc-1", nodes: stale, edges: edge, nowMs: 2 }));
  assert.throws(() => sealEvidenceGraph({
    sealId: "model-without-source", candidateId: "rc-1",
    nodes: [{ evidenceId: "model", kind: "MODEL_CLAIM", candidateId: "rc-1", provenance: { sourceType: "MODEL_GENERATED", verificationState: "UNVERIFIED" } }],
    edges: [], nowMs: 1
  }), /require source provenance/);
});

test("provenance changes alter the sealed graph fingerprint", () => {
  const base = [{ evidenceId: "e1", kind: "EXTERNAL_CLAIM", candidateId: "rc-1", provenance: {
    sourceType: "EXTERNAL", verificationState: "UNVERIFIED", sourceRef: "https://example.test/a"
  }}];
  const changed = [{ ...base[0], provenance: { ...base[0].provenance, sourceRef: "https://example.test/b" } }];
  const a = sealEvidenceGraph({ sealId: "a", candidateId: "rc-1", nodes: base, edges: [], nowMs: 1 });
  const b = sealEvidenceGraph({ sealId: "b", candidateId: "rc-1", nodes: changed, edges: [], nowMs: 1 });
  assert.notEqual(a.graphHash, b.graphHash);
});


test("future-dated source observations fail closed", () => {
  assert.throws(() => sealEvidenceGraph({
    sealId: "future-observation", candidateId: "rc-1",
    nodes: [{ evidenceId: "e1", kind: "OBSERVATION", candidateId: "rc-1", provenance: {
      sourceType: "CANONICAL", verificationState: "UNVERIFIED", observedAtMs: 11
    }}],
    edges: [], nowMs: 10
  }), /cannot be in the future/);
});
