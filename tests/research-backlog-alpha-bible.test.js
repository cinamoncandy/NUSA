const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchBacklogItem, buildResearchBacklog } = require("../dist/apps/cloud/src/researchBacklog.js");
const { generateAlphaBible } = require("../dist/apps/cloud/src/alphaBibleGenerator.js");
const {
  createAlphaRecord,
  createEvidenceRecord,
  createAlphaEvidenceLink,
  buildAlphaEvidenceRegistry
} = require("../dist/apps/cloud/src/alphaEvidenceRegistry.js");

const queued = createResearchBacklogItem({
  researchId: "P001",
  title: "Funding carry replication",
  priority: "S",
  status: "QUEUED",
  owner: "research",
  question: "Does funding carry survive modeled costs?",
  hypothesis: "Positive extreme funding produces positive delta-neutral net carry.",
  linkedAlphaIds: ["A-001"],
  dependencyResearchIds: [],
  evidenceCount: 0,
  experimentCount: 0,
  createdAt: "2026-07-13T00:00:00.000Z",
  dueAt: "2026-08-01T00:00:00.000Z"
});
const running = createResearchBacklogItem({
  researchId: "P002",
  title: "Execution stress",
  priority: "A",
  status: "RUNNING",
  owner: "execution-research",
  question: "At what cost does carry disappear?",
  hypothesis: "The edge survives below a bounded cost threshold.",
  linkedAlphaIds: ["A-001"],
  dependencyResearchIds: ["P001"],
  evidenceCount: 1,
  experimentCount: 2,
  createdAt: "2026-07-13T00:10:00.000Z",
  dueAt: null
});

test("builds a deterministic ranked research backlog", () => {
  const first = buildResearchBacklog({ items: [running, queued], generatedAt: "2026-07-13T01:00:00.000Z" });
  const second = buildResearchBacklog({ items: [running, queued], generatedAt: "2026-07-13T01:00:00.000Z" });
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.deepEqual(first.rankedResearchIds, ["P001", "P002"]);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.items));
});

test("rejects missing and cyclic research dependencies", () => {
  assert.throws(() => buildResearchBacklog({ items: [running], generatedAt: "2026-07-13T01:00:00.000Z" }), /missing research dependency/);
  const { contentHash: _queuedHash, ...queuedFields } = queued;
  const a = createResearchBacklogItem({ ...queuedFields, researchId: "A", dependencyResearchIds: ["B"] });
  const b = createResearchBacklogItem({ ...queuedFields, researchId: "B", dependencyResearchIds: ["A"] });
  assert.throws(() => buildResearchBacklog({ items: [a, b], generatedAt: "2026-07-13T01:00:00.000Z" }), /cycle detected/);
});

test("rejects invalid backlog chronology", () => {
  assert.throws(() => createResearchBacklogItem({
    ...queued,
    researchId: "P003",
    createdAt: "2026-07-13T00:00:00.000Z",
    dueAt: "2026-07-12T00:00:00.000Z"
  }), /cannot precede/);
});

test("generates a deterministic Alpha Bible from the registry", () => {
  const alpha = createAlphaRecord({
    alphaId: "A-001",
    version: 1,
    name: "Funding Carry",
    category: "CARRY",
    status: "RESEARCH",
    owner: "research",
    markets: ["BTC"],
    horizon: "8H",
    capacityUsd: 1000000,
    halfLifeDays: 120,
    evidenceGrade: "B",
    riskClass: "MEDIUM",
    dependencyAlphaIds: [],
    createdAt: "2026-07-13T00:00:00.000Z",
    supersedesVersion: null
  });
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
  const registry = buildAlphaEvidenceRegistry({ alphas: [alpha], evidence: [evidence], links: [link], generatedAt: "2026-07-13T01:00:00.000Z" });
  const first = generateAlphaBible(registry, "2026-07-13T02:00:00.000Z");
  const second = generateAlphaBible(registry, "2026-07-13T02:00:00.000Z");
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.entries[0].supports, 1);
  assert.match(first.markdown, /Funding Carry/);
  assert.match(first.markdown, /Positive OOS carry/);
  assert.ok(Object.isFrozen(first.entries));
});

test("rejects Alpha Bible generation before registry time", () => {
  const registry = Object.freeze({ alphas: Object.freeze([]), evidence: Object.freeze([]), links: Object.freeze([]), generatedAt: "2026-07-13T01:00:00.000Z", snapshotHash: "a".repeat(64) });
  assert.throws(() => generateAlphaBible(registry, "2026-07-13T00:59:59.000Z"), /cannot be generated before/);
});
