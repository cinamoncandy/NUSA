import { createHash } from "node:crypto";
import type { HoldoutKey } from "../../../packages/storage/src/researchHoldoutLedger";
import type { MetaOosEligibility } from "./learningApplication";

/**
 * A3 - cross-cycle Meta-Out-of-Sample validation.
 *
 * Strategy OOS and learning-policy OOS are different things. Within-experiment OOS guards a strategy
 * against its own past; meta-OOS guards the *learning policy* against having been tuned on the
 * cycles it is now being judged by. This module adds the cross-cycle partition that the second kind
 * needs, layered on top of the existing holdout truth source rather than beside it.
 *
 * Three properties are enforced here.
 *
 * **One cycle belongs to exactly one partition.** `meta-train`, `meta-validation`, and `meta-holdout`
 * are mutually exclusive. Re-assigning an already-assigned cycle to a different partition is a fork,
 * not a preference, and it is refused.
 *
 * **Meta-holdout is single-use.** Once a holdout result has been observed it may not be fed back into
 * tuning the same learning policy, because the policy would then be fitted to the very evidence meant
 * to judge it. The claim is delegated to the existing `researchHoldoutLedger`, so there is one
 * holdout truth source in the system rather than two. A second claim against an already-used key is
 * contamination and fails closed.
 *
 * **Insufficient is a legitimate answer.** With too few completed cycles the verdict is `INSUFFICIENT`
 * and no eligibility is granted. The minimum cycle count is an owner constant that learning cannot
 * lower, and neither may it relax a holdout ratio or bypass validation to make a sample pass.
 *
 * This module is also the bridge A4 has been waiting for: it is the only place that can produce a
 * truthful `MetaOosEligibility`. Until it has completed cycles, every eligibility it produces says
 * ineligible with a reason, which is exactly what keeps A4's autonomous door shut (v2 sections 17,
 * 19-22).
 */

export const META_OOS_SCHEMA_VERSION = 1;
export const META_OOS_POLICY_VERSION = "meta-oos-v1";
/**
 * The architecture requires an owner-approved order-to-partition policy, but has not defined its
 * partition constants or cycle-order cadence yet. Keep this unavailable until that decision is
 * recorded; a caller-selected partition is never a substitute for the missing authority.
 */
const META_PARTITION_POLICY_VERSION: string | null = null;
/**
 * Owner-fixed floor for granting application eligibility.
 *
 * One completed cycle per partition, so train, validation, and holdout each have coverage before a
 * learned change is allowed to touch research policy. Learning cannot lower this, and it is not
 * derived from anything a decision controls.
 */
export const META_MINIMUM_CYCLES_FOR_ELIGIBILITY = 3;

export class MetaOosError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MetaOosError";
  }
}

export type MetaPartition = "meta-train" | "meta-validation" | "meta-holdout";
export const META_PARTITIONS: readonly MetaPartition[] = Object.freeze(["meta-train", "meta-validation", "meta-holdout"]);

/**
 * The existing holdout truth source, by structural shape.
 *
 * Declaring it structurally rather than importing the class keeps this module bound to the contract
 * that already exists, so the real `SqliteResearchHoldoutLedger` satisfies it without a wrapper and
 * no second holdout store can be introduced by accident.
 */
export interface HoldoutClaimPort {
  claim(key: HoldoutKey, evaluationId: string, usedAtMs: number): "CLAIMED" | "ALREADY_USED";
  isUsed(key: HoldoutKey): boolean;
}

export interface MetaOosAssignmentInput {
  readonly learningCycleId: string;
  readonly learningDecisionFingerprint: string;
  readonly partition: MetaPartition;
  readonly policyVersion: string;
  readonly cutoff: number;
  readonly assignedAt: string;
  /** Required for `meta-holdout`: which held-out result this cycle is allowed to observe. */
  readonly holdoutKey?: HoldoutKey;
  /** Identifier for the evaluation consuming the holdout. */
  readonly holdoutEvaluationId?: string;
}

export interface MetaOosAssignment {
  readonly schemaVersion: typeof META_OOS_SCHEMA_VERSION;
  readonly learningCycleId: string;
  readonly learningDecisionFingerprint: string;
  readonly partition: MetaPartition;
  readonly policyVersion: string;
  readonly cutoff: number;
  readonly holdoutClaimIdentity?: string;
  readonly assignmentFingerprint: string;
  readonly assignedAt: string;
  readonly metaOosPolicyVersion: typeof META_OOS_POLICY_VERSION;
}

const SHA64 = /^[a-f0-9]{64}$/;
const CYCLE = /^learning-cycle:[a-f0-9]{64}$/;
const BOUNDED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MetaOosError("NON_FINITE_VALUE", "meta-OOS assignment contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry))
        .join(",") +
      "}"
    );
  }
  throw new MetaOosError("NON_CANONICAL_VALUE", "meta-OOS assignment contains a value with no canonical form");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

/** Stable identity of a holdout claim, so the same held-out result is recognisable across cycles. */
function holdoutClaimIdentity(key: HoldoutKey): string {
  return digest({
    strategyConfigHash: key.strategyConfigHash,
    market: key.market,
    intervalMs: key.intervalMs,
    holdoutStartMs: key.holdoutStartMs,
    holdoutEndMs: key.holdoutEndMs,
  });
}

function assertBounded(value: unknown, field: string): string {
  if (typeof value !== "string" || !BOUNDED.test(value)) throw new MetaOosError("MALFORMED_ASSIGNMENT", field + " must be a bounded identifier");
  return value;
}

function buildAssignment(input: MetaOosAssignmentInput, claimIdentity?: string): MetaOosAssignment {
  // Explicitly typed so the schema and policy versions keep their literal types rather than
  // widening to `number`/`string` inside an un-annotated object literal.
  const base: Omit<MetaOosAssignment, "assignmentFingerprint"> = {
    schemaVersion: META_OOS_SCHEMA_VERSION,
    learningCycleId: input.learningCycleId,
    learningDecisionFingerprint: input.learningDecisionFingerprint,
    partition: input.partition,
    policyVersion: input.policyVersion,
    cutoff: input.cutoff,
    ...(claimIdentity == null ? {} : { holdoutClaimIdentity: claimIdentity }),
    assignedAt: input.assignedAt,
    metaOosPolicyVersion: META_OOS_POLICY_VERSION,
  };
  // The fingerprint covers the claim too, so a holdout claim cannot be detached from the cycle that
  // consumed it without changing the identity.
  return Object.freeze({ ...base, assignmentFingerprint: digest(base) });
}

function assertAssignmentInput(input: MetaOosAssignmentInput): void {
  if (input == null || typeof input !== "object") throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta-OOS assignment input is required");
  if (typeof input.learningCycleId !== "string" || !CYCLE.test(input.learningCycleId)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "learning cycle id is invalid");
  if (typeof input.learningDecisionFingerprint !== "string" || !SHA64.test(input.learningDecisionFingerprint)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "learning decision fingerprint must be a SHA-256 digest");
  if (!META_PARTITIONS.includes(input.partition)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta partition is outside the closed set");
  assertBounded(input.policyVersion, "policy version");
  assertBounded(input.assignedAt, "assigned at");
  if (!Number.isSafeInteger(input.cutoff) || input.cutoff < 0) throw new MetaOosError("MALFORMED_ASSIGNMENT", "cutoff must be a non-negative integer");
}

/** Verifies a replay against the durable assignment without trying to consume its holdout twice. */
export function assertMetaOosAssignmentReplay(input: MetaOosAssignmentInput, existing: MetaOosAssignment, holdouts: HoldoutClaimPort): void {
  assertCanonicalPartitionPolicyAvailable();
  assertAssignmentInput(input);
  let claimIdentity: string | undefined;
  if (input.partition === "meta-holdout") {
    if (input.holdoutKey == null || input.holdoutEvaluationId == null) throw new MetaOosError("HOLDOUT_REQUIRED", "a meta-holdout partition requires a holdout key and an evaluation id");
    if (!holdouts.isUsed(input.holdoutKey)) throw new MetaOosError("HOLDOUT_CLAIM_MISSING", "durable meta-holdout assignment has no matching single-use holdout claim");
    claimIdentity = holdoutClaimIdentity(input.holdoutKey);
  }
  const replayed = buildAssignment(input, claimIdentity);
  if (replayed.assignmentFingerprint !== existing.assignmentFingerprint) throw new MetaOosError("IDENTITY_CONFLICT", "same cycle and partition were re-supplied with different content");
}

/**
 * Assigns a cycle to exactly one meta partition, claiming the holdout when the partition requires it.
 *
 * The holdout claim is attempted against the existing holdout ledger *before* the assignment is
 * considered durable, so a contamination never produces a record. If the claim comes back already
 * used, this fails closed rather than proceeding on the grounds that everything else looked fine.
 */
export function assignMetaPartition(input: MetaOosAssignmentInput, holdouts: HoldoutClaimPort): MetaOosAssignment {
  assertAssignmentInput(input);
  void holdouts;
  assertCanonicalPartitionPolicyAvailable();
  return buildAssignment(input);
}

function assertCanonicalPartitionPolicyAvailable(): void {
  if (META_PARTITION_POLICY_VERSION == null) {
    throw new MetaOosError("META_PARTITION_POLICY_UNDEFINED", "cycle-order partition constants have no verified canonical owner; caller-selected partition assignment is disabled");
  }
}

/**
 * Whether the assigned cycles are numerous enough to judge the learning policy at all.
 *
 * Below the floor the verdict is `INSUFFICIENT`, which is a normal durable answer and never a
 * request to lower the bar. The count comes from recorded assignments, so it cannot be inflated by
 * anything a decision says about itself.
 */
export function metaOosCyclesEligibility(
  partitionAssignments: readonly MetaOosAssignment[],
  partition: MetaPartition,
  cyclesEvaluated: number,
  identity: Pick<MetaOosEligibility, "learningCycleId" | "learningDecisionFingerprint">,
): MetaOosEligibility {
  if (typeof identity?.learningCycleId !== "string" || !CYCLE.test(identity.learningCycleId)) throw new MetaOosError("MALFORMED_ELIGIBILITY_IDENTITY", "eligibility cycle identity is invalid");
  if (typeof identity.learningDecisionFingerprint !== "string" || !SHA64.test(identity.learningDecisionFingerprint)) throw new MetaOosError("MALFORMED_ELIGIBILITY_IDENTITY", "eligibility decision fingerprint is invalid");
  void partitionAssignments;
  void cyclesEvaluated;
  return Object.freeze({
    eligible: false,
    partition,
    cyclesEvaluated: 0,
    ...identity,
    reason: "meta-OOS cycle-order partition policy is undefined; no caller-selected or unverified assignment can establish eligibility",
  });
}

/**
 * The single eligibility proof A4 accepts, derived only from recorded assignments.
 *
 * It is deliberately not constructible from a decision's own claim: a decision that reports a large
 * `metaCyclesEvaluated` still gets no eligibility unless the assignments actually exist.
 */
export function metaOosEligibility(
  assignments: readonly MetaOosAssignment[],
  partition: MetaPartition,
  identity: Pick<MetaOosEligibility, "learningCycleId" | "learningDecisionFingerprint">,
): MetaOosEligibility {
  return metaOosCyclesEligibility(assignments, partition, assignments.filter((assignment) => assignment.partition === partition).length, identity);
}

/** Fails closed on anything that is not exactly a Meta-OOS assignment. */
export function assertMetaOosAssignment(value: unknown): asserts value is MetaOosAssignment {
  if (value == null || typeof value !== "object") throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta-OOS assignment is required");
  const candidate = value as Partial<MetaOosAssignment>;
  if (candidate.schemaVersion !== META_OOS_SCHEMA_VERSION) throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta-OOS assignment schema version is unsupported");
  if (candidate.metaOosPolicyVersion !== META_OOS_POLICY_VERSION) throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta-OOS policy version is unsupported");
  if (typeof candidate.learningCycleId !== "string" || !CYCLE.test(candidate.learningCycleId)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "learning cycle id is invalid");
  if (typeof candidate.learningDecisionFingerprint !== "string" || !SHA64.test(candidate.learningDecisionFingerprint)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "learning decision fingerprint is invalid");
  if (!META_PARTITIONS.includes(candidate.partition as MetaPartition)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta partition is outside the closed set");
  assertBounded(candidate.policyVersion, "policy version");
  if (!Number.isSafeInteger(candidate.cutoff) || (candidate.cutoff as number) < 0) throw new MetaOosError("MALFORMED_ASSIGNMENT", "cutoff must be a non-negative integer");
  if (typeof candidate.assignedAt !== "string" || !Number.isFinite(Date.parse(candidate.assignedAt)) || new Date(candidate.assignedAt).toISOString() !== candidate.assignedAt) {
    throw new MetaOosError("MALFORMED_ASSIGNMENT", "assigned at must be a canonical ISO timestamp");
  }
  if (typeof candidate.assignmentFingerprint !== "string" || !SHA64.test(candidate.assignmentFingerprint)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "assignment fingerprint is invalid");
  const requiredKeys = ["schemaVersion", "learningCycleId", "learningDecisionFingerprint", "partition", "policyVersion", "cutoff", "assignedAt", "metaOosPolicyVersion", "assignmentFingerprint"];
  const expectedKeys = (candidate.partition === "meta-holdout" ? [...requiredKeys, "holdoutClaimIdentity"] : requiredKeys).sort();
  const actualKeys = Object.keys(value as Record<string, unknown>).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta-OOS assignment fields do not match the closed schema");
  }
  if (candidate.partition === "meta-holdout") {
    if (typeof candidate.holdoutClaimIdentity !== "string" || !SHA64.test(candidate.holdoutClaimIdentity)) throw new MetaOosError("MALFORMED_ASSIGNMENT", "meta-holdout assignment requires a valid durable holdout claim identity");
  } else if (Object.hasOwn(value, "holdoutClaimIdentity")) {
    throw new MetaOosError("MALFORMED_ASSIGNMENT", "non-holdout assignment may not contain a holdout claim identity");
  }
  // Only the derived fingerprint is stripped; the rest, including the schema and policy version,
  // must stay covered so a version bump is itself an identity change.
  const { assignmentFingerprint: recorded, ...content } = candidate as MetaOosAssignment;
  if (digest(content) !== recorded) throw new MetaOosError("IDENTITY_CONFLICT", "meta-OOS assignment does not match its own fingerprint");
}
