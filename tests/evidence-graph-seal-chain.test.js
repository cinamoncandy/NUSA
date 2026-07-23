const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sealEvidenceGraph, verifyEvidenceGraphSeal, verifySealChainIntegrity,
  SealChainIntegrityDecision, GENESIS_SEAL_HASH,
  InMemoryEvidenceGraphSealRepository
} = require("../apps/execution/src/index");
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
