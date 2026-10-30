import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalResearchJson } from "./researchRuntime";
import { createResearchPrecommit } from "./researchPrecommit";
import { classifyCryptoNewsDuplicate, createCryptoNewsResearchObservation, createStrategyReplicationReceipt, normalizeStrategyReplication, strategyReplicationPrecommit, validateCryptoNewsPrecommitPlans, verifyStrategyReplicationPrecommit, verifyStrategyReplicationReceipt, type CryptoNewsResearchInput, type StrategyReplicationInput } from "./researchExternalIntake";
import { createResearchIntelligenceRecord } from "./researchIntelligence";

const H = "a".repeat(64), SHA = "b".repeat(40);
const strategySnapshot = "Published strategy rules: enter next open, exit below prior low.";
const strategyFingerprint = createHash("sha256").update(strategySnapshot).digest("hex");
const newsSnapshot = "The official filing was published.";
const newsFingerprint = createHash("sha256").update(newsSnapshot).digest("hex");
const evaluationPlan = { pitWindow: { startAt: "2026-01-01T00:00:00Z", endAt: "2026-06-01T00:00:00Z" }, oosWindow: { startAt: "2026-06-02T00:00:00Z", endAt: "2026-07-01T00:00:00Z" }, latencyAssumptions: "next-bar execution with 250ms modeled delay", missingDataPolicy: "reject incomplete windows" };
const costPlan = { feeModelVersion: "fee-v1", slippageModelVersion: "slippage-v1" };
const strategy = (patch: Partial<StrategyReplicationInput> = {}): StrategyReplicationInput => ({
  sourceUrl: "https://example.org/strategy", sourceFingerprint: strategyFingerprint, sourceSnapshot: strategySnapshot, sourceObservedAt: "2026-10-25T00:00:00.000Z",
  strategyName: "Example", strategyFamily: "momentum", market: "krw-xrp", instruments: ["KRW-XRP"], timeframe: "1m", dataRequirements: ["UPBIT_PUBLIC_CANDLES"],
  signalDefinition: "close > prior high", entryRule: "enter on next open", exitRule: "close below prior low", positionSizing: "fixed fraction", riskManagement: "bounded stop", rebalanceFrequency: "per bar", transactionCostAssumptions: "NUSA fee model v1", slippageAssumptions: "NUSA slippage model v1", ...patch,
});
const reidentifyStrategy = (spec: ReturnType<typeof normalizeStrategyReplication>): string => {
  const { strategyIdentity: _identity, reportedPerformance: _reportedPerformance, benchmark: _benchmark, sourceTestPeriod: _testPeriod, sourceOutOfSampleEvidence: _oos, sourceWalkForwardEvidence: _walkForward, authorOrPublisher: _publisher, publicationDate: _publicationDate, sourceCodeAvailable: _sourceCode, sourceObservedAt: _sourceObservedAt, sourceObservationFingerprint: _sourceObservationFingerprint, ...identityMaterial } = spec;
  return createHash("sha256").update(canonicalResearchJson(identityMaterial), "utf8").digest("hex");
};
test("public strategy normalization has stable identity and external metrics remain metadata", () => {
  const a = normalizeStrategyReplication(strategy({ reportedPerformance: { sharpe: 999 } }));
  const b = normalizeStrategyReplication(strategy({ sourceUrl: "https://EXAMPLE.org/strategy#section", sourceObservedAt: "2026-10-26T00:00:00.000Z", instruments: ["KRW-XRP", "KRW-XRP"], reportedPerformance: { sharpe: 999_999 } }));
  assert.equal(a.strategyIdentity, b.strategyIdentity, "later recapture of identical source and rules deduplicates to the same strategy");
  assert.notEqual(a.sourceObservationFingerprint, b.sourceObservationFingerprint, "capture chronology remains separately bound");
  assert.equal(a.strategyIdentity, normalizeStrategyReplication(strategy({ reportedPerformance: { sharpe: -999 } })).strategyIdentity, "external result claims do not alter strategy rules identity");
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

test("unknown economic assumptions and non-ISO provenance timestamps fail closed", () => {
  assert.throws(() => normalizeStrategyReplication(strategy({ transactionCostAssumptions: "UNKNOWN" })), /COST_ASSUMPTIONS_INSUFFICIENT/);
  assert.throws(() => normalizeStrategyReplication(strategy({ slippageAssumptions: "N/A" })), /COST_ASSUMPTIONS_INSUFFICIENT/);
  assert.throws(() => normalizeStrategyReplication(strategy({ sourceObservedAt: 0 as never })), /PROVENANCE_INVALID/);
  assert.throws(() => normalizeStrategyReplication(strategy({ sourceObservedAt: "0" })), /PROVENANCE_INVALID/);
  assert.throws(() => normalizeStrategyReplication(strategy({ sourceObservedAt: "2026-02-30T00:00:00Z" })), /PROVENANCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ retrievedAt: 0 as never })), /NEWS_PROVENANCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ publishedAt: "0" })), /NEWS_PROVENANCE_INVALID/);
});

test("variant identity is separate and replication precommit binds existing canonical contract", () => {
  const original = normalizeStrategyReplication(strategy());
  const variantInput = strategy({ variantOf: original.strategyIdentity, signalDefinition: "close > prior high and news filter" });
  assert.throws(() => normalizeStrategyReplication(variantInput), /PARENT_REQUIRED/);
  assert.throws(() => normalizeStrategyReplication(variantInput, normalizeStrategyReplication(strategy({ strategyName: "Other parent" }))), /PARENT_MISMATCH/);
  const variant = normalizeStrategyReplication(variantInput, original);
  assert.equal(variant.kind, "NUSA_VARIANT");
  assert.notEqual(variant.strategyIdentity, original.strategyIdentity);
  const originalPrecommit = strategyReplicationPrecommit({ spec: original, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  assert.throws(() => strategyReplicationPrecommit({ spec: variant, parentSpec: original, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" }), /PARENT_PRECOMMIT_REQUIRED/);
  const variantPrecommit = strategyReplicationPrecommit({ spec: variant, parentSpec: original, parentPrecommit: originalPrecommit, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  assert.equal((variantPrecommit.parameterPlan as { parentStrategySpec: typeof original }).parentStrategySpec.strategyIdentity, original.strategyIdentity);
  assert.throws(() => strategyReplicationPrecommit({ spec: variant, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" }), /PARENT_REQUIRED/);
  const { fingerprint: _fingerprint, ...orphanInput } = variantPrecommit;
  const orphanedPrecommit = createResearchPrecommit({ ...orphanInput, parameterPlan: { strategySpec: variant } });
  assert.throws(() => createStrategyReplicationReceipt({ result: "INSUFFICIENT_EVIDENCE", spec: variant, precommit: orphanedPrecommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { reason: "parent removed" } }), /STRATEGY_VARIANT_PARENT_PRECOMMIT_REQUIRED/);
  const precommit = strategyReplicationPrecommit({ spec: original, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  assert.equal(precommit.strategyIdentity, original.strategyIdentity);
  const forged = { ...original, entryRule: "forged after normalization" };
  assert.throws(() => strategyReplicationPrecommit({ spec: forged, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" }), /IDENTITY_MISMATCH/);
  const changedObservationTime = { ...original, sourceObservedAt: "2026-10-24T00:00:00.000Z" };
  assert.throws(() => strategyReplicationPrecommit({ spec: changedObservationTime, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" }), /IDENTITY/);
  const changedObservationProof = { ...original, sourceObservedAt: "2026-10-24T00:00:00.000Z", sourceObservationFingerprint: original.sourceObservationFingerprint };
  assert.throws(() => strategyReplicationPrecommit({ spec: changedObservationProof, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" }), /IDENTITY_INVALID/);
});

test("deserialized strategy specs are revalidated before precommit admission", () => {
  const spec = normalizeStrategyReplication(strategy());
  const makePrecommit = (candidate: typeof spec) => strategyReplicationPrecommit({ spec: candidate, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  const missingInstrument = { ...spec, instruments: [] } as unknown as typeof spec;
  const forgedInstrument = { ...missingInstrument, strategyIdentity: reidentifyStrategy(missingInstrument) };
  assert.throws(() => makePrecommit(forgedInstrument), /RULES_INSUFFICIENT/);
  const blankExit = { ...spec, exitRule: " " };
  const forgedExit = { ...blankExit, strategyIdentity: reidentifyStrategy(blankExit) };
  assert.throws(() => makePrecommit(forgedExit), /RULES_INSUFFICIENT/);
  const malformedPublication = { ...spec, publicationDate: {} as never };
  assert.throws(() => makePrecommit({ ...malformedPublication, strategyIdentity: reidentifyStrategy(malformedPublication) }), /METADATA_INVALID/);
  for (const publicationDate of ["yesterday", "2026-02-30T00:00:00Z"]) {
    assert.throws(() => normalizeStrategyReplication(strategy({ publicationDate })), /METADATA_INVALID/);
  }
  assert.equal(normalizeStrategyReplication(strategy({ publicationDate: "2026-10-25T00:00:00Z" })).publicationDate, "2026-10-25T00:00:00Z");
  const malformedSourceCode = { ...spec, sourceCodeAvailable: "MAYBE" as never };
  assert.throws(() => makePrecommit({ ...malformedSourceCode, strategyIdentity: reidentifyStrategy(malformedSourceCode) }), /METADATA_INVALID/);
  const malformedLimitations = { ...spec, knownLimitations: "not-an-array" as never };
  assert.throws(() => makePrecommit({ ...malformedLimitations, strategyIdentity: reidentifyStrategy(malformedLimitations) }), /METADATA_INVALID/);
  const malformedPerformance = { ...spec, reportedPerformance: "Sharpe 999" as never };
  assert.throws(() => makePrecommit({ ...malformedPerformance, strategyIdentity: reidentifyStrategy(malformedPerformance) }), /METADATA_INVALID/);
  const canonicalMetadata = normalizeStrategyReplication(strategy({ knownLimitations: [" limitation  a ", "limitation a"], residualUnknowns: ["unknown b", " unknown a "] }));
  assert.deepEqual(canonicalMetadata.knownLimitations, ["limitation a"]);
  assert.deepEqual(canonicalMetadata.residualUnknowns, ["unknown a", "unknown b"]);
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
  const optionalText = createCryptoNewsResearchObservation(news({ syndicationClusterId: " cluster-1 ", expectedDirection: " UP ", expectedMagnitude: " medium ", expectedHorizon: " 1h " }));
  const canonicalOptionalText = createCryptoNewsResearchObservation(news({ syndicationClusterId: "cluster-1", expectedDirection: "UP", expectedMagnitude: "medium", expectedHorizon: "1h" }));
  assert.equal(optionalText.observationIdentity, canonicalOptionalText.observationIdentity);
  const channels = createCryptoNewsResearchObservation(news({ transmissionChannels: [" liquidity ", "liquidity", " adoption "] }));
  const canonicalChannels = createCryptoNewsResearchObservation(news({ transmissionChannels: ["adoption", "liquidity"] }));
  assert.equal(channels.observationIdentity, canonicalChannels.observationIdentity);
  assert.deepEqual(channels.transmissionChannels, ["adoption", "liquidity"]);
});

test("news without publication time cannot be PIT evidence", () => {
  const record = createCryptoNewsResearchObservation(news({ publishedAt: undefined, sourceType: "UNKNOWN", observedFacts: [], publisherClaims: [], scoutInferences: [] }));
  assert.equal(record.coverageStatus, "UNKNOWN");
});

test("captured news remains unverified until the canonical storage owner resolves its source record", () => {
  const observation = createCryptoNewsResearchObservation(news());
  assert.equal(observation.verificationStatus, "UNVERIFIED");
  assert.equal(observation.coverageStatus, "UNKNOWN");
  assert.equal(observation.researchIntelligenceRecordId, undefined);
});

test("strategy source snapshot must match its fingerprint and list values cannot normalize to blanks", () => {
  assert.throws(() => normalizeStrategyReplication(strategy({ sourceFingerprint: H })), /PROVENANCE/);
  assert.throws(() => normalizeStrategyReplication(strategy({ instruments: [" "] })), /RULES_INSUFFICIENT/);
  assert.throws(() => normalizeStrategyReplication(strategy({ dataRequirements: ["\t"] })), /RULES_INSUFFICIENT/);
});

test("precommit requires PIT/OOS, dataset, fee and slippage bindings and cannot predate source evidence", () => {
  const spec = normalizeStrategyReplication(strategy());
  const valid = { spec, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1" };
  assert.throws(() => strategyReplicationPrecommit({ ...valid, datasetBinding: {}, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, datasetBinding: { manifest: "UNKNOWN" }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { pitWindow: evaluationPlan.pitWindow }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { pitPolicyVersion: "UNKNOWN", oosWindow: evaluationPlan.oosWindow, latencyAssumptions: evaluationPlan.latencyAssumptions, missingDataPolicy: evaluationPlan.missingDataPolicy }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { pitWindow: evaluationPlan.pitWindow, oosPolicyVersion: "N/A", latencyAssumptions: evaluationPlan.latencyAssumptions, missingDataPolicy: evaluationPlan.missingDataPolicy }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { ...evaluationPlan, oosWindow: { startAt: "2026-05-01T00:00:00Z", endAt: "2026-07-01T00:00:00Z" } }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  for (const invalidStart of ["2026-02-30T00:00:00Z", "2026-06-02T00:00:00", "2026-06-02"]) {
    assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { ...evaluationPlan, oosWindow: { startAt: invalidStart, endAt: "2026-07-01T00:00:00Z" } }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  }
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { ...evaluationPlan, latencyAssumptions: " " }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { ...evaluationPlan, missingDataPolicy: "UNKNOWN" }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, evaluationPlan: { pit: true, oos: true }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, costPlan: { feeModelVersion: "fee-v1" }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, costPlan: { feeAssumptions: "UNKNOWN", slippageAssumptions: "N/A" }, createdAt: "2026-10-25T00:00:00Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.throws(() => strategyReplicationPrecommit({ ...valid, createdAt: "2026-10-24T23:59:59Z" }), /PRECOMMIT_BINDING_INVALID/);
  assert.equal(validateCryptoNewsPrecommitPlans(Object.create({ manifest: "dataset-1" }), evaluationPlan, costPlan), false);
  assert.equal(validateCryptoNewsPrecommitPlans({ manifest: "dataset-1" }, Object.create(evaluationPlan), costPlan), false);
  assert.equal(validateCryptoNewsPrecommitPlans({ manifest: "dataset-1" }, evaluationPlan, Object.create(costPlan)), false);
  const originalPit = Object.getOwnPropertyDescriptor(Object.prototype, "pitPolicyVersion");
  const originalOos = Object.getOwnPropertyDescriptor(Object.prototype, "oosPolicyVersion");
  try {
    Object.defineProperty(Object.prototype, "pitPolicyVersion", { configurable: true, value: "pit-v1" });
    Object.defineProperty(Object.prototype, "oosPolicyVersion", { configurable: true, value: "oos-v1" });
    assert.equal(validateCryptoNewsPrecommitPlans({ manifest: "dataset-1" }, { latencyAssumptions: "modeled", missingDataPolicy: "reject" }, costPlan), false);
  } finally {
    if (originalPit) Object.defineProperty(Object.prototype, "pitPolicyVersion", originalPit);
    else delete (Object.prototype as { pitPolicyVersion?: string }).pitPolicyVersion;
    if (originalOos) Object.defineProperty(Object.prototype, "oosPolicyVersion", originalOos);
    else delete (Object.prototype as { oosPolicyVersion?: string }).oosPolicyVersion;
  }
});

test("replication receipt binds outcome to spec, precommit, dataset and preserves adverse evidence", () => {
  const spec = normalizeStrategyReplication(strategy());
  const precommit = strategyReplicationPrecommit({ spec, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  const receipt = createStrategyReplicationReceipt({ result: "NOT_REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { reason: "cost-adjusted OOS failed" }, negativeEvidence: ["transaction costs destroyed edge", "unstable across regimes"] });
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "UNKNOWN", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /RECEIPT_BINDING_INVALID/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "N/A", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /RECEIPT_BINDING_INVALID/);
  assert.equal(receipt.result, "NOT_REPRODUCED");
  assert.equal(receipt.precommitFingerprint, precommit.fingerprint);
  assert.deepEqual(receipt.negativeEvidence, ["transaction costs destroyed edge", "unstable across regimes"]);
  verifyStrategyReplicationReceipt(receipt, precommit);
  const paddedDatasetPrecommit = strategyReplicationPrecommit({ spec, sourceSha: SHA, datasetBinding: { manifest: " dataset-1 " }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  const paddedDatasetReceipt = createStrategyReplicationReceipt({ result: "INSUFFICIENT_EVIDENCE", spec, precommit: paddedDatasetPrecommit, datasetIdentity: " dataset-1 ", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { reason: "preserve exact bound identity" } });
  assert.equal(paddedDatasetReceipt.datasetIdentity, " dataset-1 ");
  verifyStrategyReplicationReceipt(paddedDatasetReceipt, paddedDatasetPrecommit);
  const unknownPolicyPrecommit = createResearchPrecommit({ schemaVersion: 1, experimentIdentity: precommit.experimentIdentity, candidateIdentity: precommit.candidateIdentity, strategyIdentity: precommit.strategyIdentity, datasetBinding: precommit.datasetBinding, sourceSha: precommit.sourceSha, parameterPlan: precommit.parameterPlan, costPlan: precommit.costPlan, regimePlan: precommit.regimePlan, evaluationPlan: precommit.evaluationPlan, validationPolicyIdentity: "UNKNOWN", createdAt: precommit.createdAt });
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit: unknownPolicyPrecommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /PRECOMMIT_MISMATCH/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "other-dataset", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /DATASET_MISMATCH/);
  assert.throws(() => verifyStrategyReplicationReceipt({ ...receipt, negativeEvidence: [] }, precommit), /FINGERPRINT_MISMATCH|NON_CANONICAL/);
  assert.throws(() => verifyStrategyReplicationReceipt({ ...receipt, datasetIdentity: "other-dataset" }, precommit), /PRECOMMIT_MISMATCH/);
  assert.throws(() => verifyStrategyReplicationReceipt(receipt, { ...precommit, datasetBinding: { ...precommit.datasetBinding, manifest: "different-dataset" } }), /PRECOMMIT_MISMATCH|fingerprint mismatch/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: "c".repeat(40), observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /BINDING_INVALID/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-24T00:00:00Z", evidence: { result: "pass" } }), /BINDING_INVALID/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { reason: undefined } }), /BINDING_INVALID/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { nested: { reason: undefined } } }), /BINDING_INVALID/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: {} }), /BINDING_INVALID/);
  const sparseEvidence = new Array(1);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { rows: sparseEvidence } }), /BINDING_INVALID/);
  const accessorEvidence = Object.defineProperty({}, "reason", { enumerable: true, get: () => "evidence" });
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: accessorEvidence }), /BINDING_INVALID/);
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit: { ...precommit, fingerprint: "c".repeat(64) }, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /precommit fingerprint mismatch/);
  const unrelatedPrecommit = createResearchPrecommit({ schemaVersion: 1, experimentIdentity: "unrelated-experiment", candidateIdentity: "unrelated-candidate", strategyIdentity: spec.strategyIdentity, datasetBinding: precommit.datasetBinding, sourceSha: SHA, parameterPlan: { strategySpec: spec }, costPlan: precommit.costPlan, regimePlan: {}, evaluationPlan: precommit.evaluationPlan, validationPolicyIdentity: "policy-v1", createdAt: precommit.createdAt });
  assert.throws(() => createStrategyReplicationReceipt({ result: "REPRODUCED", spec, precommit: unrelatedPrecommit, datasetIdentity: "dataset-1", evaluatorVersion: "replicator-v1", evaluatorSourceSha: SHA, observedAt: "2026-10-26T00:00:00Z", evidence: { result: "pass" } }), /PRECOMMIT_MISMATCH/);
  const malformedCore = { ...receipt, datasetIdentity: "", observedAt: "not-a-date", evidence: {} };
  const { receiptFingerprint: _oldFingerprint, ...malformedWithoutFingerprint } = malformedCore;
  const forgedReceipt = { ...malformedWithoutFingerprint, receiptFingerprint: createHash("sha256").update(canonicalResearchJson(malformedWithoutFingerprint), "utf8").digest("hex") };
  assert.throws(() => verifyStrategyReplicationReceipt(forgedReceipt, precommit), /RECEIPT_INVALID/);
  const withRecomputedFingerprint = (candidate: Record<string, unknown>) => {
    const { receiptFingerprint: _fingerprint, ...candidateCore } = candidate;
    return { ...candidateCore, receiptFingerprint: createHash("sha256").update(canonicalResearchJson(candidateCore), "utf8").digest("hex") };
  };
  assert.throws(() => verifyStrategyReplicationReceipt(withRecomputedFingerprint({ ...receipt, evaluatorVersion: " replicator-v1 " }) as never, precommit), /RECEIPT_NON_CANONICAL/);
  assert.throws(() => verifyStrategyReplicationReceipt(withRecomputedFingerprint({ ...receipt, evaluatorSourceSha: SHA.toUpperCase() }) as never, precommit), /RECEIPT_NON_CANONICAL/);
  assert.throws(() => verifyStrategyReplicationReceipt(withRecomputedFingerprint({ ...receipt, negativeEvidence: [...receipt.negativeEvidence].reverse() }) as never, precommit), /RECEIPT_NON_CANONICAL/);
});

test("Research Intelligence canonical factory rejects forged runtime taxonomy values", () => {
  const valid = {
    sourceId: "publisher", sourceType: "OTHER", sourceUrl: "https://example.org/research", sourceVerification: "UNVERIFIED",
    title: "Research source", authors: ["Publisher"], publishedAt: "2026-10-24T00:00:00Z", discoveredAt: "2026-10-24T01:00:00Z",
    rawContentSha256: H, topic: ["REGULATION"], market: "CRYPTO", timeframe: "1h", method: "event study",
    claimedContribution: "source claim", testableHypothesis: "testable hypothesis", assumptions: [], requiredData: ["UPBIT_PUBLIC_CANDLES"],
  } as const;
  const invalidTaxonomies = {
    sourceType: "FAKE_SOURCE", sourceVerification: "TRUSTED", codeAvailable: "FORGED", datasetAvailable: "FORGED",
    reproducibilityStatus: "PASSED", novelty: "UNIQUE", evidenceQuality: "TRUSTED", nusaRelevance: "CERTAIN",
    implementationCost: "FREE", expectedEconomicValue: "PROVEN", leakageRisk: "NONE", overfittingRisk: "NONE",
    regimeDependence: "LOWISH", transactionCostSensitivity: "NONE", validationStatus: "APPROVED", axiomHandoffStatus: "AUTO_ACCEPTED",
  };
  for (const [field, value] of Object.entries(invalidTaxonomies)) {
    assert.throws(() => createResearchIntelligenceRecord({ ...valid, [field]: value } as never), new RegExp(`${field} is invalid`), field);
  }
  assert.throws(() => createResearchIntelligenceRecord({ ...valid, sourceVerification: "VERIFIED_PRIMARY_SOURCE" } as never), /sourceVerification is invalid/);
  assert.throws(() => createResearchIntelligenceRecord({ ...valid, validationStatus: "SOURCE_VERIFIED" } as never), /validationStatus is invalid/);
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
  assert.throws(() => createCryptoNewsResearchObservation(news({ syndicationClusterId: 7 as never })), /EVIDENCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ originalPublisher: 42 as never })), /EVIDENCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ expectedDirection: { trade: "BUY" } as never })), /EVIDENCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ expectedMagnitude: null as never })), /EVIDENCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ expectedHorizon: "   " })), /EVIDENCE_INVALID/);
});

test("news observation factory rejects malformed runtime taxonomy and provenance before PIT binding", () => {
  assert.throws(() => createCryptoNewsResearchObservation(news({ eventType: "BUY" as never })), /CLASSIFICATION_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ confidence: "CERTAIN" as never })), /CLASSIFICATION_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ observedFacts: [" "] })), /EVIDENCE_INVALID/);
  assert.throws(() => createCryptoNewsResearchObservation(news({ syndicationClusterId: 7 as never })), /EVIDENCE_INVALID/);
});

test("news observation identity rejects unrecognized runtime fields", () => {
  assert.throws(() => createCryptoNewsResearchObservation({ ...news(), schemaHint: "future" } as never), /NEWS_EVIDENCE_INVALID/);
  const inheritedTaxonomy = Object.assign(Object.create({ sourceType: "NEWS", eventType: "REGULATION", confidence: "MEDIUM" }), {
    sourceUrl: "https://example.org/news", publisher: "Example", publishedAt: "2026-10-25T00:00:00Z",
    retrievedAt: "2026-10-25T00:01:00Z", firstObservedAt: "2026-10-25T00:01:00Z",
    contentSnapshot: newsSnapshot, contentFingerprint: newsFingerprint,
    entities: [], assets: [], observedFacts: ["filing"], publisherClaims: [], scoutInferences: [],
  });
  assert.throws(() => createCryptoNewsResearchObservation(inheritedTaxonomy), /NEWS_EVIDENCE_INVALID/);
});

test("strategy replication rejects a modified regime plan even with a recomputed precommit fingerprint", () => {
  const spec = normalizeStrategyReplication(strategy());
  const precommit = strategyReplicationPrecommit({ spec, sourceSha: SHA, datasetBinding: { manifest: "dataset-1" }, evaluationPlan, costPlan, validationPolicyIdentity: "policy-v1", createdAt: "2026-10-25T00:00:00Z" });
  const { fingerprint: _fingerprint, ...precommitInput } = precommit;
  const modified = createResearchPrecommit({ ...precommitInput, regimePlan: { regime: "BULL" } });
  assert.throws(() => verifyStrategyReplicationPrecommit(spec, modified), /RECEIPT_PRECOMMIT_MISMATCH/);
});
