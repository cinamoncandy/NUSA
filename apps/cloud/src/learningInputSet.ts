import { createHash } from "node:crypto";

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
export const LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION = "learning-input-set-canonical-order-v1";

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
  /** Identity of the meta-OOS partition these cycles fall into. */
  readonly metaPartitionIdentity: string;
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
  readonly metaPartitionIdentity: string;
  readonly canonicalOrderingVersion: typeof LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION;
}

const SHA64 = /^[a-f0-9]{64}$/;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_RECORD_ID_LENGTH = 512;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LearningInputSetError("NON_FINITE_VALUE", "learning input set contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    return "{" + Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
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
  if (hasControlCharacter(recordId)) throw new LearningInputSetError("MALFORMED_RECORD_ID", lane + " evidence record id contains a control character");
}

function validatePolicyVersions(policies: LearningPolicyIdentity): void {
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
  const ordered = [...references].sort((left, right) => left.recordId.localeCompare(right.recordId));
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
  if (!Array.isArray(input.researchEvidence) || !Array.isArray(input.paperEvidence)) throw new LearningInputSetError("MALFORMED_INPUT", "learning evidence lanes must be lists");
  if (!Number.isSafeInteger(input.cutoffTimestamp) || input.cutoffTimestamp < 0) throw new LearningInputSetError("INVALID_CUTOFF", "point-in-time cutoff must be a non-negative integer timestamp");
  if (input.researchEvidence.length === 0 && input.paperEvidence.length === 0) throw new LearningInputSetError("EMPTY_INPUT_SET", "a learning input set must cite at least one evidence record");
  if (input.metaPartitionIdentity == null || typeof input.metaPartitionIdentity !== "string" || !POLICY_VERSION.test(input.metaPartitionIdentity)) throw new LearningInputSetError("INVALID_META_PARTITION", "meta-OOS partition identity is invalid");
  validatePolicyVersions(input.policies);

  const research = laneOf(input.researchEvidence, "research", input.cutoffTimestamp);
  const performance = laneOf(input.paperEvidence, "performance", input.cutoffTimestamp);

  // The two lanes may not silently cite the same record: that would count one record as both
  // research and performance evidence, and the lane digests would double-count it.
  for (const recordId of performance.recordIds) {
    if (research.recordIds.includes(recordId)) throw new LearningInputSetError("CROSS_LANE_DUPLICATE", "evidence was supplied to both lanes");
  }

  return Object.freeze({
    schemaVersion: LEARNING_INPUT_SET_SCHEMA_VERSION,
    cutoffTimestamp: input.cutoffTimestamp,
    researchEvidenceRecordIds: research.recordIds,
    researchEvidenceObservedAt: Object.freeze([...input.researchEvidence].sort((left, right) => left.recordId.localeCompare(right.recordId)).map((reference) => reference.recordedAt)),
    paperEvidenceRecordIds: performance.recordIds,
    paperEvidenceObservedAt: Object.freeze([...input.paperEvidence].sort((left, right) => left.recordId.localeCompare(right.recordId)).map((reference) => reference.recordedAt)),
    researchLaneDigest: research.digest,
    performanceLaneDigest: performance.digest,
    learningPolicyVersion: input.policies.learningPolicyVersion,
    researchPolicyVersion: input.policies.researchPolicyVersion,
    riskPolicyVersion: input.policies.riskPolicyVersion,
    governancePolicyVersion: input.policies.governancePolicyVersion,
    metaPartitionIdentity: input.metaPartitionIdentity,
    canonicalOrderingVersion: LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION,
  });
}

/** The deterministic identity of an input set. Same evidence plus same policies yields the same fingerprint. */
export function learningInputSetFingerprint(inputSet: LearningInputSet): string {
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
  if (candidate.schemaVersion !== LEARNING_INPUT_SET_SCHEMA_VERSION) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set schema version is unsupported");
  if (candidate.canonicalOrderingVersion !== LEARNING_INPUT_SET_CANONICAL_ORDERING_VERSION) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set canonical ordering version is unsupported");
  if (!Number.isSafeInteger(candidate.cutoffTimestamp) || (candidate.cutoffTimestamp as number) < 0) throw new LearningInputSetError("MALFORMED_INPUT_SET", "learning input set cutoff is invalid");
  for (const lane of ["researchEvidenceRecordIds", "paperEvidenceRecordIds"] as const) {
    if (!Array.isArray(candidate[lane])) throw new LearningInputSetError("MALFORMED_INPUT_SET", lane + " must be a list");
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
    ids.forEach((id, index) => {
      validateRecordId(id as string, idsKey);
      if (index > 0 && (id as string).localeCompare(previous) <= 0) throw new LearningInputSetError("MALFORMED_INPUT_SET", idsKey + " must be unique and canonically ordered");
      if (allIds.has(id as string)) throw new LearningInputSetError("MALFORMED_INPUT_SET", "evidence record id appears in both lanes");
      allIds.add(id as string); previous = id as string;
      if (!Number.isSafeInteger(times[index]) || (times[index] as number) < 0 || (times[index] as number) >= (candidate.cutoffTimestamp as number)) throw new LearningInputSetError("MALFORMED_INPUT_SET", timesKey + " contains an invalid point-in-time value");
    });
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
}
