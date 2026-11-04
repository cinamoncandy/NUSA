import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";

/**
 * A2 - the Learning Input Set.
 *
 * A Learning Decision may not consume an arbitrary query result. The evidence it is allowed to
 * consider is fixed here first, as an immutable, deterministic identity, and the decision consumes
 * that identity. Without this layer a decision's provenance is whatever the query happened to
 * return at the moment it ran, which is unverifiable after the fact and irreproducible across a
 * restart (v2 sections 6-7, Impact Analysis A2).
 *
 * The two evidence lanes are joined here and only here. Lane A (Research) and Lane B (realized
 * PAPER) keep their own stores; neither is moved, merged, or re-parented. Each lane is reduced to a
 * digest plus the exact record ids it contributed, so the join is auditable rather than implicit.
 *
 * Nothing here has authority. A Learning Input Set is a statement about what was observed, never an
 * instruction about what to do.
 */

export const LEARNING_INPUT_SET_SCHEMA_VERSION = 1;
export const LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION = "learning-input-set-canonical-order-v2";
/** Must fit the existing Evolution Learning ledger hypothesis field without changing its bound. */
export const MAX_LEARNING_INPUT_SET_RECEIPT_BYTES = 16_384;
/** Hard CPU/memory bound checked before sorting, hashing, or copying evidence lanes. */
export const MAX_LEARNING_INPUT_SET_EVIDENCE_REFERENCES = 512;

export class LearningInputSetError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningInputSetError";
  }
}

/** One contribution from either lane. `recordedAt` is what makes a PIT cutoff enforceable. */
export interface LearningEvidenceReference {
  readonly recordId: string;
  readonly recordedAt: number;
}

export interface LearningPolicyIdentity {
  readonly learningPolicyVersion: string;
  readonly researchPolicyVersion: string;
  readonly riskPolicyVersion: string;
  readonly governancePolicyVersion: string;
}

export interface LearningInputSetInput {
  /** Point-in-time boundary. Evidence recorded at or after it is excluded and may not be cited. */
  readonly cutoffTimestamp: number;
  readonly researchEvidence: readonly LearningEvidenceReference[];
  readonly paperEvidence: readonly LearningEvidenceReference[];
  readonly policies: LearningPolicyIdentity;
}

export interface LearningInputSet {
  readonly schemaVersion: typeof LEARNING_INPUT_SET_SCHEMA_VERSION;
  readonly cutoffTimestamp: number;
  readonly researchEvidenceRecordIds: readonly string[];
  readonly researchEvidenceObservedAt: readonly number[];
  readonly paperEvidenceRecordIds: readonly string[];
  readonly paperEvidenceObservedAt: readonly number[];
  readonly researchLaneDigest: string;
  readonly performanceLaneDigest: string;
  readonly learningPolicyVersion: string;
  readonly researchPolicyVersion: string;
  readonly riskPolicyVersion: string;
  readonly governancePolicyVersion: string;
  readonly canonicalOrderingVersion: typeof LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION;
}

const SHA64 = /^[a-f0-9]{64}$/;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_RECORD_ID_LENGTH = 512;
const MAX_PAPER_REFERENCE_ID_LENGTH = 227; // existing ledger reference limit (240) minus `paper-period:`.
const PAPER_REFERENCE_ID = /^[A-Za-z0-9_.:/#@-]{1,227}$/;

/** Locale-independent ordering for values included in durable canonical identities. */
function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LearningInputSetError("NON_FINITE_VALUE", "learning input set contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    return "{" + Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
      .join(",") + "}";
  }
  throw new LearningInputSetError("UNSUPPORTED_VALUE", "learning input set contains an unsupported value");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

/**
 * Control characters would let one record id render as another, defeating the canonical ordering
 * that the fingerprint depends on. Checked by code point rather than by regex so the boundary is
 * explicit: below 0x20 plus 0x7f.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validateRecordId(recordId: string, lane: string): void {
  if (typeof recordId !== "string" || recordId.trim().length === 0) throw new LearningInputSetError("MALFORMED_RECORD_ID", lane + " evidence record id is required");
  if (recordId.length > MAX_RECORD_ID_LENGTH) throw new LearningInputSetError("MALFORMED_RECORD_ID", lane + " evidence record id is too long");
  if (lane === "performance" && (recordId.length > MAX_PAPER_REFERENCE_ID_LENGTH || !PAPER_REFERENCE_ID.test(recordId))) {
    throw new LearningInputSetError("MALFORMED_RECORD_ID", "performance evidence record id cannot fit the canonical PAPER ledger reference");
  }
  if (hasControlCharacter(recordId)) throw new LearningInputSetError("MALFORMED_RECORD_ID", lane + " evidence record id contains a control character");
}

function assertExactKeys(value: object, allowed: readonly string[], code: string, label: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new LearningInputSetError(code, label + " contains an unsupported field");
  }
}

function assertEvidenceBudget(research: readonly LearningEvidenceReference[], paper: readonly LearningEvidenceReference[]): void {
  const total = research.length + paper.length;
  if (total > MAX_LEARNING_INPUT_SET_EVIDENCE_REFERENCES) {
    throw new LearningInputSetError("TOO_MANY_EVIDENCE_REFERENCES", "learning input set exceeds the bounded evidence-reference count");
  }

  // Estimate the persisted A2 shape before lane sorting/copying/digest work. The fixed allowance
  // covers schema, policy, digest, and JSON punctuation fields; per-record bytes cover the exact
  // JSON string form, timestamp digits, and both array separators. The exact storage serializer
  // check still runs on the completed object below.
  let estimatedBytes = 1_024;
  for (const references of [research, paper]) {
    for (const reference of references) {
      if (reference == null || typeof reference !== "object") throw new LearningInputSetError("MALFORMED_EVIDENCE", "evidence contribution is malformed");
      const recordId = reference.recordId;
      if (typeof recordId !== "string" || recordId.length === 0 || recordId.length > MAX_RECORD_ID_LENGTH) {
        throw new LearningInputSetError("MALFORMED_RECORD_ID", "evidence record id is malformed or too long");
      }
      const timestamp = reference.recordedAt;
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new LearningInputSetError("MALFORMED_EVIDENCE", "evidence observation time is invalid");
      estimatedBytes += Buffer.byteLength(JSON.stringify(recordId), "utf8") + String(timestamp).length + 2;
      if (estimatedBytes > MAX_LEARNING_INPUT_SET_RECEIPT_BYTES) {
        throw new LearningInputSetError("INPUT_SET_TOO_LARGE", "learning input set exceeds the existing durable receipt size limit");
      }
    }
  }
}

function validatePolicyVersions(policies: LearningPolicyIdentity): void {
  if (policies == null || typeof policies !== "object") throw new LearningInputSetError("INVALID_POLICY_VERSION", "policy identities are required");
  for (const name of ["learningPolicyVersion", "researchPolicyVersion", "riskPolicyVersion", "governancePolicyVersion"] as const) {
    if (typeof policies[name] !== "string" || !POLICY_VERSION.test(policies[name])) throw new LearningInputSetError("INVALID_POLICY_VERSION", name + " is required");
  }
  for (const [name, version] of Object.entries(policies)) {
    if (typeof version !== "string" || !POLICY_VERSION.test(version)) throw new LearningInputSetError("INVALID_POLICY_VERSION", name + " must be a bounded policy version string");
  }
}

/**
 * Reduces one lane to a canonical digest plus its sorted record ids.
 *
 * The digest covers the ids *and* their observation times, because a lane whose ids are identical
 * but whose evidence was observed at a different point in time is not the same evidence for PIT
 * purposes. Duplicates are rejected outright rather than de-duplicated silently, so a caller cannot
 * believe it supplied more distinct evidence than it did.
 */
function laneOf(references: readonly LearningEvidenceReference[], lane: string, cutoffTimestamp: number): { readonly recordIds: readonly string[]; readonly digest: string } {
  if (!Array.isArray(references)) throw new LearningInputSetError("MALFORMED_EVIDENCE", lane + " evidence must be a list");
  const seen = new Set<string>();
  for (const reference of references) {
    if (reference == null || typeof reference !== "object") throw new LearningInputSetError("MALFORMED_EVIDENCE", lane + " evidence contribution is malformed");
    validateRecordId(reference.recordId, lane);
    if (!Number.isSafeInteger(reference.recordedAt) || reference.recordedAt < 0) throw new LearningInputSetError("MALFORMED_EVIDENCE", lane + " evidence observation time is invalid");
    if (seen.has(reference.recordId)) throw new LearningInputSetError("DUPLICATE_EVIDENCE_ID", lane + " evidence record id was supplied twice");
    // Point-in-time integrity: evidence not yet observed at the cutoff may not be cited by a
    // decision made at that cutoff, or the decision is reading its own future.
    if (reference.recordedAt >= cutoffTimestamp) throw new LearningInputSetError("PIT_VIOLATION", lane + " evidence was recorded at or after the point-in-time cutoff");
    seen.add(reference.recordId);
  }
  const ordered = [...references].sort((left, right) => compareCanonicalStrings(left.recordId, right.recordId));
  const recordIds = Object.freeze(ordered.map((reference) => reference.recordId));
  return Object.freeze({
    recordIds,
    digest: digest({ lane, recordIds, observedAt: ordered.map((reference) => reference.recordedAt) }),
  });
}

/**
 * Canonicalizes and validates a Learning Input Set.
 *
 * Canonical form is not cosmetic: the fingerprint derived from it is the cycle's input identity, so
 * the same evidence supplied in any order, any number of times, across any restart, must produce
 * exactly this value.
 */
export function buildLearningInputSet(input: LearningInputSetInput): LearningInputSet {
  if (input == null || typeof input !== "object") throw new LearningInputSetError("MALFORMED_INPUT", "learning input set input is required");
  if (Object.hasOwn(input, "metaPartitionIdentity")) throw new LearningInputSetError("META_PARTITION_NOT_PART_OF_INPUT_SET", "META assignment follows the A1 decision and is not part of A2 identity");
  assertExactKeys(input, ["cutoffTimestamp", "researchEvidence", "paperEvidence", "policies"], "MALFORMED_INPUT", "learning input set input");
  if (!Array.isArray(input.researchEvidence) || !Array.isArray(input.paperEvidence)) throw new LearningInputSetError("MALFORMED_INPUT", "learning evidence lanes must be lists");
  if (!Number.isSafeInteger(input.cutoffTimestamp) || input.cutoffTimestamp < 0) throw new LearningInputSetError("INVALID_CUTOFF", "point-in-time cutoff must be a non-negative integer timestamp");
  if (input.researchEvidence.length === 0 && input.paperEvidence.length === 0) throw new LearningInputSetError("EMPTY_INPUT_SET", "a learning input set must cite at least one evidence record");
  assertEvidenceBudget(input.researchEvidence, input.paperEvidence);
  if (input.policies == null || typeof input.policies !== "object" || Array.isArray(input.policies)) {
    throw new LearningInputSetError("INVALID_POLICY_VERSION", "policy identities are required");
  }
  assertExactKeys(input.policies, ["learningPolicyVersion", "researchPolicyVersion", "riskPolicyVersion", "governancePolicyVersion"], "INVALID_POLICY_VERSION", "learning policy identities");
  validatePolicyVersions(input.policies);
  for (const reference of [...input.researchEvidence, ...input.paperEvidence]) {
    assertExactKeys(reference, ["recordId", "recordedAt"], "MALFORMED_EVIDENCE", "evidence contribution");
  }

  const research = laneOf(input.researchEvidence, "research", input.cutoffTimestamp);
  const performance = laneOf(input.paperEvidence, "performance", input.cutoffTimestamp);

  // The two lanes may not silently cite the same record: that would count one record as both
  // research and performance evidence, and the lane digests would double-count it.
  const researchIds = new Set(research.recordIds);
  for (const recordId of performance.recordIds) {
    if (researchIds.has(recordId)) throw new LearningInputSetError("CROSS_LANE_DUPLICATE", "evidence was supplied to both lanes");
  }

  const inputSet = Object.freeze({
    schemaVersion: LEARNING_INPUT_SET_SCHEMA_VERSION,
    cutoffTimestamp: input.cutoffTimestamp,
    researchEvidenceRecordIds: research.recordIds,
    researchEvidenceObservedAt: Object.freeze([...input.researchEvidence].sort((left, right) => compareCanonicalStrings(left.recordId, right.recordId)).map((reference) => reference.recordedAt)),
    paperEvidenceRecordIds: performance.recordIds,
    paperEvidenceObservedAt: Object.freeze([...input.paperEvidence].sort((left, right) => compareCanonicalStrings(left.recordId, right.recordId)).map((reference) => reference.recordedAt)),
    researchLaneDigest: research.digest,
    performanceLaneDigest: performance.digest,
    learningPolicyVersion: input.policies.learningPolicyVersion,
    researchPolicyVersion: input.policies.researchPolicyVersion,
    riskPolicyVersion: input.policies.riskPolicyVersion,
    governancePolicyVersion: input.policies.governancePolicyVersion,
    canonicalOrderingVersion: LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION,
  });
  assertReceiptSize(inputSet);
  return inputSet;
}

function assertReceiptSize(inputSet: LearningInputSet): void {
  // Measure exactly the representation the existing ledger persists, not the A2 fingerprint
  // serializer. Identity canonicalization and storage serialization are separate contracts.
  const bytes = Buffer.byteLength(canonicalResearchJson(inputSet), "utf8");
  if (bytes > MAX_LEARNING_INPUT_SET_RECEIPT_BYTES) {
    throw new LearningInputSetError("INPUT_SET_TOO_LARGE", "learning input set exceeds the existing durable receipt size limit");
  }
}

/** The deterministic identity of an input set. Same evidence plus same policies yields the same fingerprint. */
export function learningInputSetFingerprint(inputSet: LearningInputSet): string {
  assertLearningInputSet(inputSet);
  return digest(inputSet);
}

/**
 * Cycle identity derived from the input set. Because the fingerprint already covers both lanes and
 * every policy version, identical input under identical policy yields the identical cycle id, which
 * makes exactly-once a property of identity rather than of a counter (v2 section 30).
 */
export function learningCycleId(inputSet: LearningInputSet): string {
  return "learning-cycle:" + learningInputSetFingerprint(inputSet);
}

/** Canonical `paper-period:<recordId>` references this input set cites, for retention protection. */
export function learningInputSetPeriodReferences(inputSet: LearningInputSet): readonly string[] {
  return Object.freeze([...inputSet.paperEvidenceRecordIds].map((recordId) => "paper-period:" + recordId));
}

/** Fails closed on anything that is not exactly a Learning Input Set. */
export function assertLearningInputSet(value: unknown): asserts value is LearningInputSet {
  if (value == null || typeof value !== "object") throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set is required");
  const candidate = value as Partial<LearningInputSet>;
  if (Object.hasOwn(candidate, "metaPartitionIdentity")) throw new LearningInputSetError("MALFORMED_INPUT_SET", "META assignment is not part of A2 identity");
  assertExactKeys(value, [
    "schemaVersion", "cutoffTimestamp", "researchEvidenceRecordIds", "researchEvidenceObservedAt",
    "paperEvidenceRecordIds", "paperEvidenceObservedAt", "researchLaneDigest", "performanceLaneDigest",
    "learningPolicyVersion", "researchPolicyVersion", "riskPolicyVersion", "governancePolicyVersion",
    "canonicalOrderingVersion",
  ], "MALFORMED_INPUT_SET", "learning input set");
  if (candidate.schemaVersion !== LEARNING_INPUT_SET_SCHEMA_VERSION) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set schema version is unsupported");
  if (candidate.canonicalOrderingVersion !== LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set canonical ordering version is unsupported");
  if (!Number.isSafeInteger(candidate.cutoffTimestamp) || (candidate.cutoffTimestamp as number) < 0) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set cutoff is invalid");
  for (const lane of ["researchEvidenceRecordIds", "paperEvidenceRecordIds"] as const) {
    if (!Array.isArray(candidate[lane])) throw new LearningInputSetError("MALFORMED_INPUT_SET", lane + " must be a list");
  }
  const researchCount = (candidate.researchEvidenceRecordIds as readonly unknown[]).length;
  const paperCount = (candidate.paperEvidenceRecordIds as readonly unknown[]).length;
  if (researchCount + paperCount > MAX_LEARNING_INPUT_SET_EVIDENCE_REFERENCES) {
    throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set exceeds the bounded evidence-reference count");
  }
  const laneMeta = [
    ["researchEvidenceRecordIds", "researchEvidenceObservedAt", "researchLaneDigest"],
    ["paperEvidenceRecordIds", "paperEvidenceObservedAt", "performanceLaneDigest"],
  ] as const;
  const allIds = new Set<string>();
  for (const [idsKey, timesKey, digestKey] of laneMeta) {
    const ids = candidate[idsKey] as readonly unknown[];
    const times = candidate[timesKey] as readonly unknown[] | undefined;
    if (!Array.isArray(times) || times.length !== ids.length || (ids.length === 0 && times.length !== 0)) throw new LearningInputSetError("MALFORMED_INPUT_SET", timesKey + " must align with its record ids");
    let previous = "";
    for (let index = 0; index < ids.length; index += 1) {
      // Array iteration helpers skip holes. A sparse caller-shaped receipt could therefore pass
      // identity validation, be written to the append-only ledger, then fail on receipt replay.
      // Require every aligned slot to be an own element before reading or hashing it.
      if (!Object.hasOwn(ids, index) || !Object.hasOwn(times, index)) {
        throw new LearningInputSetError("MALFORMED_INPUT_SET", idsKey + " and " + timesKey + " must not contain sparse entries");
      }
      const id = ids[index];
      const observedAt = times[index];
      validateRecordId(id as string, idsKey === "paperEvidenceRecordIds" ? "performance" : "research");
      if (index > 0 && compareCanonicalStrings(id as string, previous) <= 0) throw new LearningInputSetError("MALFORMED_INPUT_SET", idsKey + " must be unique and canonically ordered");
      if (allIds.has(id as string)) throw new LearningInputSetError("MALFORMED_INPUT_SET", "evidence record id appears in both lanes");
      allIds.add(id as string); previous = id as string;
      if (!Number.isSafeInteger(observedAt) || (observedAt as number) < 0 || (observedAt as number) >= (candidate.cutoffTimestamp as number)) throw new LearningInputSetError("MALFORMED_INPUT_SET", timesKey + " contains an invalid point-in-time value");
    }
    if (digest({ lane: idsKey.startsWith("research") ? "research" : "performance", recordIds: ids, observedAt: times }) !== candidate[digestKey]) throw new LearningInputSetError("MALFORMED_INPUT_SET", digestKey + " does not match the canonical lane evidence");
  }
  if (allIds.size === 0) throw new LearningInputSetError("MALFORMED_INPUT_SET", "a learning input set must cite at least one evidence record");
  if (!SHA64.test(candidate.researchLaneDigest ?? "") || !SHA64.test(candidate.performanceLaneDigest ?? "")) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set lane digests are invalid");
  // Validate the four policy fields by name. Enumerating the whole object would also test
  // `schemaVersion`, `cutoffTimestamp` and the digests against the policy-version shape, which they
  // deliberately do not match.
  validatePolicyVersions({
    learningPolicyVersion: candidate.learningPolicyVersion ?? "",
    researchPolicyVersion: candidate.researchPolicyVersion ?? "",
    riskPolicyVersion: candidate.riskPolicyVersion ?? "",
    governancePolicyVersion: candidate.governancePolicyVersion ?? "",
  });
  assertReceiptSize(candidate as LearningInputSet);
}
