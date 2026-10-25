import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { bindCryptoNewsResearchIntelligence, classifyCryptoNewsDuplicate, createCryptoNewsResearchObservation, cryptoNewsResearchPrecommit, normalizeStrategyReplication, strategyReplicationPrecommit, type CryptoNewsResearchInput, type StrategyReplicationInput } from "./researchExternalIntake";
import { createResearchIntelligenceRecord } from "./researchIntelligence";

const H = "a".repeat(64), SHA = "b".repeat(40);
const newsSnapshot = "The official filing was published.";
const newsFingerprint = createHash("sha256").update(newsSnapshot).digest("hex");
const strategy = (patch: Partial<StrategyReplicationInput> = {}): StrategyReplicationInput => ({
  sourceUrl: "https://example.org/strategy", sourceFingerprint: H, sourceObservedAt: "2026-10-25T00:00:00.000Z",
  strategyName: "Example", strategyFamily: "momentum", market: "krw-xrp", instruments: ["KRW-XRP"], timeframe: "1m", dataRequirements: ["UPBIT_PUBLIC_CANDLES"],
  signalDefinition: "close > prior high", entryRule: "enter on next open", exitRule: "close below prior low", positionSizing: "fixed fraction", riskManagement: "bounded stop", rebalanceFrequency: "per bar", transactionCostAssumptions: "NUSA fee model v1", slippageAssumptions: "NUSA slippage model v1", ...patch,
});

test("public strategy normalization has stable identity and external metrics remain metadata", () => {
  const a = normalizeStrategyReplication(strategy({ reportedPerformance: { sharpe: 999 } }));
  const b = normalizeStrategyReplication(strategy({ sourceUrl: "https://EXAMPLE.org/strategy#section", sourceObservedAt: "2026-10-26T00:00:00.000Z", instruments: ["KRW-XRP", "KRW-XRP"], reportedPerformance: { sharpe: 999_999 } }));
  assert.equal(a.strategyIdentity, b.strategyIdentity);
  assert.equal(a.sourceUrl, b.sourceUrl);
  assert.equal(a.externalPerformanceIsNusaEvidence, false);
  assert.equal(a.realOrderAuthority, false);
  assert.equal(a.realTransferAuthority, false);
  assert.equal(a.productionMutationAllowed, false);
  assert.equal(a.aiAuthority, "ZERO_AUTHORITY");
  assert.notEqual(a.strategyIdentity, normalizeStrategyReplication(strategy({ entryRule: "enter on next close" })).strategyIdentity);
});

test("missing source or executable rule fails closed", () => {
  assert.throws(() => normalizeStrategyReplication(strategy({ sourceFingerprint: "bad" })), /PROVENANCE/);
  assert.throws(() => normalizeStrategyReplication(strategy({ exitRule: " " })), /INSUFFICIENT/);
  assert.throws(() => normalizeStrategyReplication(strategy({ variantOf: "bad-parent" })), /PARENT_INVALID/);
});

test("variant identity is separate and replication precommit binds existing canonical contract", () => {
  const original = normalizeStrategyReplication(strategy());
  const variant = normalizeStrategyReplication(strategy({ variantOf: original.strategyIdentity, signalDefinition: "close > prior high and news filter" }));
  assert.equal(variant.kind, "NUSA_VARIANT");
  assert.notEqual(variant.strategyIdentity, original.strategyIdentity);
  const precommit = strategyReplicationPrecommit({ spec: original, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan: { pit: true, oos: true }, costPlan: { model: "fee-v1" }, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  assert.equal(precommit.strategyIdentity, original.strategyIdentity);
  const forged = { ...original, entryRule: "forged after normalization" };
  assert.throws(() => strategyReplicationPrecommit({ spec: forged, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan: { pit: true }, costPlan: { model: "fee-v1" }, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" }), /IDENTITY_MISMATCH/);
});

const news = (patch: Partial<CryptoNewsResearchInput> = {}): CryptoNewsResearchInput => ({
  sourceUrl: "https://example.org/news#top", publisher: "Publisher", publishedAt: "2026-10-24T00:00:00Z", retrievedAt: "2026-10-25T00:00:00Z", firstObservedAt: "2026-10-24T01:00:00Z", contentSnapshot: newsSnapshot, contentFingerprint: newsFingerprint, sourceType: "NEWS", eventType: "REGULATION", entities: ["SEC"], assets: ["BTC"], confidence: "MEDIUM", observedFacts: ["filing published"], publisherClaims: ["impact is bullish"], scoutInferences: ["test whether volatility changes"], ...patch,
});

test("news keeps facts, claims, inferences separate, deduplicates identity, and rumor is not PIT eligible", () => {
  const a = createCryptoNewsResearchObservation(news()), b = createCryptoNewsResearchObservation(news({ entities: ["SEC", "SEC"] }));
  assert.equal(a.observationIdentity, b.observationIdentity);
  assert.equal(a.sourceUrl, "https://example.org/news");
  assert.deepEqual(a.observedFacts, ["filing published"]);
  assert.equal(classifyCryptoNewsDuplicate(a, b), "DUPLICATE");
  const rumor = createCryptoNewsResearchObservation(news({ sourceType: "RUMOR" }));
  assert.equal(rumor.verificationStatus, "UNVERIFIED");
  assert.equal(rumor.coverageStatus, "UNKNOWN");
  assert.equal(rumor.aiAuthority, "ZERO_AUTHORITY");
});

test("news without publication time cannot be PIT evidence", () => {
  const record = createCryptoNewsResearchObservation(news({ publishedAt: undefined, sourceType: "UNKNOWN", observedFacts: [], publisherClaims: [], scoutInferences: [] }));
  assert.equal(record.coverageStatus, "UNKNOWN");
});

test("verified news hypothesis requires explicit assumptions and binds an immutable existing precommit", () => {
  const observation = createCryptoNewsResearchObservation(news());
  const sourceRecord = createResearchIntelligenceRecord({ sourceId: "publisher", sourceType: "OTHER", sourceUrl: observation.sourceUrl, sourceVerification: "VERIFIED_PRIMARY_SOURCE", title: "Official filing", authors: ["Publisher"], publishedAt: observation.publishedAt!, discoveredAt: observation.firstObservedAt, rawContentSha256: observation.contentFingerprint, topic: ["REGULATION"], market: "CRYPTO", timeframe: "1h", method: "event study hypothesis", claimedContribution: "publisher claim", testableHypothesis: "Test whether filing events predict volatility", assumptions: [], requiredData: ["UPBIT_PUBLIC_CANDLES"] });
  const verified = bindCryptoNewsResearchIntelligence(observation, sourceRecord);
  const result = cryptoNewsResearchPrecommit(verified, { family: "VOLATILITY", rationale: "Test measured volatility after official filings", mechanism: "Information arrival may change uncertainty", targetMarket: "KRW-BTC", expectedRegime: "high information arrival", invalidationCondition: "No out-of-sample volatility response", holdingPeriodMs: 3_600_000, capacityAssumptions: { maxNotional: 1_000_000, maxParticipationRate: 0.01 }, transactionCostSensitivity: 0.8, createdAt: "2026-10-25T02:00:00Z", datasetBinding: { manifest: "manifest-v1" }, evaluationPlan: { pit: true, oos: true }, costPlan: { model: "cost-v1" }, sourceSha: SHA, validationPolicyIdentity: "policy-v1" });
  assert.equal(result.classification, "RESEARCH_HYPOTHESIS_CANDIDATE");
  assert.equal(result.precommit.candidateIdentity, result.hypothesis.candidateId);
  assert.equal(result.precommit.datasetBinding.newsObservationIdentity, verified.observationIdentity);
  assert.equal((result.precommit.parameterPlan.hypothesis as { provenance: { author: string } }).provenance.author, "SCOUT_ADVISORY");
  assert.throws(() => cryptoNewsResearchPrecommit(observation, { family: "VOLATILITY", rationale: "r", mechanism: "m", targetMarket: "KRW-BTC", expectedRegime: "regime", invalidationCondition: "invalidated", holdingPeriodMs: 1000, capacityAssumptions: { maxNotional: 1, maxParticipationRate: 0.1 }, transactionCostSensitivity: 0.5, createdAt: "2026-10-25T02:00:00Z", datasetBinding: {}, evaluationPlan: {}, costPlan: {}, sourceSha: SHA, validationPolicyIdentity: "policy-v1" }), /INELIGIBLE/);
});

test("tampered snapshot, future publication, and syndication ambiguity fail PIT or remain non-promoted", () => {
  const tampered = createCryptoNewsResearchObservation(news({ contentSnapshot: "changed source text" }));
  assert.equal(tampered.coverageStatus, "UNKNOWN");
  assert.equal(tampered.verificationStatus, "UNVERIFIED");
  const future = createCryptoNewsResearchObservation(news({ publishedAt: "2026-10-26T00:00:00Z" }));
  assert.equal(future.coverageStatus, "UNKNOWN");
  const repost = createCryptoNewsResearchObservation(news({ sourceUrl: "https://repost.example/article", originalPublisher: "Original", syndicationClusterId: "cluster-1" }));
  const original = createCryptoNewsResearchObservation(news({ originalPublisher: "Original", syndicationClusterId: "cluster-1" }));
  assert.equal(classifyCryptoNewsDuplicate(original, repost), "DUPLICATE");
});

test("untrusted runtime taxonomy and malformed evidence arrays fail closed", () => {
  assert.throws(() => createCryptoNewsResearchObservation(news({ sourceType: "UNKNOWN_SOURCE" as never })), /CLASSIFICATION_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ eventType: "BUY" as never })), /CLASSIFICATION_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ confidence: "CERTAIN" as never })), /CLASSIFICATION_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ entities: [42] as never })), /EVIDENCE_INVALID/);
});
