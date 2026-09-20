const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createResearchIntelligenceRecord,
} = require("../dist/packages/contracts/src/researchIntelligence.js");
const {
  ResearchIntelligenceScout,
} = require("../dist/apps/cloud/src/researchIntelligenceScout.js");
const {
  SqliteDatabase,
  SqliteResearchIntelligenceMemoryRepository,
} = require("../dist/packages/storage/src/index.js");
const {
  SqliteResearchSemanticMemoryRepository,
} = require("../dist/packages/storage/src/researchMemorySemantics.js");

function record(discoveredAt) {
  return createResearchIntelligenceRecord({
    sourceId: "arxiv:2603.29086",
    sourceType: "ARXIV",
    sourceUrl: "https://arxiv.org/abs/2603.29086",
    sourceVerification: "VERIFIED_PRIMARY_SOURCE",
    title: "Market microstructure and algorithmic trading test",
    authors: ["NUSA Test"],
    publishedAt: "2026-03-31T00:00:00.000Z",
    discoveredAt,
    rawContentSha256: "a".repeat(64),
    topic: ["market-microstructure"],
    market: "UNSPECIFIED",
    timeframe: "UNSPECIFIED",
    method: "order-book-modeling",
    claimedContribution: "A primary-source claim that requires independent canonical validation.",
    testableHypothesis:
      "Under canonical point-in-time cost-aware validation, the directional effect remains observable.",
    assumptions: ["External claims are not canonical NUSA evidence."],
    requiredData: ["Canonical point-in-time market data."],
    codeAvailable: "UNKNOWN",
    datasetAvailable: "UNKNOWN",
    reproducibilityStatus: "NOT_ATTEMPTED",
    evidenceQuality: "PRIMARY_SOURCE_CLAIM_ONLY",
    nusaRelevance: "HIGH",
    implementationCost: "UNKNOWN",
    expectedEconomicValue: "UNKNOWN",
    leakageRisk: "UNKNOWN",
    overfittingRisk: "UNKNOWN",
    regimeDependence: "UNKNOWN",
    transactionCostSensitivity: "UNKNOWN",
    validationStatus: "SOURCE_VERIFIED",
  });
}

test("canonical semantic memory suppresses the same research across scout runs", async () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const firstCollector = {
      sourceId: "arxiv",
      collect: async () => Object.freeze([record("2026-09-20T04:00:00.000Z")]),
    };
    const first = await new ResearchIntelligenceScout([firstCollector], memory).run();

    assert.equal(first.accepted, 1);
    assert.equal(first.duplicatesSuppressed, 0);
    assert.equal(first.axiomHandoffs.length, 1);
    assert.equal(memory.list().length, 1);

    const secondCollector = {
      sourceId: "arxiv",
      collect: async () => Object.freeze([record("2026-09-20T16:00:00.000Z")]),
    };
    const second = await new ResearchIntelligenceScout([secondCollector], memory).run();

    assert.equal(second.accepted, 0);
    assert.equal(second.duplicatesSuppressed, 1);
    assert.equal(second.axiomHandoffs.length, 0);
    assert.equal(memory.list().length, 1);

    const semantic = new SqliteResearchSemanticMemoryRepository(db).listSemantic();
    assert.equal(semantic.length, 1);
    assert.equal(semantic[0].artifact.artifactKind, "RESEARCH_INTELLIGENCE_RECORD");
    assert.equal(
      semantic[0].artifact.artifactDigestKind,
      "CANONICAL_RESEARCH_INTELLIGENCE_SHA256_V1",
    );
    assert.equal(semantic[0].semanticClass, "OBSERVATION");
    assert.equal(semantic[0].validity, "REVALIDATION_REQUIRED");
    assert.equal(semantic[0].evidenceOrigin, "EXTERNAL_PRIMARY_SOURCE");
    assert.equal(semantic[0].authority, "PAPER_ONLY");
    assert.equal(semantic[0].liveAuthority, "NONE");
    assert.equal(semantic[0].productionMutationAllowed, false);
    assert.equal(semantic[0].aiAuthority, "ZERO_AUTHORITY");
  } finally {
    db.close();
  }
});

test("research intelligence memory fails closed on record identity conflict", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const original = record("2026-09-20T04:00:00.000Z");
    memory.append(original);

    assert.throws(
      () => memory.append(Object.freeze({
        ...original,
        discoveredAt: "2026-09-20T05:00:00.000Z",
      })),
      /identity conflict/,
    );
  } finally {
    db.close();
  }
});
