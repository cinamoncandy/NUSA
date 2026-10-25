import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";
import { createResearchPrecommit, verifyResearchPrecommit, type ResearchPrecommit } from "./researchPrecommit";
import { createResearchHypothesis, type ResearchHypothesis, type ResearchHypothesisFamily } from "./researchHypothesisContract";
import type { ResearchIntelligenceRecord } from "./researchIntelligence";

const SHA256 = /^[a-f0-9]{64}$/i;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const NEWS_SOURCE_TYPES = new Set(["OFFICIAL", "NEWS", "SOCIAL", "RUMOR", "UNKNOWN"]);
const NEWS_CONFIDENCE_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]);
const CRYPTO_EVENT_TYPES = new Set<CryptoEventType>(["REGULATION", "EXCHANGE", "ETF_FLOW", "SECURITY_EXPLOIT", "PROTOCOL", "TOKENOMICS", "LISTING_DELISTING", "MACRO", "LIQUIDITY", "WHALE_FLOW", "LEGAL", "TECHNICAL", "ADOPTION", "MINING", "STABLECOIN", "OTHER"]);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const digest = (v: unknown): string => createHash("sha256").update(canonicalResearchJson(v), "utf8").digest("hex");
const clean = (v: string): string => v.trim().replace(/\s+/g, " ");
const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
};
function canonicalUrl(value: string, errorCode = "STRATEGY_SOURCE_PROVENANCE_INVALID"): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(errorCode); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(errorCode);
  parsed.hash = "";
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

export type ReplicationResult = "REPRODUCED" | "NOT_REPRODUCED" | "INSUFFICIENT_EVIDENCE" | "INVALID_INPUT";
export type CryptoEventType = "REGULATION" | "EXCHANGE" | "ETF_FLOW" | "SECURITY_EXPLOIT" | "PROTOCOL" | "TOKENOMICS" | "LISTING_DELISTING" | "MACRO" | "LIQUIDITY" | "WHALE_FLOW" | "LEGAL" | "TECHNICAL" | "ADOPTION" | "MINING" | "STABLECOIN" | "OTHER";

export interface StrategyReplicationInput {
  readonly sourceUrl: string; readonly sourceFingerprint: string; readonly sourceSnapshot: string; readonly sourceObservedAt: string;
  readonly strategyName: string; readonly strategyFamily: string; readonly market: string;
  readonly instruments: readonly string[]; readonly timeframe: string; readonly dataRequirements: readonly string[];
  readonly signalDefinition: string; readonly entryRule: string; readonly exitRule: string;
  readonly positionSizing: string; readonly riskManagement: string; readonly rebalanceFrequency: string;
  readonly transactionCostAssumptions: string; readonly slippageAssumptions: string;
  readonly reportedPerformance?: Readonly<Record<string, unknown>>; readonly benchmark?: string;
  readonly sourceTestPeriod?: string; readonly sourceOutOfSampleEvidence?: string;
  readonly sourceWalkForwardEvidence?: string; readonly authorOrPublisher?: string;
  readonly publicationDate?: string; readonly sourceCodeAvailable?: "YES" | "NO" | "UNKNOWN";
  readonly knownLimitations?: readonly string[]; readonly lookaheadRisk?: string;
  readonly survivorshipBiasRisk?: string; readonly dataSnoopingRisk?: string; readonly overfittingRisk?: string;
  readonly residualUnknowns?: readonly string[]; readonly variantOf?: string;
}

export interface StrategyReplicationSpec extends Omit<StrategyReplicationInput, "reportedPerformance" | "instruments" | "dataRequirements" | "knownLimitations" | "residualUnknowns"> {
  readonly schemaVersion: 1; readonly kind: "ORIGINAL_STRATEGY" | "NUSA_VARIANT";
  readonly reportedPerformance: Readonly<Record<string, unknown>>; readonly instruments: readonly string[];
  readonly dataRequirements: readonly string[]; readonly knownLimitations: readonly string[];
  readonly residualUnknowns: readonly string[]; readonly strategyIdentity: string;
  readonly externalPerformanceIsNusaEvidence: false;
  readonly authority: "PAPER_ONLY"; readonly liveAuthority: "NONE"; readonly realOrderAuthority: false;
  readonly realTransferAuthority: false; readonly productionMutationAllowed: false; readonly aiAuthority: "ZERO_AUTHORITY";
}

export function normalizeStrategyReplication(input: StrategyReplicationInput): StrategyReplicationSpec {
  if (!input || !/^https?:\/\//i.test(input.sourceUrl) || !SHA256.test(input.sourceFingerprint) || typeof input.sourceSnapshot !== "string" || input.sourceSnapshot.length === 0 || input.sourceSnapshot.length > 1_000_000 || sha256(input.sourceSnapshot) !== input.sourceFingerprint.toLowerCase() || !Number.isFinite(Date.parse(input.sourceObservedAt))) throw new Error("STRATEGY_SOURCE_PROVENANCE_INVALID");
  const required = [input.strategyName,input.strategyFamily,input.market,input.timeframe,input.signalDefinition,input.entryRule,input.exitRule,input.positionSizing,input.riskManagement,input.rebalanceFrequency,input.transactionCostAssumptions,input.slippageAssumptions];
  if (!required.every(text) || !Array.isArray(input.instruments) || input.instruments.length === 0 || !input.instruments.every(text) || !Array.isArray(input.dataRequirements) || input.dataRequirements.length === 0 || !input.dataRequirements.every(text)) throw new Error("STRATEGY_RULES_INSUFFICIENT");
  if (input.variantOf != null && !SHA256.test(input.variantOf)) throw new Error("STRATEGY_VARIANT_PARENT_INVALID");
  const core = {
    schemaVersion: 1 as const, kind: input.variantOf ? "NUSA_VARIANT" as const : "ORIGINAL_STRATEGY" as const,
    sourceUrl: canonicalUrl(input.sourceUrl), sourceFingerprint: input.sourceFingerprint.toLowerCase(), sourceObservedAt: new Date(input.sourceObservedAt).toISOString(),
    strategyName: clean(input.strategyName), strategyFamily: clean(input.strategyFamily), market: clean(input.market).toUpperCase(),
    instruments: Object.freeze([...new Set(input.instruments.map(clean))].sort()), timeframe: clean(input.timeframe), sourceSnapshot: input.sourceSnapshot,
    dataRequirements: Object.freeze([...new Set(input.dataRequirements.map(clean))].sort()),
    signalDefinition: clean(input.signalDefinition), entryRule: clean(input.entryRule), exitRule: clean(input.exitRule),
    positionSizing: clean(input.positionSizing), riskManagement: clean(input.riskManagement), rebalanceFrequency: clean(input.rebalanceFrequency),
    transactionCostAssumptions: clean(input.transactionCostAssumptions), slippageAssumptions: clean(input.slippageAssumptions),
    reportedPerformance: JSON.parse(canonicalResearchJson(input.reportedPerformance ?? {})) as Readonly<Record<string, unknown>>, benchmark: input.benchmark == null ? "UNKNOWN" : clean(input.benchmark),
    sourceTestPeriod: input.sourceTestPeriod ?? "UNKNOWN", sourceOutOfSampleEvidence: input.sourceOutOfSampleEvidence ?? "UNKNOWN",
    sourceWalkForwardEvidence: input.sourceWalkForwardEvidence ?? "UNKNOWN", authorOrPublisher: input.authorOrPublisher ?? "UNKNOWN",
    publicationDate: input.publicationDate ?? "UNKNOWN", sourceCodeAvailable: input.sourceCodeAvailable ?? "UNKNOWN",
    knownLimitations: Object.freeze([...(input.knownLimitations ?? [])].map(clean).sort()), lookaheadRisk: input.lookaheadRisk ?? "UNKNOWN",
    survivorshipBiasRisk: input.survivorshipBiasRisk ?? "UNKNOWN", dataSnoopingRisk: input.dataSnoopingRisk ?? "UNKNOWN",
    overfittingRisk: input.overfittingRisk ?? "UNKNOWN", residualUnknowns: Object.freeze([...(input.residualUnknowns ?? [])].map(clean).sort()),
    ...(input.variantOf ? { variantOf: clean(input.variantOf) } : {}), externalPerformanceIsNusaEvidence: false as const,
    authority: "PAPER_ONLY" as const, liveAuthority: "NONE" as const, realOrderAuthority: false as const,
    realTransferAuthority: false as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const,
  };
  const { sourceObservedAt: _observedAt, reportedPerformance: _reportedPerformance, benchmark: _benchmark, sourceTestPeriod: _testPeriod, sourceOutOfSampleEvidence: _oos, sourceWalkForwardEvidence: _walkForward, authorOrPublisher: _publisher, publicationDate: _publicationDate, sourceCodeAvailable: _sourceCode, ...identityMaterial } = core;
  return deepFreeze({ ...core, strategyIdentity: digest(identityMaterial) });
}

function verifyStrategyReplicationSpec(spec: StrategyReplicationSpec): void {
  if (!spec || typeof spec !== "object" || spec.externalPerformanceIsNusaEvidence !== false || spec.authority !== "PAPER_ONLY" || spec.liveAuthority !== "NONE" || spec.realOrderAuthority !== false || spec.realTransferAuthority !== false || spec.productionMutationAllowed !== false || spec.aiAuthority !== "ZERO_AUTHORITY" || !SHA256.test(spec.strategyIdentity) || typeof spec.sourceSnapshot !== "string" || sha256(spec.sourceSnapshot) !== spec.sourceFingerprint) throw new Error("STRATEGY_IDENTITY_INVALID");
  const { strategyIdentity, sourceObservedAt: _observedAt, reportedPerformance: _reportedPerformance, benchmark: _benchmark, sourceTestPeriod: _testPeriod, sourceOutOfSampleEvidence: _oos, sourceWalkForwardEvidence: _walkForward, authorOrPublisher: _publisher, publicationDate: _publicationDate, sourceCodeAvailable: _sourceCode, ...identityMaterial } = spec;
  if (strategyIdentity !== digest(identityMaterial)) throw new Error("STRATEGY_IDENTITY_MISMATCH");
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasValue(value: unknown): boolean { return text(value) || (typeof value === "number" && Number.isFinite(value)) || value === true || (Array.isArray(value) && value.length > 0) || (plainRecord(value) && Object.keys(value).length > 0); }
function hasAnyKey(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean { return keys.some((key) => hasValue(record[key])); }
function validatePrecommitPlans(datasetBinding: unknown, evaluationPlan: unknown, costPlan: unknown): boolean {
  if (!plainRecord(datasetBinding) || !plainRecord(evaluationPlan) || !plainRecord(costPlan)) return false;
  const datasetBound = hasAnyKey(datasetBinding, ["manifest", "manifestId", "manifestFingerprint", "datasetId", "datasetFingerprint", "datasetContentSha256"]);
  const pitBound = evaluationPlan.pit === true || hasAnyKey(evaluationPlan, ["pitWindow", "pointInTime", "pitPolicyVersion"]);
  const oosBound = evaluationPlan.oos === true || hasAnyKey(evaluationPlan, ["oosWindow", "outOfSample", "walkForward", "walkForwardConfigHash"]);
  const feeBound = hasAnyKey(costPlan, ["feeModelVersion", "feeModelIdentity", "feeAssumptions", "fees"]);
  const slippageBound = hasAnyKey(costPlan, ["slippageModelVersion", "slippageModelIdentity", "slippageAssumptions", "slippage"]);
  return datasetBound && pitBound && oosBound && feeBound && slippageBound;
}

export function strategyReplicationPrecommit(input: { spec: StrategyReplicationSpec; sourceSha: string; datasetBinding: Readonly<Record<string, unknown>>; evaluationPlan: Readonly<Record<string, unknown>>; costPlan: Readonly<Record<string, unknown>>; validationPolicyIdentity: string; createdAt: string }): ResearchPrecommit {
  const { spec } = input;
  verifyStrategyReplicationSpec(spec);
  if (!validatePrecommitPlans(input.datasetBinding, input.evaluationPlan, input.costPlan) || !text(input.validationPolicyIdentity) || !Number.isFinite(Date.parse(input.createdAt)) || Date.parse(input.createdAt) < Date.parse(spec.sourceObservedAt)) throw new Error("STRATEGY_PRECOMMIT_BINDING_INVALID");
  return createResearchPrecommit({ schemaVersion: 1, experimentIdentity: digest({ strategyIdentity: spec.strategyIdentity, datasetBinding: input.datasetBinding, evaluationPlan: input.evaluationPlan, costPlan: input.costPlan }), candidateIdentity: spec.strategyIdentity, strategyIdentity: spec.strategyIdentity, datasetBinding: input.datasetBinding, sourceSha: input.sourceSha, parameterPlan: { strategySpec: spec }, costPlan: input.costPlan, regimePlan: {}, evaluationPlan: input.evaluationPlan, validationPolicyIdentity: input.validationPolicyIdentity, createdAt: input.createdAt });
}

export interface CryptoNewsResearchInput {
  readonly sourceUrl: string; readonly publisher: string; readonly originalPublisher?: string;
  readonly publishedAt?: string; readonly retrievedAt: string; readonly firstObservedAt: string;
  /** Exact captured source snapshot used to verify contentFingerprint; preserve this version immutably. */
  readonly contentSnapshot: string; readonly contentFingerprint: string;
  readonly sourceType: "OFFICIAL" | "NEWS" | "SOCIAL" | "RUMOR" | "UNKNOWN";
  readonly syndicationClusterId?: string; readonly corroboratingSources?: readonly string[];
  readonly eventType: CryptoEventType; readonly entities: readonly string[]; readonly assets: readonly string[];
  readonly jurisdictions?: readonly string[]; readonly confidence: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  readonly observedFacts: readonly string[]; readonly publisherClaims: readonly string[]; readonly scoutInferences: readonly string[];
  readonly residualUnknowns?: readonly string[]; readonly expectedDirection?: string; readonly expectedMagnitude?: string;
  readonly expectedHorizon?: string; readonly transmissionChannels?: readonly string[];
}
export interface CryptoNewsResearchObservation extends CryptoNewsResearchInput {
  readonly schemaVersion: 1; readonly observationIdentity: string;
  readonly snapshotIntegrity: "VERIFIED" | "MISMATCH";
  readonly verificationStatus: "UNVERIFIED" | "SOURCE_VERIFIED"; readonly coverageStatus: "PIT_ELIGIBLE" | "UNKNOWN";
  readonly researchIntelligenceRecordId?: string;
  readonly materiality: "OBSERVATION"; readonly classification: "OBSERVATION" | "UNKNOWN"; readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE"; readonly productionMutationAllowed: false; readonly aiAuthority: "ZERO_AUTHORITY";
}

export function createCryptoNewsResearchObservation(input: CryptoNewsResearchInput): CryptoNewsResearchObservation {
  if (!input || !text(input.publisher) || !SHA256.test(input.contentFingerprint) || !text(input.contentSnapshot) || !Number.isFinite(Date.parse(input.retrievedAt)) || !Number.isFinite(Date.parse(input.firstObservedAt)) || (input.publishedAt != null && !Number.isFinite(Date.parse(input.publishedAt)))) throw new Error("NEWS_PROVENANCE_INVALID");
  if (!NEWS_SOURCE_TYPES.has(input.sourceType) || !CRYPTO_EVENT_TYPES.has(input.eventType) || !NEWS_CONFIDENCE_LEVELS.has(input.confidence)) throw new Error("NEWS_CLASSIFICATION_INVALID");
  const stringArrays: readonly unknown[] = [input.observedFacts, input.publisherClaims, input.scoutInferences, input.assets, input.entities, input.corroboratingSources ?? [], input.jurisdictions ?? [], input.residualUnknowns ?? [], input.transmissionChannels ?? []];
  if (stringArrays.some((value) => !Array.isArray(value) || !value.every(text))) throw new Error("NEWS_EVIDENCE_INVALID");
  const retrievedAt = new Date(input.retrievedAt).toISOString();
  const sourceUrl = canonicalUrl(input.sourceUrl, "NEWS_PROVENANCE_INVALID");
  const contentFingerprint = input.contentFingerprint.toLowerCase();
  const snapshotMatches = sha256(input.contentSnapshot) === contentFingerprint;
  const firstObservedAt = new Date(input.firstObservedAt).toISOString();
  const core = { ...input, sourceUrl, publisher: clean(input.publisher), originalPublisher: input.originalPublisher == null ? "UNKNOWN" : clean(input.originalPublisher), publishedAt: input.publishedAt == null ? "UNKNOWN" : new Date(input.publishedAt).toISOString(), retrievedAt, firstObservedAt, contentFingerprint, contentSnapshot: input.contentSnapshot, corroboratingSources: [...new Set((input.corroboratingSources ?? []).map(clean))].sort(), entities: [...new Set(input.entities.map(clean))].sort(), assets: [...new Set(input.assets.map(clean))].sort(), jurisdictions: [...new Set((input.jurisdictions ?? []).map(clean))].sort(), observedFacts: [...input.observedFacts.map(clean)].sort(), publisherClaims: [...input.publisherClaims.map(clean)].sort(), scoutInferences: [...input.scoutInferences.map(clean)].sort(), residualUnknowns: [...new Set((input.residualUnknowns ?? []).map(clean))].sort(), snapshotIntegrity: snapshotMatches ? "VERIFIED" as const : "MISMATCH" as const, verificationStatus: "UNVERIFIED" as const, coverageStatus: "UNKNOWN" as const, materiality: "OBSERVATION" as const, classification: "OBSERVATION" as const, schemaVersion: 1 as const, authority: "PAPER_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const };
  return deepFreeze({ ...core, observationIdentity: digest(core) });
}

/** Bind a captured snapshot to the existing Research Intelligence source-verification record. */
export function bindCryptoNewsResearchIntelligence(observation: CryptoNewsResearchObservation, record: ResearchIntelligenceRecord): CryptoNewsResearchObservation {
  const { observationIdentity, ...observationMaterial } = observation;
  const expectedContentFingerprint = digest({ sourceType: record.sourceType, sourceId: record.sourceId, sourceUrl: record.sourceUrl, rawContentSha256: record.rawContentSha256.toLowerCase() });
  const expectedRecordId = `ri:${digest({ sourceType: record.sourceType, sourceId: record.sourceId, contentFingerprint: expectedContentFingerprint })}`;
  if (observationIdentity !== digest(observationMaterial) || observation.snapshotIntegrity !== "VERIFIED" || observation.contentFingerprint !== record.rawContentSha256.toLowerCase() || observation.sourceUrl !== record.sourceUrl || observation.publishedAt !== record.publishedAt || record.contentFingerprint !== expectedContentFingerprint || record.recordId !== expectedRecordId || record.sourceVerification !== "VERIFIED_PRIMARY_SOURCE" || record.validationStatus !== "SOURCE_VERIFIED" || record.evidenceQuality === "INVALID" || record.novelty === "DUPLICATE" || record.authority !== "PAPER_ONLY" || record.liveAuthority !== "NONE" || record.productionMutationAllowed !== false || record.aiAuthority !== "ZERO_AUTHORITY" || Date.parse(record.publishedAt) > Date.parse(record.discoveredAt) || Date.parse(record.discoveredAt) !== Date.parse(observation.firstObservedAt) || Date.parse(record.discoveredAt) > Date.parse(observation.retrievedAt) || Date.parse(observation.firstObservedAt) > Date.parse(observation.retrievedAt) || observation.sourceType === "SOCIAL" || observation.sourceType === "RUMOR") throw new Error("NEWS_RESEARCH_INTELLIGENCE_BINDING_INVALID");
  const core = { ...observationMaterial, verificationStatus: "SOURCE_VERIFIED" as const, coverageStatus: "PIT_ELIGIBLE" as const, researchIntelligenceRecordId: record.recordId };
  return deepFreeze({ ...core, observationIdentity: digest(core) });
}

export function classifyCryptoNewsDuplicate(a: CryptoNewsResearchObservation, b: CryptoNewsResearchObservation): "DUPLICATE" | "POSSIBLE_DUPLICATE" | "DISTINCT" {
  if (a.observationIdentity === b.observationIdentity || a.contentFingerprint === b.contentFingerprint) return "DUPLICATE";
  if (a.syndicationClusterId && a.syndicationClusterId === b.syndicationClusterId) return "DUPLICATE";
  if (a.originalPublisher !== "UNKNOWN" && a.originalPublisher === b.originalPublisher && a.publishedAt === b.publishedAt) return "POSSIBLE_DUPLICATE";
  return "DISTINCT";
}

export interface CryptoNewsHypothesisInput {
  readonly family: ResearchHypothesisFamily; readonly rationale: string; readonly mechanism: string;
  readonly targetMarket: string; readonly expectedRegime: string; readonly invalidationCondition: string;
  readonly holdingPeriodMs: number; readonly capacityAssumptions: { readonly maxNotional: number; readonly maxParticipationRate: number };
  readonly transactionCostSensitivity: number; readonly createdAt: string;
  readonly datasetBinding: Readonly<Record<string, unknown>>; readonly evaluationPlan: Readonly<Record<string, unknown>>;
  readonly costPlan: Readonly<Record<string, unknown>>; readonly sourceSha: string; readonly validationPolicyIdentity: string;
}

export interface StrategyReplicationReceipt {
  readonly schemaVersion: 1; readonly result: ReplicationResult; readonly strategyIdentity: string;
  readonly precommitFingerprint: string; readonly datasetIdentity: string; readonly evaluatorVersion: string;
  readonly evaluatorSourceSha: string; readonly observedAt: string; readonly evidence: Readonly<Record<string, unknown>>;
  readonly negativeEvidence: readonly string[]; readonly receiptFingerprint: string;
  readonly authority: "PAPER_ONLY"; readonly liveAuthority: "NONE"; readonly productionMutationAllowed: false;
  readonly realOrderAuthority: false; readonly realTransferAuthority: false; readonly aiAuthority: "ZERO_AUTHORITY";
}

export function createStrategyReplicationReceipt(input: {
  result: ReplicationResult; spec: StrategyReplicationSpec; precommit: ResearchPrecommit; datasetIdentity: string;
  evaluatorVersion: string; evaluatorSourceSha: string; observedAt: string; evidence: Readonly<Record<string, unknown>>;
  negativeEvidence?: readonly string[];
}): StrategyReplicationReceipt {
  if (!input || typeof input !== "object" || !input.spec || !input.precommit) throw new Error("REPLICATION_RECEIPT_BINDING_INVALID");
  verifyStrategyReplicationSpec(input.spec);
  verifyResearchPrecommit(input.precommit);
  if (!["REPRODUCED", "NOT_REPRODUCED", "INSUFFICIENT_EVIDENCE", "INVALID_INPUT"].includes(input.result) || !text(input.datasetIdentity) || !text(input.evaluatorVersion) || !/^[a-f0-9]{40}$/i.test(input.evaluatorSourceSha) || input.evaluatorSourceSha.toLowerCase() !== input.precommit.sourceSha.toLowerCase() || !Number.isFinite(Date.parse(input.observedAt)) || Date.parse(input.observedAt) < Date.parse(input.precommit.createdAt) || !plainRecord(input.evidence) || Object.keys(input.evidence).length === 0 || !SHA256.test(input.precommit.fingerprint) || input.precommit.strategyIdentity !== input.spec.strategyIdentity || !validatePrecommitPlans(input.precommit.datasetBinding, input.precommit.evaluationPlan, input.precommit.costPlan)) throw new Error("REPLICATION_RECEIPT_BINDING_INVALID");
  const datasetIdentityValues = [input.precommit.datasetBinding.manifest, input.precommit.datasetBinding.manifestId, input.precommit.datasetBinding.manifestFingerprint, input.precommit.datasetBinding.datasetId, input.precommit.datasetBinding.datasetFingerprint, input.precommit.datasetBinding.datasetContentSha256];
  if (!datasetIdentityValues.includes(input.datasetIdentity)) throw new Error("REPLICATION_RECEIPT_DATASET_MISMATCH");
  if (input.negativeEvidence !== undefined && (!Array.isArray(input.negativeEvidence) || !input.negativeEvidence.every(text))) throw new Error("REPLICATION_RECEIPT_EVIDENCE_INVALID");
  const core = { schemaVersion: 1 as const, result: input.result, strategyIdentity: input.spec.strategyIdentity, precommitFingerprint: input.precommit.fingerprint, datasetIdentity: input.datasetIdentity, evaluatorVersion: clean(input.evaluatorVersion), evaluatorSourceSha: input.evaluatorSourceSha.toLowerCase(), observedAt: new Date(input.observedAt).toISOString(), evidence: JSON.parse(canonicalResearchJson(input.evidence)) as Readonly<Record<string, unknown>>, negativeEvidence: Object.freeze([...(input.negativeEvidence ?? [])].map(clean).sort()), authority: "PAPER_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, realOrderAuthority: false as const, realTransferAuthority: false as const, aiAuthority: "ZERO_AUTHORITY" as const };
  return deepFreeze({ ...core, receiptFingerprint: digest(core) });
}

export function verifyStrategyReplicationReceipt(receipt: StrategyReplicationReceipt): void {
  if (!receipt || receipt.schemaVersion !== 1 || !["REPRODUCED", "NOT_REPRODUCED", "INSUFFICIENT_EVIDENCE", "INVALID_INPUT"].includes(receipt.result) || receipt.authority !== "PAPER_ONLY" || receipt.liveAuthority !== "NONE" || receipt.productionMutationAllowed !== false || receipt.realOrderAuthority !== false || receipt.realTransferAuthority !== false || receipt.aiAuthority !== "ZERO_AUTHORITY") throw new Error("REPLICATION_RECEIPT_INVALID");
  const { receiptFingerprint, ...core } = receipt;
  if (!SHA256.test(receiptFingerprint) || digest(core) !== receiptFingerprint) throw new Error("REPLICATION_RECEIPT_FINGERPRINT_MISMATCH");
}

/** Explicit, pre-result hypothesis adapter. It never infers missing economic assumptions from news. */
export function cryptoNewsResearchPrecommit(observation: CryptoNewsResearchObservation, input: CryptoNewsHypothesisInput): { readonly classification: "RESEARCH_HYPOTHESIS_CANDIDATE"; readonly hypothesis: ResearchHypothesis; readonly precommit: ResearchPrecommit } {
  const { observationIdentity, ...observationMaterial } = observation;
  if (!observation || observation.coverageStatus !== "PIT_ELIGIBLE" || observation.verificationStatus !== "SOURCE_VERIFIED" || !observation.researchIntelligenceRecordId || observationIdentity !== digest(observationMaterial) || observation.scoutInferences.length === 0 || !Number.isFinite(Date.parse(input.createdAt)) || Date.parse(input.createdAt) < Date.parse(observation.retrievedAt) || !validatePrecommitPlans(input.datasetBinding, input.evaluationPlan, input.costPlan)) throw new Error("NEWS_HYPOTHESIS_EVIDENCE_INELIGIBLE");
  const semanticInput = { observationIdentity, family: input.family, rationale: input.rationale, mechanism: input.mechanism, targetMarket: input.targetMarket, expectedRegime: input.expectedRegime, invalidationCondition: input.invalidationCondition, holdingPeriodMs: input.holdingPeriodMs, capacityAssumptions: input.capacityAssumptions, transactionCostSensitivity: input.transactionCostSensitivity };
  const base = digest(semanticInput);
  const hypothesis = createResearchHypothesis({ hypothesisId: `news-hypothesis-${base.slice(0, 48)}`, candidateId: `news-candidate-${base.slice(0, 48)}`, family: input.family, rationale: input.rationale, mechanism: input.mechanism, targetMarket: input.targetMarket, expectedRegime: input.expectedRegime, invalidationCondition: input.invalidationCondition, holdingPeriodMs: input.holdingPeriodMs, capacityAssumptions: input.capacityAssumptions, transactionCostSensitivity: input.transactionCostSensitivity, provenance: { author: "SCOUT_ADVISORY", sourceReferences: [observation.sourceUrl, observation.contentFingerprint, observation.observationIdentity] }, createdAt: input.createdAt });
  const precommit = createResearchPrecommit({ schemaVersion: 1, experimentIdentity: digest({ hypothesisId: hypothesis.hypothesisId, observationIdentity, datasetBinding: input.datasetBinding, evaluationPlan: input.evaluationPlan, costPlan: input.costPlan }), candidateIdentity: hypothesis.candidateId, strategyIdentity: hypothesis.candidateId, datasetBinding: { ...input.datasetBinding, newsObservationIdentity: observation.observationIdentity }, sourceSha: input.sourceSha, parameterPlan: { hypothesis, newsObservationIdentity: observation.observationIdentity }, costPlan: input.costPlan, regimePlan: { expectedRegime: input.expectedRegime }, evaluationPlan: input.evaluationPlan, validationPolicyIdentity: input.validationPolicyIdentity, createdAt: input.createdAt });
  return deepFreeze({ classification: "RESEARCH_HYPOTHESIS_CANDIDATE", hypothesis, precommit });
}
