import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";
import { createResearchHypothesis } from "../../contracts/src/researchHypothesisContract";
import { createResearchPrecommit } from "../../contracts/src/researchPrecommit";
import { createCryptoNewsResearchObservation, validateCryptoNewsPrecommitPlans, type CryptoNewsHypothesisInput, type CryptoNewsResearchInput, type CryptoNewsResearchObservation } from "../../contracts/src/researchExternalIntake";
import { createResearchIntelligenceRecord, type ResearchIntelligenceRecord } from "../../contracts/src/researchIntelligence";
import {
  isResearchIntelligenceSourceRecordAuthenticated,
  validatePersistedResearchIntelligenceSourceReceiptIntegrity,
} from "../../contracts/src/researchIntelligenceVerificationInternal";
import { researchMemoryArtifactDigestV1 } from "../../contracts/src/researchMemorySemantics";
import { SqliteResearchSemanticMemoryRepository } from "./researchMemorySemantics";

export interface ResearchIntelligenceMemoryDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

const decode = (row: Record<string, unknown>): ResearchIntelligenceRecord =>
  JSON.parse(String(row.payload_json)) as ResearchIntelligenceRecord;

const digest = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const knownText = (value: unknown): value is string => text(value) && !/^(?:UNKNOWN|N\/A|NOT\s+SPECIFIED)$/i.test(value.trim());
const validTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , zoneHourText, zoneMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z" && (zone === "-00:00" || Number(zoneHourText) > 23 || Number(zoneMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
};

function cryptoNewsInputFromObservation(observation: CryptoNewsResearchObservation): CryptoNewsResearchInput {
  return {
    sourceUrl: observation.sourceUrl, publisher: observation.publisher, originalPublisher: observation.originalPublisher,
    publishedAt: observation.publishedAt === "UNKNOWN" ? undefined : observation.publishedAt,
    retrievedAt: observation.retrievedAt, firstObservedAt: observation.firstObservedAt,
    contentSnapshot: observation.contentSnapshot, contentFingerprint: observation.contentFingerprint,
    sourceType: observation.sourceType, syndicationClusterId: observation.syndicationClusterId,
    corroboratingSources: observation.corroboratingSources, eventType: observation.eventType,
    entities: observation.entities, assets: observation.assets, jurisdictions: observation.jurisdictions,
    confidence: observation.confidence, observedFacts: observation.observedFacts,
    publisherClaims: observation.publisherClaims, scoutInferences: observation.scoutInferences,
    residualUnknowns: observation.residualUnknowns, expectedDirection: observation.expectedDirection,
    expectedMagnitude: observation.expectedMagnitude, expectedHorizon: observation.expectedHorizon,
    transmissionChannels: observation.transmissionChannels,
  };
}

function reconstructResearchIntelligenceRecord(record: ResearchIntelligenceRecord): ResearchIntelligenceRecord {
  const reconstructed = createResearchIntelligenceRecord({
    sourceId: record.sourceId, sourceType: record.sourceType, sourceUrl: record.sourceUrl,
    sourceVerification: "UNVERIFIED", title: record.title, authors: record.authors,
    publishedAt: record.publishedAt, discoveredAt: record.discoveredAt, rawContentSha256: record.rawContentSha256,
    topic: record.topic, market: record.market, timeframe: record.timeframe, method: record.method,
    claimedContribution: record.claimedContribution, testableHypothesis: record.testableHypothesis,
    assumptions: record.assumptions, requiredData: record.requiredData, codeAvailable: record.codeAvailable,
    datasetAvailable: record.datasetAvailable, reproducibilityStatus: record.reproducibilityStatus,
    novelty: record.novelty, evidenceQuality: record.evidenceQuality, nusaRelevance: record.nusaRelevance,
    implementationCost: record.implementationCost, expectedEconomicValue: record.expectedEconomicValue,
    leakageRisk: record.leakageRisk, overfittingRisk: record.overfittingRisk, regimeDependence: record.regimeDependence,
    transactionCostSensitivity: record.transactionCostSensitivity,
    validationStatus: record.validationStatus === "SOURCE_VERIFIED" ? "DISCOVERED" : record.validationStatus,
    failureReason: record.failureReason, relatedExistingResearch: record.relatedExistingResearch,
    axiomHandoffStatus: record.axiomHandoffStatus,
  });
  if (record.sourceVerification === "VERIFIED_PRIMARY_SOURCE" || record.validationStatus === "SOURCE_VERIFIED") {
    if (!validatePersistedResearchIntelligenceSourceReceiptIntegrity(record) || !record.sourceVerificationReceipt) {
      throw new Error("research intelligence source verification receipt is invalid");
    }
    return Object.freeze({
      ...reconstructed,
      sourceVerification: "VERIFIED_PRIMARY_SOURCE" as const,
      validationStatus: "SOURCE_VERIFIED" as const,
      sourceVerificationReceipt: record.sourceVerificationReceipt,
    });
  }
  if (record.sourceVerificationReceipt !== undefined) {
    throw new Error("research intelligence source verification receipt is invalid");
  }
  return reconstructed;
}

function validateStoredRow(
  row: Record<string, unknown>,
  record: ResearchIntelligenceRecord,
): void {
  if (
    String(row.record_id) !== record.recordId ||
    String(row.source_id) !== record.sourceId ||
    String(row.source_type) !== record.sourceType ||
    String(row.content_fingerprint) !== record.contentFingerprint ||
    String(row.hypothesis_semantic_fingerprint) !== (record.hypothesisSemanticFingerprint ?? "") ||
    String(row.discovered_at) !== record.discoveredAt ||
    record.authority !== "PAPER_ONLY" ||
    record.liveAuthority !== "NONE" ||
    record.productionMutationAllowed !== false ||
    record.aiAuthority !== "ZERO_AUTHORITY"
  ) {
    throw new Error("research intelligence persisted row integrity violation");
  }
  if (!validatePersistedResearchIntelligenceSourceReceiptIntegrity(record)) {
    throw new Error("research intelligence source verification receipt is invalid");
  }
  const reconstructed = reconstructResearchIntelligenceRecord(record);
  if (canonicalResearchJson(reconstructed) !== canonicalResearchJson(record)) {
    throw new Error("research intelligence persisted row integrity violation");
  }
}

export class SqliteResearchIntelligenceMemoryRepository {
  private readonly semantic: SqliteResearchSemanticMemoryRepository;
  // Durable receipts are self-consistency evidence, not an authenticator. Only a source capture
  // observed by this process may restore trusted status; a restart requires a fresh capture.
  private readonly authenticatedThisProcess = new Map<string, ResearchIntelligenceRecord>();

  public constructor(private readonly db: ResearchIntelligenceMemoryDatabase) {
    this.semantic = new SqliteResearchSemanticMemoryRepository(db);
  }

  public list(): readonly ResearchIntelligenceRecord[] {
    const rows = this.db.connection.prepare(
      "SELECT record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json FROM research_intelligence_records ORDER BY discovered_at ASC, source_id ASC, record_id ASC"
    ).all() as Record<string, unknown>[];
    const semantic = this.semantic.listSemantic().filter(
      (event) => event.artifact.artifactKind === "RESEARCH_INTELLIGENCE_RECORD",
    );
    return Object.freeze(rows.map((row) => {
      const record = decode(row);
      validateStoredRow(row, record);
      const expectedDigest = researchMemoryArtifactDigestV1(record);
      const overlay = semantic.find(
        (event) =>
          event.artifact.artifactId === record.recordId &&
          event.artifact.artifactContentSha256 === expectedDigest &&
          event.artifact.artifactDigestKind === "CANONICAL_RESEARCH_INTELLIGENCE_SHA256_V1",
      );
      if (overlay == null) {
        throw new Error("research intelligence semantic provenance mismatch");
      }
      return Object.freeze(this.resolveCurrentProcessTrust(record));
    }));
  }

  /** Resolve only a record already persisted with its canonical semantic provenance overlay. */
  public get(recordId: string): ResearchIntelligenceRecord | null {
    if (typeof recordId !== "string" || recordId.trim() === "") {
      throw new Error("research intelligence record id is invalid");
    }
    const row = this.db.connection.prepare(
      "SELECT record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json FROM research_intelligence_records WHERE record_id = ?",
    ).get(recordId) as Record<string, unknown> | undefined;
    if (row == null) return null;
    const record = decode(row);
    validateStoredRow(row, record);
    const expectedDigest = researchMemoryArtifactDigestV1(record);
    const overlay = this.semantic.listSemantic().find(
      (event) =>
        event.artifact.artifactKind === "RESEARCH_INTELLIGENCE_RECORD" &&
        event.artifact.artifactId === record.recordId &&
        event.artifact.artifactContentSha256 === expectedDigest &&
        event.artifact.artifactDigestKind === "CANONICAL_RESEARCH_INTELLIGENCE_SHA256_V1",
    );
    if (overlay == null) {
      throw new Error("research intelligence semantic provenance mismatch");
    }
    return Object.freeze(this.resolveCurrentProcessTrust(record));
  }

  private resolveCurrentProcessTrust(stored: ResearchIntelligenceRecord): ResearchIntelligenceRecord {
    const fresh = this.authenticatedThisProcess.get(stored.recordId);
    if (fresh && fresh.contentFingerprint === stored.contentFingerprint
      && fresh.sourceVerificationReceipt?.sourceEntryFingerprint === stored.sourceVerificationReceipt?.sourceEntryFingerprint) {
      return fresh;
    }
    // The stored checksum can detect accidental corruption but cannot establish who issued it.
    // Preserve the immutable row as history while exposing it as unverified after restart.
    return reconstructResearchIntelligenceRecord({
      ...stored,
      sourceVerification: "UNVERIFIED",
      validationStatus: stored.validationStatus === "SOURCE_VERIFIED" ? "DISCOVERED" : stored.validationStatus,
      sourceVerificationReceipt: undefined,
    });
  }

  /**
   * Bind news PIT status using only a source record resolved by this canonical persisted store.
   * The trust-bearing repository is the receiver, never a caller-supplied reader or record object.
   */
  public bindCryptoNewsResearchIntelligence(
    observation: CryptoNewsResearchObservation,
    sourceRecordId: string,
  ): CryptoNewsResearchObservation {
    if (!observation || typeof observation !== "object" || !text(sourceRecordId)) {
      throw new Error("NEWS_RESEARCH_INTELLIGENCE_BINDING_INVALID");
    }
    let record: ResearchIntelligenceRecord | null;
    let normalizedObservation: CryptoNewsResearchObservation;
    let reconstructedRecord: ResearchIntelligenceRecord;
    try {
      record = this.get(sourceRecordId);
      if (!record || record.recordId !== sourceRecordId) throw new Error("missing canonical source");
      reconstructedRecord = reconstructResearchIntelligenceRecord(record);
      normalizedObservation = createCryptoNewsResearchObservation(cryptoNewsInputFromObservation(observation));
    } catch {
      throw new Error("NEWS_RESEARCH_INTELLIGENCE_BINDING_INVALID");
    }
    const { observationIdentity, ...observationMaterial } = observation;
    const expectedContentFingerprint = digest({ sourceType: record.sourceType, sourceId: record.sourceId, sourceUrl: record.sourceUrl, rawContentSha256: record.rawContentSha256.toLowerCase() });
    const expectedRecordId = `ri:${digest({ sourceType: record.sourceType, sourceId: record.sourceId, contentFingerprint: expectedContentFingerprint })}`;
    const { observationIdentity: _normalizedIdentity, ...normalizedCore } = normalizedObservation;
    const expectedBoundCore = { ...normalizedCore, verificationStatus: "SOURCE_VERIFIED" as const, coverageStatus: "PIT_ELIGIBLE" as const, researchIntelligenceRecordId: expectedRecordId };
    const rawIdentityValid = observationIdentity === digest(normalizedCore) && observation.verificationStatus === "UNVERIFIED" && observation.coverageStatus === "UNKNOWN" && observation.researchIntelligenceRecordId === undefined;
    const boundIdentityValid = observationIdentity === digest(expectedBoundCore) && observation.verificationStatus === "SOURCE_VERIFIED" && observation.coverageStatus === "PIT_ELIGIBLE" && observation.researchIntelligenceRecordId === expectedRecordId;
    if (canonicalResearchJson(cryptoNewsInputFromObservation(observation)) !== canonicalResearchJson(cryptoNewsInputFromObservation(normalizedObservation))
      || (!rawIdentityValid && !boundIdentityValid)
      || observation.snapshotIntegrity !== "VERIFIED"
      || observation.schemaVersion !== 1
      || observation.materiality !== "OBSERVATION"
      || !["OBSERVATION", "UNKNOWN"].includes(observation.classification)
      || observation.authority !== "PAPER_ONLY"
      || observation.liveAuthority !== "NONE"
      || observation.productionMutationAllowed !== false
      || observation.aiAuthority !== "ZERO_AUTHORITY"
      || digest(reconstructedRecord) !== digest(record)
      || sha256(observation.contentSnapshot) !== observation.contentFingerprint.toLowerCase()
      || observation.publishedAt === "UNKNOWN"
      || observation.contentFingerprint !== record.rawContentSha256.toLowerCase()
      || observation.sourceUrl !== record.sourceUrl
      || observation.publishedAt !== record.publishedAt
      || record.contentFingerprint !== expectedContentFingerprint
      || record.recordId !== expectedRecordId
      || record.sourceVerification !== "VERIFIED_PRIMARY_SOURCE"
      || record.validationStatus !== "SOURCE_VERIFIED"
      || record.evidenceQuality === "INVALID"
      || record.novelty === "DUPLICATE"
      || record.authority !== "PAPER_ONLY"
      || record.liveAuthority !== "NONE"
      || record.productionMutationAllowed !== false
      || record.aiAuthority !== "ZERO_AUTHORITY"
      || !validTimestamp(record.publishedAt)
      || !validTimestamp(record.discoveredAt)
      || Date.parse(record.publishedAt) > Date.parse(record.discoveredAt)
      || Date.parse(record.discoveredAt) !== Date.parse(observation.firstObservedAt)
      || Date.parse(record.discoveredAt) > Date.parse(observation.retrievedAt)
      || Date.parse(observation.firstObservedAt) > Date.parse(observation.retrievedAt)
      || observation.sourceType === "SOCIAL"
      || observation.sourceType === "RUMOR") {
      throw new Error("NEWS_RESEARCH_INTELLIGENCE_BINDING_INVALID");
    }
    const core = { ...observationMaterial, verificationStatus: "SOURCE_VERIFIED" as const, coverageStatus: "PIT_ELIGIBLE" as const, researchIntelligenceRecordId: record.recordId };
    return Object.freeze({ ...core, observationIdentity: digest(core) });
  }

  /** Create a precommit only after this repository has resolved the PIT source record. */
  public cryptoNewsResearchPrecommit(
    observation: CryptoNewsResearchObservation,
    sourceRecordId: string,
    input: CryptoNewsHypothesisInput,
  ) {
    const verifiedObservation = this.bindCryptoNewsResearchIntelligence(observation, sourceRecordId);
    const { observationIdentity, ...observationMaterial } = verifiedObservation;
    if (!verifiedObservation || observationIdentity !== digest(observationMaterial) || verifiedObservation.scoutInferences.length === 0 || !validTimestamp(input.createdAt) || Date.parse(input.createdAt) < Date.parse(verifiedObservation.retrievedAt) || !knownText(input.validationPolicyIdentity) || !validateCryptoNewsPrecommitPlans(input.datasetBinding, input.evaluationPlan, input.costPlan)) throw new Error("NEWS_HYPOTHESIS_EVIDENCE_INELIGIBLE");
    const semanticInput = { observationIdentity, family: input.family, rationale: input.rationale, mechanism: input.mechanism, targetMarket: input.targetMarket, expectedRegime: input.expectedRegime, invalidationCondition: input.invalidationCondition, holdingPeriodMs: input.holdingPeriodMs, capacityAssumptions: input.capacityAssumptions, transactionCostSensitivity: input.transactionCostSensitivity };
    const base = digest(semanticInput);
    const hypothesis = createResearchHypothesis({ hypothesisId: `news-hypothesis-${base.slice(0, 48)}`, candidateId: `news-candidate-${base.slice(0, 48)}`, family: input.family, rationale: input.rationale, mechanism: input.mechanism, targetMarket: input.targetMarket, expectedRegime: input.expectedRegime, invalidationCondition: input.invalidationCondition, holdingPeriodMs: input.holdingPeriodMs, capacityAssumptions: input.capacityAssumptions, transactionCostSensitivity: input.transactionCostSensitivity, provenance: { author: "SCOUT_ADVISORY", sourceReferences: [verifiedObservation.sourceUrl, verifiedObservation.contentFingerprint, verifiedObservation.observationIdentity] }, createdAt: input.createdAt });
    const precommit = createResearchPrecommit({ schemaVersion: 1, experimentIdentity: digest({ hypothesisId: hypothesis.hypothesisId, observationIdentity, datasetBinding: input.datasetBinding, evaluationPlan: input.evaluationPlan, costPlan: input.costPlan }), candidateIdentity: hypothesis.candidateId, strategyIdentity: hypothesis.candidateId, datasetBinding: { ...input.datasetBinding, newsObservationIdentity: verifiedObservation.observationIdentity }, sourceSha: input.sourceSha, parameterPlan: { hypothesis, newsObservationIdentity: verifiedObservation.observationIdentity, researchIntelligenceRecordId: verifiedObservation.researchIntelligenceRecordId }, costPlan: input.costPlan, regimePlan: { expectedRegime: input.expectedRegime }, evaluationPlan: input.evaluationPlan, validationPolicyIdentity: input.validationPolicyIdentity, createdAt: input.createdAt });
    return Object.freeze({ classification: "RESEARCH_HYPOTHESIS_CANDIDATE" as const, hypothesis, precommit });
  }

  public append(record: ResearchIntelligenceRecord): ResearchIntelligenceRecord {
    if (!record || typeof record !== "object") throw new Error("research intelligence record is invalid");
    const trusted = record.sourceVerification === "VERIFIED_PRIMARY_SOURCE" || record.validationStatus === "SOURCE_VERIFIED";
    if (!validatePersistedResearchIntelligenceSourceReceiptIntegrity(record)
      || (trusted && !isResearchIntelligenceSourceRecordAuthenticated(record))) {
      throw new Error("research intelligence source verification is not authenticated");
    }
    const reconstructed = reconstructResearchIntelligenceRecord(record);
    if (canonicalResearchJson(reconstructed) !== canonicalResearchJson(record)) {
      throw new Error("research intelligence record is not canonical");
    }
    const persisted = this.db.transaction(() => {
      const existingRow = this.db.connection.prepare(
        "SELECT record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json FROM research_intelligence_records WHERE record_id = ?"
      ).get(record.recordId) as Record<string, unknown> | undefined;

      if (existingRow != null) {
        const existing = decode(existingRow);
        validateStoredRow(existingRow, existing);
        const sameCapturedSource = existing.sourceId === record.sourceId
          && existing.sourceType === record.sourceType
          && existing.sourceUrl === record.sourceUrl
          && existing.contentFingerprint === record.contentFingerprint
          && existing.rawContentSha256 === record.rawContentSha256
          && existing.sourceVerificationReceipt?.sourceEntryFingerprint === record.sourceVerificationReceipt?.sourceEntryFingerprint;
        if (!sameCapturedSource) {
          throw new Error("research intelligence record identity conflict");
        }
        return record;
      }

      this.db.connection.prepare(
        "INSERT INTO research_intelligence_records (record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        record.recordId,
        record.sourceId,
        record.sourceType,
        record.contentFingerprint,
        record.hypothesisSemanticFingerprint ?? "",
        record.discoveredAt,
        JSON.stringify(record),
      );

      this.semantic.appendSemantic({
        artifact: Object.freeze({
          artifactKind: "RESEARCH_INTELLIGENCE_RECORD" as const,
          artifactId: record.recordId,
          artifactContentSha256: researchMemoryArtifactDigestV1(record),
          artifactDigestKind: "CANONICAL_RESEARCH_INTELLIGENCE_SHA256_V1" as const,
        }),
        semanticClass: "OBSERVATION",
        validity: "REVALIDATION_REQUIRED",
        attribution: "MIXED_UNRESOLVED",
        evidenceOrigin:
          trusted
            ? "EXTERNAL_PRIMARY_SOURCE"
            : "UNKNOWN_UNTRUSTED",
        evaluatorSemanticsId: "research-intelligence-scout:v1",
        semanticIdentity: record.hypothesisSemanticFingerprint ?? record.contentFingerprint,
        independenceGroupId: record.sourceType + ":" + record.sourceId,
        actor: "research-intelligence-scout",
        source: record.sourceUrl,
        reason:
          "External research discovery retained for longitudinal deduplication; it is not canonical NUSA empirical evidence.",
        occurredAt: record.discoveredAt,
        authority: "PAPER_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });

      return record;
    });
    if (trusted) this.authenticatedThisProcess.set(record.recordId, record);
    return persisted;
  }
}
