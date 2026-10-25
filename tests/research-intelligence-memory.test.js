const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createResearchIntelligenceRecord,
} = require("../dist/packages/contracts/src/researchIntelligence.js");
const {
  fetchResearchIntelligenceSourceCapture,
  issueResearchIntelligenceSourceVerificationReceipt,
} = require("../dist/packages/contracts/src/researchIntelligenceVerificationInternal.js");
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
const {
  createCryptoNewsResearchObservation,
} = require("../dist/packages/contracts/src/researchExternalIntake.js");

const rawContent = "<entry><id>http://arxiv.org/abs/2603.29086v1</id><summary>Canonical test source capture: market microstructure and algorithmic trading.</summary></entry>";
let sourceCapture;
test.before(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<feed>${rawContent}</feed>`, {
    headers: { "content-type": "application/atom+xml" },
  });
  try {
    sourceCapture = await fetchResearchIntelligenceSourceCapture(
      "https://export.arxiv.org/api/query?id_list=2603.29086",
      "ARXIV_API_V1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function record(discoveredAt) {
  const unverified = createResearchIntelligenceRecord({
    sourceId: "arxiv:2603.29086",
    sourceType: "ARXIV",
    sourceUrl: "https://arxiv.org/abs/2603.29086",
    sourceVerification: "UNVERIFIED",
    title: "Market microstructure and algorithmic trading test",
    authors: ["NUSA Test"],
    publishedAt: "2026-03-31T00:00:00.000Z",
    discoveredAt,
    rawContentSha256: require("node:crypto").createHash("sha256").update(rawContent).digest("hex"),
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
    validationStatus: "DISCOVERED",
  });
  return issueResearchIntelligenceSourceVerificationReceipt(unverified, sourceCapture, rawContent, discoveredAt);
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
      () => memory.append(record("2026-09-20T05:00:00.000Z")),
      /identity conflict/,
    );
  } finally {
    db.close();
  }
});

test("SQLite source trust rejects caller taxonomy claims and rehydrates only canonical receipts", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const authenticated = record("2026-09-20T04:00:00.000Z");
    const { issueResearchIntelligenceSourceVerificationReceipt } = require("../dist/packages/contracts/src/researchIntelligenceVerificationInternal.js");
    const unverified = createResearchIntelligenceRecord({
      sourceId: authenticated.sourceId, sourceType: authenticated.sourceType, sourceUrl: authenticated.sourceUrl,
      sourceVerification: "UNVERIFIED", title: authenticated.title, authors: authenticated.authors,
      publishedAt: authenticated.publishedAt, discoveredAt: authenticated.discoveredAt,
      rawContentSha256: authenticated.rawContentSha256, topic: authenticated.topic, market: authenticated.market,
      timeframe: authenticated.timeframe, method: authenticated.method,
      claimedContribution: authenticated.claimedContribution, testableHypothesis: authenticated.testableHypothesis,
      assumptions: authenticated.assumptions, requiredData: authenticated.requiredData,
    });
    assert.throws(() => issueResearchIntelligenceSourceVerificationReceipt(
      unverified,
      { ...sourceCapture },
      rawContent,
      unverified.discoveredAt,
    ), /CAPTURE_INVALID/, "a caller-copy of the receipt material is not an authenticated capture capability");
    const callerClaim = Object.freeze({
      ...authenticated,
      sourceVerificationReceipt: undefined,
      sourceVerification: "VERIFIED_PRIMARY_SOURCE",
      validationStatus: "SOURCE_VERIFIED",
    });
    assert.throws(() => memory.append(callerClaim), /not authenticated/);

    memory.append(authenticated);
    assert.equal(memory.get(authenticated.recordId).sourceVerificationReceipt.receiptFingerprint,
      authenticated.sourceVerificationReceipt.receiptFingerprint);
    assert.equal(memory.list().length, 1);
  } finally {
    db.close();
  }
});


test("persisted payload tampering fails closed against semantic provenance", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const original = record("2026-09-20T04:00:00.000Z");
    memory.append(original);

    db.connection.prepare(
      "UPDATE research_intelligence_records SET payload_json = ? WHERE record_id = ?",
    ).run(
      JSON.stringify({ ...original, claimedContribution: "tampered after persistence" }),
      original.recordId,
    );

    assert.throws(
      () => memory.list(),
      /semantic provenance mismatch/,
    );
  } finally {
    db.close();
  }
});

test("only the canonical persisted Research Intelligence repository can bind news PIT evidence and create its precommit", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const snapshot = rawContent;
    const fingerprint = require("node:crypto").createHash("sha256").update(snapshot).digest("hex");
    const observation = createCryptoNewsResearchObservation({
      sourceUrl: "https://arxiv.org/abs/2603.29086",
      publisher: "arXiv",
      publishedAt: "2026-03-31T00:00:00.000Z",
      retrievedAt: "2026-10-25T00:00:00Z",
      firstObservedAt: "2026-10-24T01:00:00Z",
      contentSnapshot: snapshot,
      contentFingerprint: fingerprint,
      sourceType: "NEWS",
      eventType: "REGULATION",
      entities: ["SEC"],
      assets: ["BTC"],
      confidence: "MEDIUM",
      observedFacts: ["filing published"],
      publisherClaims: ["impact is bullish"],
      scoutInferences: ["test whether volatility changes"],
    });
    const sourceRecord = record(observation.firstObservedAt);
    const unverifiedSourceRecord = createResearchIntelligenceRecord({
      sourceId: sourceRecord.sourceId, sourceType: sourceRecord.sourceType, sourceUrl: sourceRecord.sourceUrl,
      sourceVerification: "UNVERIFIED", title: sourceRecord.title, authors: sourceRecord.authors,
      publishedAt: sourceRecord.publishedAt, discoveredAt: sourceRecord.discoveredAt,
      rawContentSha256: sourceRecord.rawContentSha256, topic: sourceRecord.topic, market: sourceRecord.market,
      timeframe: sourceRecord.timeframe, method: sourceRecord.method,
      claimedContribution: sourceRecord.claimedContribution, testableHypothesis: sourceRecord.testableHypothesis,
      assumptions: sourceRecord.assumptions, requiredData: sourceRecord.requiredData,
    });

    assert.equal(memory.get(sourceRecord.recordId), null);
    const forgedRecord = Object.freeze({
      ...unverifiedSourceRecord,
      sourceVerification: "VERIFIED_PRIMARY_SOURCE",
      validationStatus: "SOURCE_VERIFIED",
    });
    assert.throws(() => memory.append(forgedRecord), /not authenticated/);
    assert.throws(
      () => memory.bindCryptoNewsResearchIntelligence(observation, unverifiedSourceRecord.recordId, {
        get: () => sourceRecord,
      }),
      /BINDING_INVALID/,
      "an unpersisted caller-created trust claim and caller-supplied reader must not qualify as source evidence",
    );

    memory.append(sourceRecord);
    assert.equal(memory.get(sourceRecord.recordId).recordId, sourceRecord.recordId);
    const bound = memory.bindCryptoNewsResearchIntelligence(observation, sourceRecord.recordId);
    assert.equal(bound.coverageStatus, "PIT_ELIGIBLE");
    assert.equal(bound.researchIntelligenceRecordId, sourceRecord.recordId);

    const input = {
      family: "VOLATILITY",
      rationale: "Test measured volatility after official filings",
      mechanism: "Information arrival may change uncertainty",
      targetMarket: "KRW-BTC",
      expectedRegime: "high information arrival",
      invalidationCondition: "No out-of-sample volatility response",
      holdingPeriodMs: 3_600_000,
      capacityAssumptions: { maxNotional: 1_000_000, maxParticipationRate: 0.01 },
      transactionCostSensitivity: 0.8,
      createdAt: "2026-10-25T02:00:00Z",
      datasetBinding: { manifest: "manifest-v1" },
      evaluationPlan: {
        pitWindow: { startAt: "2026-01-01T00:00:00Z", endAt: "2026-06-01T00:00:00Z" },
        oosWindow: { startAt: "2026-06-02T00:00:00Z", endAt: "2026-07-01T00:00:00Z" },
        latencyAssumptions: "next-bar execution with 250ms modeled delay",
        missingDataPolicy: "reject incomplete windows",
      },
      costPlan: { feeModelVersion: "fee-v1", slippageModelVersion: "slippage-v1" },
      sourceSha: "b".repeat(40),
      validationPolicyIdentity: "policy-v1",
    };
    const result = memory.cryptoNewsResearchPrecommit(observation, sourceRecord.recordId, input);
    assert.equal(result.classification, "RESEARCH_HYPOTHESIS_CANDIDATE");
    assert.equal(result.precommit.candidateIdentity, result.hypothesis.candidateId);
    assert.equal(result.precommit.datasetBinding.newsObservationIdentity, bound.observationIdentity);
    assert.equal(result.precommit.parameterPlan.hypothesis.provenance.author, "SCOUT_ADVISORY");
    assert.throws(() => memory.cryptoNewsResearchPrecommit(observation, sourceRecord.recordId, { ...input, validationPolicyIdentity: "UNKNOWN" }), /HYPOTHESIS_EVIDENCE_INELIGIBLE/);
    assert.throws(() => memory.cryptoNewsResearchPrecommit(observation, sourceRecord.recordId, { ...input, datasetBinding: { manifest: "N/A" } }), /HYPOTHESIS_EVIDENCE_INELIGIBLE/);
    assert.throws(() => memory.cryptoNewsResearchPrecommit(observation, "ri:caller-invented", input), /BINDING_INVALID/);
    assert.throws(() => memory.cryptoNewsResearchPrecommit(createCryptoNewsResearchObservation({
      sourceUrl: observation.sourceUrl, publisher: "Publisher", publishedAt: observation.publishedAt,
      retrievedAt: observation.retrievedAt, firstObservedAt: observation.firstObservedAt,
      contentSnapshot: snapshot, contentFingerprint: fingerprint, sourceType: "RUMOR", eventType: "REGULATION",
      entities: ["SEC"], assets: ["BTC"], confidence: "MEDIUM", observedFacts: ["filing published"],
      publisherClaims: ["impact is bullish"], scoutInferences: ["test whether volatility changes"],
    }), sourceRecord.recordId, input), /BINDING_INVALID/);

    const contractIntake = require("../dist/packages/contracts/src/researchExternalIntake.js");
    assert.equal(contractIntake.bindCryptoNewsResearchIntelligence, undefined);
    assert.equal(contractIntake.cryptoNewsResearchPrecommit, undefined);
  } finally {
    db.close();
  }
});
