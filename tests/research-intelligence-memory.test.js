const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createResearchIntelligenceRecord,
  researchIntelligenceHypothesisSemanticFingerprint,
} = require("../dist/packages/contracts/src/researchIntelligence.js");
const {
  fetchResearchIntelligenceSourceCapture,
  deriveCanonicalArxivInterpretation,
  issueResearchIntelligenceSourceVerificationReceipt,
  carryResearchIntelligenceSourceAuthentication,
  isResearchIntelligenceSourceRecordAuthenticated,
  verifyPersistedResearchIntelligenceSourceReceipt,
  validatePersistedResearchIntelligenceSourceReceiptIntegrity,
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
const { canonicalResearchJson } = require("../dist/packages/contracts/src/researchRuntime.js");

const rawContent = "<entry><id>http://arxiv.org/abs/2603.29086v1</id><published>2026-03-30T17:55:21Z</published><title>Canonical market microstructure test source</title><summary>Canonical test source capture: market microstructure and algorithmic trading.</summary><author><name>NUSA Test</name></author></entry>";
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

function unverifiedRecord(discoveredAt = sourceCapture.capturedAt, patch = {}) {
  const interpretation = deriveCanonicalArxivInterpretation(
    "Canonical market microstructure test source",
    "Canonical test source capture: market microstructure and algorithmic trading.",
  );
  return createResearchIntelligenceRecord({
    sourceId: "arxiv:2603.29086",
    sourceType: "ARXIV",
    sourceUrl: "https://arxiv.org/abs/2603.29086",
    sourceVerification: "UNVERIFIED",
    title: "Canonical market microstructure test source",
    authors: ["NUSA Test"],
    publishedAt: "2026-03-30T17:55:21.000Z",
    discoveredAt,
    rawContentSha256: require("node:crypto").createHash("sha256").update(rawContent).digest("hex"),
    ...interpretation,
    claimedContribution: "Canonical test source capture: market microstructure and algorithmic trading.",
    validationStatus: "DISCOVERED",
    ...patch,
  });
}

function record(patch = {}) {
  const unverified = unverifiedRecord(sourceCapture.capturedAt, patch);
  return issueResearchIntelligenceSourceVerificationReceipt(unverified, sourceCapture, rawContent);
}

test("canonical semantic memory suppresses the same research across scout runs", async () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const firstCollector = {
      sourceId: "arxiv",
      collect: async () => Object.freeze([record()]),
    };
    const first = await new ResearchIntelligenceScout([firstCollector], memory).run();

    assert.equal(first.accepted, 1);
    assert.equal(first.duplicatesSuppressed, 0);
    assert.equal(first.axiomHandoffs.length, 1);
    assert.equal(memory.list().length, 1);

    const secondCollector = {
      sourceId: "arxiv",
      collect: async () => Object.freeze([record()]),
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
    const original = record();
    memory.append(original);

    const alteredInterpretation = unverifiedRecord(sourceCapture.capturedAt, {
      testableHypothesis: "A different research interpretation of the same source.",
    });
    assert.throws(
      () => issueResearchIntelligenceSourceVerificationReceipt(alteredInterpretation, sourceCapture, rawContent),
      /RECORD_MISMATCH/,
    );
  } finally {
    db.close();
  }
});

test("SQLite source trust rejects caller claims and requires fresh capture after repository restart", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const authenticated = record();
    const callerManufacturedCopy = Object.freeze({ ...authenticated });
    assert.equal(verifyPersistedResearchIntelligenceSourceReceipt(callerManufacturedCopy), false,
      "a caller-provided copy with a plausible unkeyed receipt must not authenticate");
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

    const restartedMemory = new SqliteResearchIntelligenceMemoryRepository(db);
    const rehydrated = restartedMemory.get(authenticated.recordId);
    assert.equal(verifyPersistedResearchIntelligenceSourceReceipt(rehydrated), false,
      "a self-hashed durable receipt is not an authenticated issuer after restart");
    assert.equal(rehydrated.sourceVerification, "UNVERIFIED");
    assert.equal(rehydrated.validationStatus, "DISCOVERED");
    assert.equal(rehydrated.sourceVerificationReceipt, undefined);
    const observation = createCryptoNewsResearchObservation({
      sourceUrl: authenticated.sourceUrl, publisher: "arXiv",
      publishedAt: authenticated.publishedAt, retrievedAt: authenticated.discoveredAt,
      firstObservedAt: authenticated.discoveredAt, contentSnapshot: rawContent,
      contentFingerprint: authenticated.rawContentSha256, sourceType: "NEWS", eventType: "REGULATION",
      entities: ["SEC"], assets: ["BTC"], confidence: "MEDIUM", observedFacts: ["filing published"],
      publisherClaims: ["impact is bullish"], scoutInferences: ["test whether volatility changes"],
    });
    assert.throws(() => restartedMemory.bindCryptoNewsResearchIntelligence(observation, authenticated.recordId),
      /NEWS_RESEARCH_INTELLIGENCE_BINDING_INVALID/);

    const recaptured = record();
    assert.equal(restartedMemory.append(recaptured).sourceVerification, "VERIFIED_PRIMARY_SOURCE");
    assert.equal(restartedMemory.list().length, 1, "fresh recapture restores process trust without duplicating history");
  } finally {
    db.close();
  }
});

test("fresh authenticated recapture preserves durable duplicate classification and lineage", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const authenticated = record();
    const duplicate = carryResearchIntelligenceSourceAuthentication(authenticated, Object.freeze({
      ...authenticated,
      novelty: "DUPLICATE",
      relatedExistingResearch: Object.freeze(["research-record:canonical-original"]),
      axiomHandoffStatus: "DUPLICATE_SUPPRESSED",
    }));
    assert.equal(isResearchIntelligenceSourceRecordAuthenticated(duplicate), true);
    memory.append(duplicate);

    // A later canonical source capture starts with the factory's default NEW metadata.
    const recaptured = record();
    assert.equal(recaptured.novelty, "NEW");
    const appended = memory.append(recaptured);
    assert.equal(appended.novelty, "DUPLICATE");
    assert.deepEqual(appended.relatedExistingResearch, ["research-record:canonical-original"]);
    assert.equal(appended.axiomHandoffStatus, "DUPLICATE_SUPPRESSED");

    const resolved = memory.get(authenticated.recordId);
    assert.equal(resolved.novelty, "DUPLICATE");
    assert.deepEqual(resolved.relatedExistingResearch, ["research-record:canonical-original"]);
    assert.equal(resolved.axiomHandoffStatus, "DUPLICATE_SUPPRESSED");
    assert.equal(isResearchIntelligenceSourceRecordAuthenticated(resolved), true,
      "fresh capture restores provenance authentication without replacing durable relation metadata");
    assert.throws(() => require("../dist/packages/contracts/src/researchIntelligence.js")
      .createAxiomResearchIntelligenceHandoff(resolved), /duplicate research/);
  } finally {
    db.close();
  }
});

test("source verifier rejects an arXiv ID substring and metadata not present in the complete entry", () => {
  const idOnly = "<id>http://arxiv.org/abs/2603.29086v1</id>";
  const substringRecord = unverifiedRecord(sourceCapture.capturedAt, {
    rawContentSha256: require("node:crypto").createHash("sha256").update(idOnly).digest("hex"),
    title: "Invented title",
    publishedAt: "2020-01-01T00:00:00.000Z",
    claimedContribution: "Invented publisher claim",
  });
  assert.throws(
    () => issueResearchIntelligenceSourceVerificationReceipt(substringRecord, sourceCapture, idOnly),
    /ENTRY_INVALID/,
  );

  const fabricatedMetadata = unverifiedRecord(sourceCapture.capturedAt, {
    title: "Invented title",
    publishedAt: "2020-01-01T00:00:00.000Z",
    claimedContribution: "Invented publisher claim",
  });
  assert.throws(
    () => issueResearchIntelligenceSourceVerificationReceipt(fabricatedMetadata, sourceCapture, rawContent),
    /RECORD_MISMATCH/,
  );

  const backdatedRecord = unverifiedRecord("2026-04-01T00:00:00.000Z");
  assert.throws(
    () => issueResearchIntelligenceSourceVerificationReceipt(backdatedRecord, sourceCapture, rawContent),
    /CAPTURE_INVALID/,
    "the caller cannot backdate a capture independently stamped by the canonical fetch",
  );
});

test("source authentication cannot be carried across changes to research interpretation fields", () => {
  const authenticated = record();
  const legitimateRelation = carryResearchIntelligenceSourceAuthentication(authenticated, Object.freeze({
    ...authenticated,
    novelty: "NEW",
    relatedExistingResearch: [],
    axiomHandoffStatus: "NOT_READY",
  }));
  assert.equal(isResearchIntelligenceSourceRecordAuthenticated(legitimateRelation), true);

  const forgedInterpretation = carryResearchIntelligenceSourceAuthentication(authenticated, Object.freeze({
    ...authenticated,
    testableHypothesis: "A caller-authored hypothesis that was not present in the source.",
    hypothesisSemanticFingerprint: researchIntelligenceHypothesisSemanticFingerprint({
      testableHypothesis: "A caller-authored hypothesis that was not present in the source.",
      market: authenticated.market,
      timeframe: authenticated.timeframe,
      method: authenticated.method,
    }),
    nusaRelevance: "HIGH",
    evidenceQuality: "CODE_AVAILABLE_UNVERIFIED",
    assumptions: ["Caller-selected assumption."],
    requiredData: ["Caller-selected data requirement."],
    novelty: "NEW",
    relatedExistingResearch: [],
    axiomHandoffStatus: "READY_FOR_AXIOM_REVIEW",
  }));
  assert.equal(isResearchIntelligenceSourceRecordAuthenticated(forgedInterpretation), false);
});

test("persisted source receipt revalidates its immutable publisher entry snapshot", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const authenticated = record();
    memory.append(authenticated);
    const stored = memory.get(authenticated.recordId);
    assert.equal(stored.sourceVerificationReceipt.schemaVersion, 2);
    assert.equal(stored.sourceVerificationReceipt.sourceEntrySnapshot, rawContent);

    const tamperedSnapshot = stored.sourceVerificationReceipt.sourceEntrySnapshot.replace("market microstructure", "invented market edge");
    const { receiptFingerprint: _oldFingerprint, ...receiptCore } = stored.sourceVerificationReceipt;
    const alteredCore = {
      ...receiptCore,
      sourceEntrySnapshot: tamperedSnapshot,
      sourceEntryFingerprint: require("node:crypto").createHash("sha256").update(tamperedSnapshot).digest("hex"),
    };
    const alteredReceipt = {
      ...alteredCore,
      receiptFingerprint: require("node:crypto").createHash("sha256").update(canonicalResearchJson(alteredCore)).digest("hex"),
    };
    db.connection.prepare("UPDATE research_intelligence_records SET payload_json = ? WHERE record_id = ?")
      .run(JSON.stringify({ ...stored, sourceVerificationReceipt: alteredReceipt }), stored.recordId);
    assert.throws(() => memory.get(stored.recordId), /source verification receipt is invalid/);
  } finally {
    db.close();
  }
});

test("legacy v1 source receipts remain readable as history but never restore trust", () => {
  const authenticated = record();
  const hash = (value) => require("node:crypto").createHash("sha256").update(value).digest("hex");
  const sourceEntryBindingFingerprint = hash(canonicalResearchJson({
    sourceId: authenticated.sourceId, sourceType: authenticated.sourceType, sourceUrl: authenticated.sourceUrl,
    title: authenticated.title, authors: authenticated.authors, publishedAt: authenticated.publishedAt,
    discoveredAt: authenticated.discoveredAt, rawContentSha256: authenticated.rawContentSha256.toLowerCase(),
    claimedContribution: authenticated.claimedContribution,
  }));
  const legacyCore = {
    schemaVersion: 1, verifierId: sourceCapture.verifierId, requestUrl: sourceCapture.requestUrl,
    responseUrl: sourceCapture.responseUrl, responseFingerprint: hash(sourceCapture.responseBody),
    rawContentSha256: authenticated.rawContentSha256.toLowerCase(), sourceEntryBindingFingerprint,
    capturedAt: authenticated.discoveredAt,
  };
  const legacy = Object.freeze({
    ...authenticated,
    sourceVerificationReceipt: Object.freeze({
      ...legacyCore, receiptFingerprint: hash(canonicalResearchJson(legacyCore)),
    }),
  });
  assert.equal(validatePersistedResearchIntelligenceSourceReceiptIntegrity(legacy), true);
  assert.equal(verifyPersistedResearchIntelligenceSourceReceipt(legacy), false);
});


test("persisted payload tampering fails closed against semantic provenance", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteResearchIntelligenceMemoryRepository(db);
    const original = record();
    memory.append(original);

    db.connection.prepare(
      "UPDATE research_intelligence_records SET payload_json = ? WHERE record_id = ?",
    ).run(
      JSON.stringify({ ...original, claimedContribution: "tampered after persistence" }),
      original.recordId,
    );

    assert.throws(
      () => memory.list(),
      /source verification receipt is invalid|semantic provenance mismatch/,
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
      publishedAt: "2026-03-30T17:55:21.000Z",
      retrievedAt: sourceCapture.capturedAt,
      firstObservedAt: sourceCapture.capturedAt,
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
    const sourceRecord = record();
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
      createdAt: sourceCapture.capturedAt,
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
