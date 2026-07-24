const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAlphaRecord,
  createEvidenceRecord,
  createAlphaEvidenceLink,
  buildAlphaEvidenceRegistry
} = require("../dist/apps/cloud/src/alphaEvidenceRegistry.js");

const alphaInput = {
  alphaId: "A-001",
  version: 1,
  name: "Funding Carry",
  category: "CARRY",
  status: "RESEARCH",
  owner: "research",
  markets: ["BTC", "ETH"],
  horizon: "8H",
  capacityUsd: 1000000,
  halfLifeDays: null,
  evidenceGrade: "B",
  riskClass: "MEDIUM",
  dependencyAlphaIds: [],
  createdAt: "2026-07-13T00:00:00.000Z",
  supersedesVersion: null
};
const alpha = createAlphaRecord(alphaInput);

const evidence = createEvidenceRecord({
  evidenceId: "E-001",
  source: "research-memory",
  datasetSha256: "a".repeat(64),
  experimentId: "EXP-001",
  observedAt: "2026-07-13T00:10:00.000Z",
  confidence: 0.82,
  summary: "Positive OOS carry after modeled costs"
});

const link = createAlphaEvidenceLink({
  linkId: "L-001",
  alphaId: "A-001",
  alphaVersion: 1,
  evidenceId: "E-001",
  relation: "SUPPORTS",
  createdAt: "2026-07-13T00:20:00.000Z"
});

test("builds an immutable deterministic registry", () => {
  const first = buildAlphaEvidenceRegistry({ alphas: [alpha], evidence: [evidence], links: [link], generatedAt: "2026-07-13T01:00:00.000Z" });
  const second = buildAlphaEvidenceRegistry({ alphas: [alpha], evidence: [evidence], links: [link], generatedAt: "2026-07-13T01:00:00.000Z" });
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.alphas));
});

test("requires explicit version lineage", () => {
  const version2 = createAlphaRecord({
    ...alphaInput,
    version: 2,
    supersedesVersion: 1,
    status: "PAPER",
    createdAt: "2026-07-13T00:30:00.000Z"
  });
  const snapshot = buildAlphaEvidenceRegistry({ alphas: [alpha, version2], evidence: [evidence], links: [link], generatedAt: "2026-07-13T01:00:00.000Z" });
  assert.equal(snapshot.alphas.length, 2);
  assert.throws(() => buildAlphaEvidenceRegistry({ alphas: [version2], evidence: [], links: [], generatedAt: "2026-07-13T01:00:00.000Z" }), /missing superseded alpha/);
});

test("rejects dangling evidence links", () => {
  assert.throws(() => buildAlphaEvidenceRegistry({ alphas: [alpha], evidence: [], links: [link], generatedAt: "2026-07-13T01:00:00.000Z" }), /missing evidence/);
});

test("rejects duplicate identities and self dependencies", () => {
  assert.throws(() => buildAlphaEvidenceRegistry({ alphas: [alpha, alpha], evidence: [], links: [], generatedAt: "2026-07-13T01:00:00.000Z" }), /duplicate alpha/);
  assert.throws(() => createAlphaRecord({ ...alphaInput, dependencyAlphaIds: ["A-001"] }), /cannot depend on itself/);
});

test("rejects invalid evidence integrity fields", () => {
  assert.throws(() => createEvidenceRecord({
    evidenceId: "E-002",
    source: "research-memory",
    datasetSha256: "bad",
    experimentId: "EXP-002",
    observedAt: "2026-07-13T00:10:00.000Z",
    confidence: 0.82,
    summary: "bad"
  }), /SHA-256/);
  assert.throws(() => createEvidenceRecord({
    evidenceId: "E-003",
    source: "research-memory",
    datasetSha256: "b".repeat(64),
    experimentId: "EXP-003",
    observedAt: "2026-07-13T00:10:00.000Z",
    confidence: 2,
    summary: "bad"
  }), /between 0 and 1/);
});
