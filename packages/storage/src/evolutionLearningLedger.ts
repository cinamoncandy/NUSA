import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EvolutionLearningRecord } from "../../../apps/autopilot/src/evolveLearningMemory";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";
import { SqlitePersistedPaperPeriodStore } from "./persistedPaperPeriodStore";
import { SqliteResearchFactoryDecisionHistoryRepository } from "./researchFactoryDecisionHistoryRepository";

const SCHEMA_VERSION = 1 as const;
const GENESIS_HASH = "0".repeat(64);
export const MAX_EVOLUTION_LEARNING_LEDGER_RECORDS = 4_096;
const MAX_RECORDS = MAX_EVOLUTION_LEARNING_LEDGER_RECORDS;
const MAX_HYPOTHESIS_BYTES = 16_384;
const OUTCOMES = new Set<EvolutionLearningRecord["outcome"]>([
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "UNDERPERFORMED",
  "FAILED",
  "REGRESSION",
  "UNKNOWN",
]);
const REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LEARNING_INPUT_SET_ID = /^learning-input-set:([a-f0-9]{64})$/;
const LEARNING_INPUT_SET_FIELDS = new Set([
  "schemaVersion", "cutoffTimestamp", "researchEvidenceRecordIds", "researchEvidenceObservedAt",
  "paperEvidenceRecordIds", "paperEvidenceObservedAt", "researchLaneDigest", "performanceLaneDigest",
  "learningPolicyVersion", "researchPolicyVersion", "riskPolicyVersion", "governancePolicyVersion",
  "canonicalOrderingVersion",
]);
const LEARNING_DECISION_ID = /^learning-decision(?::|-cycle-v1:)([a-f0-9]{64})$/;
const LEARNING_APPLICATION_INTENT_ID = /^learning-application-intent:([a-f0-9]{64})$/;
const LEARNING_APPLICATION_ID = /^learning-application:([a-f0-9]{64})$/;
const LEARNING_INPUT_SET_PROBLEM = "NUSA learning input set: the exact evidence a Learning Decision was built from";
const LEARNING_INPUT_SET_LEGACY_STATUS = "LEARNING_INPUT_SET";
const LEARNING_INPUT_SET_AUTHORIZED_STATUS = "LEARNING_INPUT_SET_AUTHORITY_VERIFIED";
const LEARNING_DECISION_PROBLEM = "NUSA learning decision: the bounded conclusion drawn from one learning input set";
const LEARNING_DECISION_FIELDS = new Set([
  "schemaVersion", "learningCycleId", "learningInputSet", "learningInputSetFingerprint", "previousResearchSpecFingerprint",
  "learningPolicyVersion", "objectiveVersion", "proposedChanges", "admissibleChanges", "rejectedChanges",
  "reasonEvidence", "changeMagnitude", "allowedSurfaceVersion", "immutableSurfaceVersion", "decisionOutcome",
  "createdAt", "sourceCommit", "runtimeIdentity",
]);
// The immediately preceding A1 writer deliberately stored only the durable A2 identity and
// resolved the full input set on replay. Keep accepting exactly that canonical historical shape
// while rebuilding reservations; new A1 appends must still satisfy the stronger embedded-A2 check.
const LEGACY_LEARNING_DECISION_FIELDS = new Set([...LEARNING_DECISION_FIELDS].filter((field) => field !== "learningInputSet"));
const LEARNING_DECISION_CHANGE_FIELDS = new Set([
  "surface", "currentValue", "proposedValue", "minimum", "maximum", "maximumDeltaPerCycle", "verdict", "reason",
]);
const LEARNING_DECISION_IMMUTABLE_SURFACES = new Set([
  "PAPER_ONLY", "liveAuthority", "productionMutationAllowed", "aiAuthority", "aiDecisionAuthority",
  "minimumSample", "minimumSampleSize", "oosWindow", "oosRatio", "walkForward", "purge", "embargo",
  "costGate", "costCompleteness", "leakageRules", "governance", "releaseAuthority", "brokerAuthority",
  "orderAuthority", "withdrawalAuthority",
]);
const LEARNING_DECISION_IMMUTABLE_PREFIXES = ["risk", "qualification", "governance", "release", "live", "broker", "order"] as const;
const LEARNING_POLICY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LEARNING_BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const LEARNING_REASON_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;
const FORBIDDEN_KEY = /(?:password|authorization|cookie|credential|secret|token|nonce|signature|private|access[_-]?key)/i;
const FORBIDDEN_VALUE = /(?:bearer\s+[A-Za-z0-9._-]+|(?:api|access|secret|private)[_-]?key\s*[:=]|-----BEGIN|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/i;
const FIELDS = new Set([
  "opportunityId",
  "problem",
  "evidenceReferences",
  "hypothesis",
  "changeReference",
  "validationStatus",
  "outcome",
  "failureReason",
  "rollbackReference",
  "reusable",
  "recordedAt",
]);

export interface EvolutionLearningLedgerDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

export interface EvolutionLearningLedgerReplay {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly records: readonly EvolutionLearningRecord[];
  readonly eventCount: number;
  readonly headHash: string;
}

export class EvolutionLearningLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EvolutionLearningLedgerError";
  }
}

interface LedgerMetaRow {
  schema_version: number | bigint;
  event_count: number | bigint;
  ledger_hash: string;
}

interface LedgerEventRow {
  sequence: number | bigint;
  opportunity_id: string;
  content_hash: string;
  payload_json: string;
  recorded_at: string;
  previous_hash: string;
  event_hash: string;
}

function invalid(code: string, message: string): never {
  throw new EvolutionLearningLedgerError(code, `${code}: ${message}`);
}

/** Stable code-unit ordering shared with canonical Learning input identities. */
function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown, field: string, maximum: number, maximumBytes?: number): string {
  if (typeof value !== "string") invalid("INVALID_RECORD", `${field} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || (maximumBytes !== undefined && Buffer.byteLength(normalized, "utf8") > maximumBytes) || FORBIDDEN_VALUE.test(normalized)) invalid("INVALID_RECORD", `${field} is invalid`);
  return normalized;
}

function nullableText(value: unknown, field: string, maximum: number): string | null {
  if (value == null) return null;
  return text(value, field, maximum);
}

function recordedAt(value: unknown): string {
  const normalized = text(value, "recordedAt", 40);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) invalid("INVALID_RECORD", "recordedAt must be an ISO timestamp");
  return new Date(timestamp).toISOString();
}

function normalize(value: EvolutionLearningRecord): EvolutionLearningRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value)) invalid("INVALID_RECORD", "learning record must be an object");
  const candidate = value as unknown as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!FIELDS.has(key) || FORBIDDEN_KEY.test(key)) invalid("FORBIDDEN_FIELD", "learning record contains a forbidden field");
  }
  const opportunityId = text(candidate.opportunityId, "opportunityId", 160);
  const problem = text(candidate.problem, "problem", 2_000);
  if (!Array.isArray(candidate.evidenceReferences) || candidate.evidenceReferences.length === 0) invalid("EVIDENCE_REQUIRED", "learning evidence is required");
  const evidenceReferences = candidate.evidenceReferences.map((reference) => {
    const normalized = text(reference, "evidenceReference", 240);
    if (!REFERENCE.test(normalized)) invalid("INVALID_EVIDENCE_REFERENCE", "learning evidence reference is invalid");
    return normalized;
  });
  const uniqueEvidenceReferences = [...new Set(evidenceReferences)].sort(compareCanonicalStrings);
  if (uniqueEvidenceReferences.length === 0) invalid("EVIDENCE_REQUIRED", "learning evidence is required");
  const hypothesis = text(candidate.hypothesis, "hypothesis", MAX_HYPOTHESIS_BYTES, MAX_HYPOTHESIS_BYTES);
  const changeReference = text(candidate.changeReference, "changeReference", 240);
  const validationStatus = text(candidate.validationStatus, "validationStatus", 80);
  if (typeof candidate.outcome !== "string" || !OUTCOMES.has(candidate.outcome as EvolutionLearningRecord["outcome"])) invalid("INVALID_RECORD", "learning outcome is invalid");
  if (typeof candidate.reusable !== "boolean") invalid("INVALID_RECORD", "learning reusable flag is invalid");
  const failureReason = nullableText(candidate.failureReason, "failureReason", 1_000);
  const rollbackReference = nullableText(candidate.rollbackReference, "rollbackReference", 240);
  return Object.freeze({
    opportunityId,
    problem,
    evidenceReferences: Object.freeze(uniqueEvidenceReferences),
    hypothesis,
    changeReference,
    validationStatus,
    outcome: candidate.outcome as EvolutionLearningRecord["outcome"],
    failureReason,
    rollbackReference,
    reusable: candidate.reusable,
    recordedAt: recordedAt(candidate.recordedAt),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Re-derive an A1 assessment at the storage boundary; array/object shape alone is not authority. */
function canonicalLearningChangeAssessment(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const change = value as Record<string, unknown>;
  if (Object.keys(change).some((key) => !LEARNING_DECISION_CHANGE_FIELDS.has(key))
    || typeof change.surface !== "string" || !LEARNING_BOUNDED_ID.test(change.surface)
    || typeof change.currentValue !== "number" || !Number.isFinite(change.currentValue)
    || typeof change.proposedValue !== "number" || !Number.isFinite(change.proposedValue)) return null;

  const surface = change.surface;
  const currentValue = change.currentValue;
  const proposedValue = change.proposedValue;
  const immutable = LEARNING_DECISION_IMMUTABLE_SURFACES.has(surface)
    || LEARNING_DECISION_IMMUTABLE_PREFIXES.some((prefix) => surface.toLowerCase().startsWith(prefix));
  let expected: Record<string, unknown>;
  if (immutable) {
    expected = { surface, currentValue, proposedValue, verdict: "REJECTED", reason: "immutable surface: no learning decision may move it, whatever the evidence" };
  } else if (surface !== "longBarTickEvery") {
    expected = { surface, currentValue, proposedValue, verdict: "REJECTED", reason: "surface is not on the owner allowlist: learning may not invent a mutable field" };
  } else {
    const bounds = { minimum: 1, maximum: 4, maximumDeltaPerCycle: 1 };
    if (!Number.isSafeInteger(currentValue) || !Number.isSafeInteger(proposedValue)) {
      expected = { surface, currentValue, proposedValue, ...bounds, verdict: "REJECTED", reason: "cadence values must be safe integers" };
    } else if (currentValue < bounds.minimum || currentValue > bounds.maximum) {
      expected = { surface, currentValue, proposedValue, ...bounds, verdict: "REJECTED", reason: "current value is outside the owner bounds" };
    } else if (proposedValue < bounds.minimum || proposedValue > bounds.maximum) {
      expected = { surface, currentValue, proposedValue, ...bounds, verdict: "REJECTED", reason: "proposed value is outside the owner bounds" };
    } else if (Math.abs(proposedValue - currentValue) > bounds.maximumDeltaPerCycle) {
      expected = { surface, currentValue, proposedValue, ...bounds, verdict: "REJECTED", reason: "step exceeds the maximum delta allowed in one cycle" };
    } else if (proposedValue === currentValue) {
      expected = { surface, currentValue, proposedValue, ...bounds, verdict: "REJECTED", reason: "proposal does not change the current value" };
    } else {
      expected = { surface, currentValue, proposedValue, ...bounds, verdict: "ADMISSIBLE", reason: "within the owner-defined aperture for one cycle" };
    }
  }
  return canonicalResearchJson(change) === canonicalResearchJson(expected) ? expected : null;
}

function contentHash(record: EvolutionLearningRecord): string {
  return sha256(canonicalResearchJson(record));
}

function hashValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) invalid("CORRUPTED_LEDGER", `${field} is not a SHA-256 hash`);
  return value.toLowerCase();
}

function safeInteger(value: unknown, field: string): number {
  const normalized = typeof value === "bigint" ? Number(value) : value;
  if (typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 0) invalid("CORRUPTED_LEDGER", `${field} is invalid`);
  return normalized;
}

function canonicalEvent(sequence: number, record: EvolutionLearningRecord, previousHash: string): string {
  return canonicalResearchJson({
    schemaVersion: SCHEMA_VERSION,
    sequence,
    opportunityId: record.opportunityId,
    contentHash: contentHash(record),
    payload: record,
    recordedAt: record.recordedAt,
    previousHash,
  });
}

/**
 * A durable A2 input set is a promise that one matching A1 decision may follow. Keep capacity for
 * every unresolved pair inside the same serialized append boundary, so an unrelated ledger writer
 * cannot consume the last slot between the A2 and A1 appends. These are existing record identities;
 * no second reservation store or mutable history is introduced.
 */
function canonicalLearningDecisionForReservation(record: EvolutionLearningRecord, fingerprint: string, inputSetPayload: string): boolean {
  if (record.validationStatus !== "LEARNING_DECISION" || record.problem !== LEARNING_DECISION_PROBLEM
    || record.outcome !== "SUCCESS" || record.failureReason !== null || record.rollbackReference !== null || record.reusable !== true) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(record.hypothesis);
  } catch {
    return false;
  }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return false;
  const decision = payload as Record<string, unknown>;
  if (Object.keys(decision).length !== LEARNING_DECISION_FIELDS.size || Object.keys(decision).some((key) => !LEARNING_DECISION_FIELDS.has(key))
    || canonicalResearchJson(decision) !== record.hypothesis
    || decision.schemaVersion !== 1
    || decision.learningInputSetFingerprint !== fingerprint
    || decision.learningInputSet == null || typeof decision.learningInputSet !== "object" || Array.isArray(decision.learningInputSet)
    || canonicalResearchJson(decision.learningInputSet) !== inputSetPayload
    || decision.learningCycleId !== `learning-cycle:${fingerprint}`
    || (record.opportunityId !== `learning-decision-cycle-v1:${sha256(decision.learningCycleId as string)}`
      && record.opportunityId !== `learning-decision:${sha256(record.hypothesis)}`)
    || record.changeReference !== decision.learningPolicyVersion
    || !SHA256.test(decision.previousResearchSpecFingerprint as string)
    || typeof decision.learningPolicyVersion !== "string" || !LEARNING_POLICY_ID.test(decision.learningPolicyVersion)
    || typeof decision.objectiveVersion !== "string" || !LEARNING_BOUNDED_ID.test(decision.objectiveVersion)
    || typeof decision.createdAt !== "string" || !LEARNING_BOUNDED_ID.test(decision.createdAt)
    || typeof decision.sourceCommit !== "string" || !LEARNING_BOUNDED_ID.test(decision.sourceCommit)
    || typeof decision.runtimeIdentity !== "string" || !LEARNING_BOUNDED_ID.test(decision.runtimeIdentity)
    || decision.allowedSurfaceVersion !== "learning-allowed-surface-v1"
    || decision.immutableSurfaceVersion !== "learning-immutable-surface-v1"
    || !["ADMISSIBLE", "REJECTED", "INSUFFICIENT"].includes(decision.decisionOutcome as string)
    || typeof decision.changeMagnitude !== "number" || !Number.isFinite(decision.changeMagnitude) || decision.changeMagnitude < 0
    || !Array.isArray(decision.proposedChanges) || decision.proposedChanges.length > 32
    || !Array.isArray(decision.admissibleChanges) || !Array.isArray(decision.rejectedChanges)
    || !Array.isArray(decision.reasonEvidence) || decision.reasonEvidence.length > 64) return false;
  const proposedChanges: Record<string, unknown>[] = [];
  for (const item of decision.proposedChanges) {
    const assessment = canonicalLearningChangeAssessment(item);
    if (assessment == null) return false;
    proposedChanges.push(assessment);
  }
  const canonicalOrder = [...proposedChanges].sort((left, right) => compareCanonicalStrings(left.surface as string, right.surface as string)
    || (left.currentValue as number) - (right.currentValue as number)
    || (left.proposedValue as number) - (right.proposedValue as number));
  if (canonicalResearchJson(proposedChanges) !== canonicalResearchJson(canonicalOrder)
    || new Set(proposedChanges.map((change) => change.surface)).size !== proposedChanges.length) return false;
  const admissibleChanges = proposedChanges.filter((change) => change.verdict === "ADMISSIBLE");
  const rejectedChanges = proposedChanges.filter((change) => change.verdict === "REJECTED");
  if (canonicalResearchJson(admissibleChanges) !== canonicalResearchJson(decision.admissibleChanges)
    || canonicalResearchJson(rejectedChanges) !== canonicalResearchJson(decision.rejectedChanges)) return false;
  const expectedMagnitude = admissibleChanges.reduce((largest, change) => Math.max(largest, Math.abs((change.proposedValue as number) - (change.currentValue as number))), 0);
  const expectedOutcome = admissibleChanges.length > 0 ? "ADMISSIBLE" : proposedChanges.length > 0 ? "REJECTED" : "INSUFFICIENT";
  if (decision.changeMagnitude !== expectedMagnitude || decision.decisionOutcome !== expectedOutcome) return false;
  const reasons = decision.reasonEvidence as unknown[];
  if (reasons.some((item, index) => typeof item !== "string" || !LEARNING_REASON_REFERENCE.test(item) || (index > 0 && item <= (reasons[index - 1] as string)))) return false;
  const expectedReferences = [record.opportunityId, fingerprint, ...(reasons as string[])].sort(compareCanonicalStrings);
  return record.evidenceReferences.length === expectedReferences.length
    && record.evidenceReferences.every((reference, index) => reference === expectedReferences[index]);
}

function canonicalLegacyLearningDecisionForReservation(record: EvolutionLearningRecord, fingerprint: string, inputSetPayload: string): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(record.hypothesis);
  } catch {
    return false;
  }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return false;
  const decision = payload as Record<string, unknown>;
  if (Object.keys(decision).length !== LEGACY_LEARNING_DECISION_FIELDS.size
    || Object.keys(decision).some((key) => !LEGACY_LEARNING_DECISION_FIELDS.has(key))
    || Object.prototype.hasOwnProperty.call(decision, "learningInputSet")
    || canonicalResearchJson(decision) !== record.hypothesis
    || decision.learningInputSetFingerprint !== fingerprint) return false;

  let inputSet: unknown;
  try {
    inputSet = JSON.parse(inputSetPayload);
  } catch {
    return false;
  }
  // Upgrade the historical payload only in memory, then run it through the same full provenance,
  // identity, policy, and evidence-reference checks used for newly written A1 receipts.
  const upgraded = { ...decision, learningInputSet: inputSet };
  const upgradedRecord = { ...record, hypothesis: canonicalResearchJson(upgraded) };
  return canonicalLearningDecisionForReservation(upgradedRecord, fingerprint, inputSetPayload);
}

function canonicalLearningInputSetForReservation(record: EvolutionLearningRecord, fingerprint: string): boolean {
  if ((record.validationStatus !== LEARNING_INPUT_SET_LEGACY_STATUS && record.validationStatus !== LEARNING_INPUT_SET_AUTHORIZED_STATUS) || record.problem !== LEARNING_INPUT_SET_PROBLEM
    || record.outcome !== "SUCCESS" || record.failureReason !== null || record.rollbackReference !== null || record.reusable !== true) return false;
  let payload: unknown;
  try { payload = JSON.parse(record.hypothesis); } catch { return false; }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return false;
  const input = payload as Record<string, unknown>;
  if (Object.keys(input).length !== LEARNING_INPUT_SET_FIELDS.size
    || Object.keys(input).some((key) => !LEARNING_INPUT_SET_FIELDS.has(key))
    || canonicalResearchJson(input) !== record.hypothesis
    || input.schemaVersion !== 1
    || input.canonicalOrderingVersion !== "learning-input-set-canonical-order-v2"
    || !Number.isSafeInteger(input.cutoffTimestamp) || (input.cutoffTimestamp as number) < 0
    || record.opportunityId !== `learning-input-set:${fingerprint}`
    || record.changeReference !== input.learningPolicyVersion) return false;
  const lanes = [
    { name: "research", ids: input.researchEvidenceRecordIds, observed: input.researchEvidenceObservedAt, digest: input.researchLaneDigest },
    { name: "performance", ids: input.paperEvidenceRecordIds, observed: input.paperEvidenceObservedAt, digest: input.performanceLaneDigest },
  ];
  const allIds = new Set<string>();
  for (const lane of lanes) {
    if (!Array.isArray(lane.ids) || !Array.isArray(lane.observed) || lane.ids.length !== lane.observed.length || !SHA256.test(lane.digest as string)) return false;
    let previous = "";
    for (let index = 0; index < lane.ids.length; index += 1) {
      const id = lane.ids[index];
      const observed = lane.observed[index];
      if (typeof id !== "string" || id.trim().length === 0 || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)
        || (index > 0 && id <= previous) || allIds.has(id)
        || !Number.isSafeInteger(observed) || (observed as number) < 0 || (observed as number) >= (input.cutoffTimestamp as number)) return false;
      if (lane.name === "performance" && (id.length > 227 || !/^[A-Za-z0-9_.:/#@-]+$/.test(id))) return false;
      allIds.add(id); previous = id;
    }
    const expectedDigest = sha256(canonicalResearchJson({ lane: lane.name === "research" ? "research" : "performance", recordIds: lane.ids, observedAt: lane.observed }));
    if (lane.digest !== expectedDigest) return false;
  }
  if (allIds.size === 0 || allIds.size > 512) return false;
  for (const field of ["learningPolicyVersion", "researchPolicyVersion", "riskPolicyVersion", "governancePolicyVersion"] as const) {
    if (typeof input[field] !== "string" || !LEARNING_POLICY_ID.test(input[field] as string)) return false;
  }
  if (sha256(canonicalResearchJson(input)) !== fingerprint) return false;
  const expectedReferences = [record.opportunityId, ...(input.paperEvidenceRecordIds as string[]).map((id) => `paper-period:${id}`)]
    .sort(compareCanonicalStrings);
  return record.evidenceReferences.length === expectedReferences.length
    && record.evidenceReferences.every((reference, index) => reference === expectedReferences[index]);
}

function isLearningInputSetCandidate(record: EvolutionLearningRecord): boolean {
  return record.opportunityId.startsWith("learning-input-set:")
    || record.validationStatus === LEARNING_INPUT_SET_LEGACY_STATUS
    || record.validationStatus === LEARNING_INPUT_SET_AUTHORIZED_STATUS
    || record.problem === LEARNING_INPUT_SET_PROBLEM;
}

function canonicalLearningInputSetEvidenceVerifier(db: EvolutionLearningLedgerDatabase): (inputSet: Record<string, unknown>) => boolean {
  // These are the existing canonical, integrity-checking readers. PAPER uses its read-only path so
  // ledger startup cannot introduce schema writes after recovery evidence has been prepared.
  const research = new Map(new SqliteResearchFactoryDecisionHistoryRepository(db).list().map((item) => [item.evaluationId, item.observedAt]));
  const paper = new Map(SqlitePersistedPaperPeriodStore.readRecords(db).map((item) => [item.recordId, item.periodEndAt]));
  return (inputSet) => {
    const researchIds = inputSet.researchEvidenceRecordIds as unknown[];
    const researchAt = inputSet.researchEvidenceObservedAt as unknown[];
    const paperIds = inputSet.paperEvidenceRecordIds as unknown[];
    const paperAt = inputSet.paperEvidenceObservedAt as unknown[];
    return researchIds.every((id, index) => research.get(id as string) === researchAt[index])
      && paperIds.every((id, index) => paper.get(id as string) === paperAt[index]);
  };
}

function hasVerifiedLearningInputSetAuthority(
  record: EvolutionLearningRecord,
  fingerprint: string,
  verify: (inputSet: Record<string, unknown>) => boolean,
): boolean {
  if (!canonicalLearningInputSetForReservation(record, fingerprint)) return false;
  try {
    return verify(JSON.parse(record.hypothesis) as Record<string, unknown>);
  } catch {
    return false;
  }
}

function isLearningDecisionCandidate(record: EvolutionLearningRecord): boolean {
  return record.validationStatus === "LEARNING_DECISION" || record.problem === LEARNING_DECISION_PROBLEM || LEARNING_DECISION_ID.test(record.opportunityId);
}

function pendingLearningDecisionFingerprints(records: readonly EvolutionLearningRecord[], verify: (inputSet: Record<string, unknown>) => boolean): Map<string, string> {
  const pending = new Map<string, string>();
  for (const record of records) {
    if (isLearningInputSetCandidate(record)) {
      const match = LEARNING_INPUT_SET_ID.exec(record.opportunityId);
      if (match != null && hasVerifiedLearningInputSetAuthority(record, match[1], verify)) pending.set(match[1], record.hypothesis);
      continue;
    }
    if (isLearningDecisionCandidate(record)) {
      const matchingReservations = record.evidenceReferences.filter((reference) => pending.has(reference));
      if (matchingReservations.length === 1) {
        const fingerprint = matchingReservations[0];
        const inputSetPayload = pending.get(fingerprint)!;
        if (canonicalLearningDecisionForReservation(record, fingerprint, inputSetPayload)
          || canonicalLegacyLearningDecisionForReservation(record, fingerprint, inputSetPayload)) pending.delete(fingerprint);
      }
    }
  }
  return pending;
}

function pendingReservationsAfterAppend(
  pending: Map<string, string>,
  record: EvolutionLearningRecord,
  verify: (inputSet: Record<string, unknown>) => boolean,
): Map<string, string> {
  const next = new Map(pending);
  if (isLearningInputSetCandidate(record)) {
    const match = LEARNING_INPUT_SET_ID.exec(record.opportunityId);
    if (match != null && hasVerifiedLearningInputSetAuthority(record, match[1], verify)) next.set(match[1], record.hypothesis);
  }
  if (isLearningDecisionCandidate(record)) {
    const matchingReservations = record.evidenceReferences.filter((reference) => next.has(reference));
    if (matchingReservations.length === 1) {
      const fingerprint = matchingReservations[0];
      const inputSetPayload = next.get(fingerprint)!;
      if (canonicalLearningDecisionForReservation(record, fingerprint, inputSetPayload)
        || canonicalLegacyLearningDecisionForReservation(record, fingerprint, inputSetPayload)) next.delete(fingerprint);
    }
  }
  return next;
}

/**
 * An A4 write-ahead intent promises one terminal receipt. Keep that slot reserved in the same
 * append boundary as A2's input/decision reservation so unrelated writers cannot strand a
 * completed runtime mutation without durable terminal evidence.
 */
function pendingLearningApplicationIntents(records: readonly EvolutionLearningRecord[]): Map<string, Record<string, unknown>> {
  const pending = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const intentMatch = LEARNING_APPLICATION_INTENT_ID.exec(record.opportunityId);
    if (record.validationStatus === "LEARNING_APPLICATION_INTENT" || intentMatch != null) {
      if (intentMatch == null || record.validationStatus !== "LEARNING_APPLICATION_INTENT") continue;
      let parsed: unknown;
      try { parsed = JSON.parse(record.hypothesis); } catch { invalid("INVALID_LEARNING_APPLICATION_INTENT", "application intent payload is malformed"); }
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) invalid("INVALID_LEARNING_APPLICATION_INTENT", "application intent payload is not an object");
      const intent = parsed as Record<string, unknown>;
      const { schemaVersion, intentFingerprint, ...content } = intent;
      const expectedKeys = ["schemaVersion", "learningDecisionFingerprint", "learningCycleId", "previousResearchSpecFingerprint", "surface", "previousValue", "requestedValue", "boundedValue", "applicationTimestamp", "runtimeIdentity", "sourceCommit", "intentFingerprint"].sort();
      if (Object.keys(intent).sort().join("|") !== expectedKeys.join("|") || schemaVersion !== 1
        || intentFingerprint !== intentMatch[1] || sha256(canonicalResearchJson(content)) !== intentMatch[1]
        || !SHA256.test(intent.learningDecisionFingerprint as string) || !/^learning-cycle:[a-f0-9]{64}$/.test(intent.learningCycleId as string)
        || !SHA256.test(intent.previousResearchSpecFingerprint as string)
        || typeof intent.surface !== "string" || !LEARNING_BOUNDED_ID.test(intent.surface)
        || ![intent.previousValue, intent.requestedValue, intent.boundedValue].every((value) => typeof value === "number" && Number.isSafeInteger(value))
        || ![intent.applicationTimestamp, intent.runtimeIdentity, intent.sourceCommit].every((value) => typeof value === "string" && LEARNING_BOUNDED_ID.test(value))) {
        invalid("INVALID_LEARNING_APPLICATION_INTENT", "application intent identity or fields are invalid");
      }
      const references = [record.opportunityId, intent.learningDecisionFingerprint as string, intent.learningCycleId as string, intent.previousResearchSpecFingerprint as string].sort();
      if (record.problem !== "NUSA learning application write-ahead intent: bounded state change planned before mutation"
        || record.outcome !== "SUCCESS" || record.failureReason !== null || record.rollbackReference !== null || record.reusable !== true
        || record.evidenceReferences.length !== references.length || record.evidenceReferences.some((reference, index) => reference !== references[index])) {
        invalid("INVALID_LEARNING_APPLICATION_INTENT", "application intent record metadata is invalid");
      }
      pending.set(intentMatch[1], intent);
      continue;
    }

    const terminalMatch = LEARNING_APPLICATION_ID.exec(record.opportunityId);
    if (terminalMatch == null || record.validationStatus !== "LEARNING_APPLICATION") continue;
    let parsed: unknown;
    try { parsed = JSON.parse(record.hypothesis); } catch { continue; }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const receipt = parsed as Record<string, unknown>;
    if (!["APPLIED", "NOOP", "FAILED"].includes(receipt.applicationOutcome as string)) continue;
    const { schemaVersion: receiptSchema, outcomeVersion, applicationFingerprint } = receipt;
    const expectedReceiptKeys = ["schemaVersion", "learningDecisionFingerprint", "learningCycleId", "previousResearchSpecFingerprint", "intentFingerprint", "surface", "previousValue", "requestedValue", "boundedValue", "appliedValue", "applicationOutcome", "applicationFingerprint", "applicationTimestamp", "runtimeIdentity", "sourceCommit", "outcomeVersion", ...(Object.hasOwn(receipt, "fallbackReason") ? ["fallbackReason"] : []), ...(Object.hasOwn(receipt, "rejectionReason") ? ["rejectionReason"] : [])].sort();
    const receiptDigest = sha256(canonicalResearchJson({
      learningDecisionFingerprint: receipt.learningDecisionFingerprint,
      learningCycleId: receipt.learningCycleId,
      previousResearchSpecFingerprint: receipt.previousResearchSpecFingerprint,
      intentFingerprint: receipt.intentFingerprint,
      surface: receipt.surface,
      previousValue: receipt.previousValue,
      requestedValue: receipt.requestedValue,
      boundedValue: receipt.boundedValue,
      appliedValue: receipt.appliedValue,
      applicationOutcome: receipt.applicationOutcome,
      fallbackReason: receipt.fallbackReason ?? null,
      rejectionReason: receipt.rejectionReason ?? null,
      applicationTimestamp: receipt.applicationTimestamp,
      runtimeIdentity: receipt.runtimeIdentity,
      sourceCommit: receipt.sourceCommit,
    }));
    if (receiptSchema !== 1 || outcomeVersion !== "learning-application-outcome-v1"
      || Object.keys(receipt).sort().join("|") !== expectedReceiptKeys.join("|")
      || applicationFingerprint !== terminalMatch[1] || receiptDigest !== terminalMatch[1]
      || ![receipt.learningDecisionFingerprint, receipt.previousResearchSpecFingerprint, receipt.intentFingerprint].every((value) => typeof value === "string" && SHA256.test(value))) continue;
    const intent = pending.get(receipt.intentFingerprint as string);
    if (intent == null) continue;
    if (receipt.learningDecisionFingerprint !== intent.learningDecisionFingerprint || receipt.learningCycleId !== intent.learningCycleId
      || receipt.previousResearchSpecFingerprint !== intent.previousResearchSpecFingerprint || receipt.surface !== intent.surface
      || receipt.previousValue !== intent.previousValue || receipt.requestedValue !== intent.requestedValue || receipt.boundedValue !== intent.boundedValue) continue;
    const refs = [record.opportunityId, receipt.learningDecisionFingerprint as string, receipt.learningCycleId as string].sort();
    if (record.problem !== "NUSA learning application: one admitted decision change bounded and applied exactly once"
      || record.outcome !== "SUCCESS" || record.rollbackReference !== null || record.reusable !== true
      || record.evidenceReferences.length !== refs.length || record.evidenceReferences.some((reference, index) => reference !== refs[index])) continue;
    pending.delete(receipt.intentFingerprint as string);
  }
  return pending;
}

function eventHash(sequence: number, record: EvolutionLearningRecord, previousHash: string): string {
  return sha256(canonicalEvent(sequence, record, previousHash));
}

function parsePayload(payload: unknown): EvolutionLearningRecord {
  if (typeof payload !== "string") invalid("CORRUPTED_LEDGER", "learning payload is not text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    invalid("CORRUPTED_LEDGER", "learning payload is not valid JSON");
  }
  let normalized: EvolutionLearningRecord;
  try {
    normalized = normalize(parsed as EvolutionLearningRecord);
  } catch {
    invalid("CORRUPTED_LEDGER", "learning payload failed validation");
  }
  if (canonicalResearchJson(normalized) !== payload) invalid("CORRUPTED_LEDGER", "learning payload is not canonical");
  return normalized;
}

function readMeta(connection: EvolutionLearningLedgerDatabase["connection"]): { readonly eventCount: number; readonly ledgerHash: string } {
  const row = connection.prepare("SELECT schema_version, event_count, ledger_hash FROM evolution_learning_ledger_meta WHERE id = 1").get() as LedgerMetaRow | undefined;
  if (row == null) invalid("CORRUPTED_LEDGER", "learning ledger metadata is missing");
  if (safeInteger(row.schema_version, "schemaVersion") !== SCHEMA_VERSION) invalid("UNSUPPORTED_SCHEMA", "learning ledger schema is unsupported");
  return Object.freeze({ eventCount: safeInteger(row.event_count, "eventCount"), ledgerHash: hashValue(row.ledger_hash, "ledgerHash") });
}

export class SqliteEvolutionLearningLedger {
  private readonly maximumRecords: number;
  private cached: EvolutionLearningLedgerReplay;

  public constructor(
    private readonly db: EvolutionLearningLedgerDatabase,
    maximumRecords = MAX_RECORDS,
  ) {
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > MAX_RECORDS) invalid("INVALID_RETENTION", "learning ledger capacity is invalid");
    this.maximumRecords = maximumRecords;
    this.cached = this.replay();
  }

  public append(value: EvolutionLearningRecord): EvolutionLearningRecord {
    return this.appendWithResult(value).record;
  }

  /** Atomic identity acquisition for callers whose side effect must have one durable winner. */
  public appendWithResult(value: EvolutionLearningRecord): { readonly record: EvolutionLearningRecord; readonly inserted: boolean } {
    const record = normalize(value);
    return this.db.transaction(() => {
      const current = this.replay();
      const a2Candidate = isLearningInputSetCandidate(record);
      const a2Match = LEARNING_INPUT_SET_ID.exec(record.opportunityId);
      const hasStoredA2Candidate = current.records.some(isLearningInputSetCandidate);
      let verifyInputSet: (inputSet: Record<string, unknown>) => boolean = () => false;
      if (a2Candidate || hasStoredA2Candidate) {
        try {
          verifyInputSet = canonicalLearningInputSetEvidenceVerifier(this.db);
        } catch {
          if (!a2Candidate) invalid("LEARNING_INPUT_AUTHORITY_UNAVAILABLE", "durable A2 reservations cannot be reconstructed while canonical evidence readers are unavailable");
        }
      }
      if (a2Candidate && (record.validationStatus !== LEARNING_INPUT_SET_AUTHORIZED_STATUS || a2Match == null
        || !hasVerifiedLearningInputSetAuthority(record, a2Match[1], verifyInputSet))) {
        invalid("UNVERIFIED_LEARNING_INPUT_SET", "A2-shaped records require canonical durable Research/PAPER authority before append or reservation");
      }
      const existing = current.records.find((item) => item.opportunityId === record.opportunityId);
      if (existing != null) {
        if (contentHash(existing) !== contentHash(record)) invalid("IDENTITY_CONFLICT", "learning opportunity was reused with different evidence");
        return Object.freeze({ record: existing, inserted: false });
      }
      const pendingReservations = pendingLearningDecisionFingerprints(current.records, verifyInputSet);
      if (isLearningDecisionCandidate(record)) {
        const matchingReservations = record.evidenceReferences.filter((reference) => pendingReservations.has(reference));
        const fingerprint = matchingReservations[0];
        const inputSetPayload = fingerprint == null ? undefined : pendingReservations.get(fingerprint);
        if (matchingReservations.length !== 1 || inputSetPayload == null
          || (!canonicalLearningDecisionForReservation(record, fingerprint, inputSetPayload)
            && !canonicalLegacyLearningDecisionForReservation(record, fingerprint, inputSetPayload))) {
          invalid("INVALID_LEARNING_DECISION_RECEIPT", "only a canonical A1 receipt bound to exactly one pending A2 input set may use reserved capacity");
        }
      }
      const pending = pendingReservationsAfterAppend(pendingReservations, record, verifyInputSet);
      const applicationReservations = pendingLearningApplicationIntents([...current.records, record]);
      if (current.records.length + 1 + pending.size + applicationReservations.size > this.maximumRecords) invalid("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted or reserved for pending A1/A4 receipts");
      const previous = current.records.at(-1);
      if (previous != null && Date.parse(record.recordedAt) < Date.parse(previous.recordedAt)) invalid("CHRONOLOGY_REGRESSION", "learning record timestamp regressed");

      const meta = readMeta(this.db.connection);
      if (meta.eventCount !== current.eventCount || meta.ledgerHash !== current.headHash) invalid("CONCURRENT_CHANGE", "learning ledger changed during append");
      const sequence = meta.eventCount + 1;
      const previousHash = meta.ledgerHash;
      const currentContentHash = contentHash(record);
      const currentEventHash = eventHash(sequence, record, previousHash);
      this.db.connection.prepare(
        "INSERT INTO evolution_learning_ledger_events (sequence, opportunity_id, content_hash, payload_json, recorded_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(sequence, record.opportunityId, currentContentHash, canonicalResearchJson(record), record.recordedAt, previousHash, currentEventHash);
      this.db.connection.prepare(
        "UPDATE evolution_learning_ledger_meta SET event_count = ?, ledger_hash = ? WHERE id = 1 AND schema_version = ?"
      ).run(sequence, currentEventHash, SCHEMA_VERSION);
      this.cached = this.replay();
      return Object.freeze({ record: this.cached.records.at(-1)!, inserted: true });
    });
  }

  public replay(): EvolutionLearningLedgerReplay {
    const meta = readMeta(this.db.connection);
    const rows = this.db.connection.prepare(
      "SELECT sequence, opportunity_id, content_hash, payload_json, recorded_at, previous_hash, event_hash FROM evolution_learning_ledger_events ORDER BY sequence ASC"
    ).all() as unknown as LedgerEventRow[];
    if (rows.length !== meta.eventCount) invalid("CORRUPTED_LEDGER", "learning ledger event count mismatch");
    const records: EvolutionLearningRecord[] = [];
    let previousHash = GENESIS_HASH;
    let previousRecordedAt = -1;
    rows.forEach((row, index) => {
      const sequence = safeInteger(row.sequence, "sequence");
      if (sequence !== index + 1) invalid("CORRUPTED_LEDGER", "learning ledger sequence is not contiguous");
      const opportunityId = text(row.opportunity_id, "opportunityId", 160);
      const storedContentHash = hashValue(row.content_hash, "contentHash");
      const storedPreviousHash = hashValue(row.previous_hash, "previousHash");
      const storedEventHash = hashValue(row.event_hash, "eventHash");
      if (storedPreviousHash !== previousHash) invalid("CORRUPTED_LEDGER", "learning ledger hash chain is broken");
      const record = parsePayload(row.payload_json);
      const observedAt = Date.parse(record.recordedAt);
      if (observedAt < previousRecordedAt) invalid("CORRUPTED_LEDGER", "learning ledger chronology regressed");
      if (record.opportunityId !== opportunityId || record.recordedAt !== row.recorded_at || contentHash(record) !== storedContentHash) invalid("CORRUPTED_LEDGER", "learning ledger row identity is inconsistent");
      if (eventHash(sequence, record, storedPreviousHash) !== storedEventHash) invalid("CORRUPTED_LEDGER", "learning ledger event hash is invalid");
      records.push(record);
      previousHash = storedEventHash;
      previousRecordedAt = observedAt;
    });
    if (previousHash !== meta.ledgerHash) invalid("CORRUPTED_LEDGER", "learning ledger head hash is invalid");
    this.cached = Object.freeze({ schemaVersion: SCHEMA_VERSION, records: Object.freeze(records), eventCount: records.length, headHash: previousHash });
    return this.cached;
  }

  public list(): readonly EvolutionLearningRecord[] {
    return this.replay().records;
  }

  public get(opportunityId: string): EvolutionLearningRecord | undefined {
    const id = text(opportunityId, "opportunityId", 160);
    return this.replay().records.find((record) => record.opportunityId === id);
  }

  public headHash(): string {
    return this.replay().headHash;
  }

  public size(): number {
    return this.replay().eventCount;
  }
}
