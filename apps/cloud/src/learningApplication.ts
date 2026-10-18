import { createHash } from "node:crypto";
import { assessChange, assertLearningDecision, learningDecisionFingerprint, type LearningDecision } from "./learningDecision";

/**
 * A4 - bounded application, plus M3 integration with the existing steering surface.
 *
 * A1's `ADMISSIBLE` means "at least one change passed the local aperture", not "the runtime changed".
 * This module is the step that turns an admitted change into an actual, bounded, exactly-once side effect,
 * and it produces the receipt that says what really happened.
 *
 * Three properties are load-bearing here.
 *
 * **Fail-closed on meta-OOS eligibility.** Application is refused unless an eligibility proof is
 * supplied. Meta-OOS (A3) does not exist yet, so no eligible proof can be produced yet, so no learning
 * decision may autonomously change research policy today. That is deliberate: the mechanics are built
 * and tested now, and the door opens only once cross-cycle validation exists to justify it. There is
 * no bypass, no "just this once", and no default-true.
 *
 * **Never rebase a stale decision.** A decision made against `currentValue = 2` is checked against the
 * canonical current value immediately before application. If the runtime has moved on, the decision is
 * refused as STALE rather than quietly retargeted onto the new value, because a change computed from
 * one state and applied to another is not the change that was reviewed.
 *
 * **Defense in depth.** The immutable surface and the aperture are re-checked here even though A1
 * already refused them. A1's verdict is evidence, not authority to skip a check.
 *
 * This module owns no steering policy. `metaLearningSteering()` stays the canonical producer of
 * `longBarTickEvery`; the fail-safe reset to 1 on an error path is preserved unchanged, and the
 * receipt records the requested, bounded, and actually-applied values separately so a fallback can
 * never be mistaken for a success (v2 sections 9-17).
 */

export const LEARNING_APPLICATION_SCHEMA_VERSION = 1;
export const APPLICATION_OUTCOME_VERSION = "learning-application-outcome-v1";

export class LearningApplicationError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningApplicationError";
  }
}

/** `FAILED` is kept out of the decision outcome on purpose: it is an execution fact, not a conclusion. */
/**
 * `NOOP` is defensive rather than currently reachable: with the stale guard in front of it, a
 * decision whose premise and target both match the runtime would have to be a no-change proposal,
 * and A1 refuses those before they ever reach here.
 */
export type ApplicationOutcome = "APPLIED" | "NOOP" | "REJECTED" | "FAILED";

export interface LearningApplicationReceipt {
  readonly schemaVersion: typeof LEARNING_APPLICATION_SCHEMA_VERSION;
  readonly learningDecisionFingerprint: string;
  readonly learningCycleId: string;
  readonly surface: string;
  readonly previousValue: number;
  readonly requestedValue: number;
  readonly boundedValue: number;
  readonly appliedValue: number;
  readonly applicationOutcome: ApplicationOutcome;
  /** Populated only when a fallback was taken, naming why. A fallback is never reported as success. */
  readonly fallbackReason?: string;
  /** Populated only on a refusal, naming which check refused it. Refusals are durable evidence. */
  readonly rejectionReason?: string;
  readonly applicationFingerprint: string;
  readonly applicationTimestamp: string;
  readonly runtimeIdentity: string;
  readonly sourceCommit: string;
  readonly outcomeVersion: typeof APPLICATION_OUTCOME_VERSION;
}

/**
 * Proof that a decision may be applied under cross-cycle validation.
 *
 * A3 does not exist yet, so the only value a caller can honestly produce is ineligible. Making this a
 * required argument rather than an optional one is what stops "not implemented yet" from silently
 * reading as "allowed".
 */
export interface MetaOosEligibility {
  readonly eligible: boolean;
  readonly partition: string;
  readonly cyclesEvaluated: number;
  readonly reason: string;
}

/** The runtime's own canonical state and setter. Only ever reached after every check has passed. */
export interface ApplicationPorts {
  /** Canonical current value of a surface, read from the same place the runtime reads it. */
  readonly readCurrent: (surface: string) => number;
  /** The existing canonical application surface. Throws to signal an execution failure. */
  readonly commit: (surface: string, value: number) => void;
  /** The preserved fail-safe target, applied when `commit` throws. */
  readonly failSafeValue: (surface: string) => number;
}

export interface ApplicationContext {
  readonly applicationTimestamp: string;
  readonly runtimeIdentity: string;
  readonly sourceCommit: string;
}

const SHA64 = /^[a-f0-9]{64}$/;
const BOUNDED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LearningApplicationError("NON_FINITE_VALUE", "application receipt contains a non-finite number");
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
  throw new LearningApplicationError("NON_CANONICAL_VALUE", "application receipt contains a value that has no canonical form");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

/**
 * The durable identity of one application attempt.
 *
 * It covers the decision, the surface, the previous and bounded values, and the outcome, so replaying
 * the same attempt reproduces exactly this identity and therefore exactly one side effect.
 */
export function applicationFingerprint(receipt: Omit<LearningApplicationReceipt, "applicationFingerprint" | "schemaVersion" | "outcomeVersion">): string {
  return digest({
    learningDecisionFingerprint: receipt.learningDecisionFingerprint,
    learningCycleId: receipt.learningCycleId,
    surface: receipt.surface,
    previousValue: receipt.previousValue,
    requestedValue: receipt.requestedValue,
    boundedValue: receipt.boundedValue,
    appliedValue: receipt.appliedValue,
    applicationOutcome: receipt.applicationOutcome,
    fallbackReason: receipt.fallbackReason ?? null,
    rejectionReason: receipt.rejectionReason ?? null,
  });
}

function buildReceipt(fields: Omit<LearningApplicationReceipt, "applicationFingerprint" | "schemaVersion" | "outcomeVersion">): LearningApplicationReceipt {
  return Object.freeze({
    ...fields,
    schemaVersion: LEARNING_APPLICATION_SCHEMA_VERSION,
    outcomeVersion: APPLICATION_OUTCOME_VERSION,
    applicationFingerprint: applicationFingerprint(fields),
  });
}

function assertContext(context: ApplicationContext): void {
  if (context == null || typeof context !== "object") throw new LearningApplicationError("MALFORMED_CONTEXT", "application context is required");
  for (const [field, value] of Object.entries({ applicationTimestamp: context.applicationTimestamp, runtimeIdentity: context.runtimeIdentity, sourceCommit: context.sourceCommit })) {
    if (typeof value !== "string" || !BOUNDED.test(value)) throw new LearningApplicationError("MALFORMED_CONTEXT", field + " must be a bounded identifier");
  }
}

function assertEligibility(eligibility: MetaOosEligibility): void {
  if (eligibility == null || typeof eligibility !== "object") throw new LearningApplicationError("MALFORMED_ELIGIBILITY", "meta-OOS eligibility proof is required");
  if (typeof eligibility.reason !== "string" || eligibility.reason.length === 0) throw new LearningApplicationError("MALFORMED_ELIGIBILITY", "eligibility must state its reason");
}

/**
 * Records what an application attempt concluded, keyed by decision and surface.
 *
 * Exactly-once lives here rather than in a counter: the same decision attempting the same surface a
 * second time is answered with the first receipt and never reaches the setter again.
 */
export class ApplicationRegistry {
  private readonly receipts = new Map<string, LearningApplicationReceipt>();

  public recorded(decisionFingerprint: string, surface: string): LearningApplicationReceipt | undefined {
    return this.receipts.get(decisionFingerprint + "|" + surface);
  }

  public record(receipt: LearningApplicationReceipt): void {
    const key = receipt.learningDecisionFingerprint + "|" + receipt.surface;
    const existing = this.receipts.get(key);
    if (existing != null) {
      if (existing.applicationFingerprint !== receipt.applicationFingerprint) {
        throw new LearningApplicationError("IDENTITY_CONFLICT", "decision and surface were applied twice with different outcomes");
      }
      return;
    }
    this.receipts.set(key, receipt);
  }

  /** Removes an in-memory receipt whose side effect was rolled back before durable append. */
  public forget(receipt: LearningApplicationReceipt): void {
    const key = receipt.learningDecisionFingerprint + "|" + receipt.surface;
    if (this.receipts.get(key)?.applicationFingerprint === receipt.applicationFingerprint) this.receipts.delete(key);
  }

  /** Rehydrates from durable history after a restart, so exactly-once survives the process. */
  public rehydrate(receipts: readonly LearningApplicationReceipt[]): void {
    for (const receipt of receipts) this.record(receipt);
  }

  public size(): number {
    return this.receipts.size;
  }
}

function refusal(decision: LearningDecision, fingerprint: string, surface: string, previousValue: number, requestedValue: number, boundedValue: number, context: ApplicationContext, reason: string): LearningApplicationReceipt {
  return buildReceipt({
    learningDecisionFingerprint: fingerprint,
    learningCycleId: decision.learningCycleId,
    surface,
    previousValue,
    requestedValue,
    boundedValue,
    appliedValue: previousValue,
    applicationOutcome: "REJECTED",
    rejectionReason: reason,
    applicationTimestamp: context.applicationTimestamp,
    runtimeIdentity: context.runtimeIdentity,
    sourceCommit: context.sourceCommit,
  });
}

/**
 * Applies at most one admitted change, exactly once, and always reports what actually happened.
 *
 * The checks run in a fixed order so the reason a refusal happened is deterministic and reviewable:
 * decision verdict, then meta-OOS eligibility, then defense in depth on the surface, then the
 * stale-current-value guard, then no-op detection. Only after all of them does the setter get called.
 */
export function applyBoundedChange(
  decision: LearningDecision,
  eligibility: MetaOosEligibility,
  ports: ApplicationPorts,
  context: ApplicationContext,
  registry: ApplicationRegistry,
): LearningApplicationReceipt {
  assertLearningDecision(decision);
  assertEligibility(eligibility);
  assertContext(context);
  if (ports == null || typeof ports !== "object") throw new LearningApplicationError("MALFORMED_PORTS", "application ports are required");

  const fingerprint = learningDecisionFingerprint(decision);

  // A decision that never admitted a change has nothing to apply, whatever it claims.
  const change = decision.admissibleChanges[0];
  if (decision.decisionOutcome !== "ADMISSIBLE" || change == null) {
    const receipt = refusal(decision, fingerprint, "none", 0, 0, 0, context, "decision outcome did not admit a bounded change");
    registry.record(receipt);
    return receipt;
  }

  // Meta-OOS eligibility is checked before any surface is touched, so a system without A3 cannot
  // mutate research policy no matter what else is true.
  if (!eligibility.eligible) {
    const current = ports.readCurrent(change.surface);
    const receipt = refusal(decision, fingerprint, change.surface, current, change.proposedValue, current, context, "meta-OOS eligibility not established: " + eligibility.reason);
    registry.record(receipt);
    return receipt;
  }

  // Defense in depth: A1's admission is not authority to skip the check.
  const reassessment = assessChange({ surface: change.surface, currentValue: change.currentValue, proposedValue: change.proposedValue });
  if (reassessment.verdict !== "ADMISSIBLE") {
    const current = ports.readCurrent(change.surface);
    const receipt = refusal(decision, fingerprint, change.surface, current, change.proposedValue, current, context, "surface re-check failed: " + reassessment.reason);
    registry.record(receipt);
    return receipt;
  }

  const previousValue = ports.readCurrent(change.surface);
  const requestedValue = change.proposedValue;
  const boundedValue = change.proposedValue;

  // Exactly-once: the same decision and surface never produces a second side effect. A replay is
  // answered with the first receipt, so it neither re-reads the runtime nor reaches the setter again.
  const existing = registry.recorded(fingerprint, change.surface);
  if (existing != null) return existing;

  // Stale guard: a decision computed against one value may not be applied to another.
  if (previousValue !== change.currentValue) {
    const receipt = refusal(decision, fingerprint, change.surface, previousValue, requestedValue, previousValue, context, "stale previous value: decision expected " + String(change.currentValue) + " but the runtime is at " + String(previousValue));
    registry.record(receipt);
    return receipt;
  }

  // Already at the target: nothing to do, and nothing to claim.
  if (previousValue === requestedValue) {
    const receipt = buildReceipt({
      learningDecisionFingerprint: fingerprint,
      learningCycleId: decision.learningCycleId,
      surface: change.surface,
      previousValue,
      requestedValue,
      boundedValue,
      appliedValue: previousValue,
      applicationOutcome: "NOOP",
      applicationTimestamp: context.applicationTimestamp,
      runtimeIdentity: context.runtimeIdentity,
      sourceCommit: context.sourceCommit,
    });
    registry.record(receipt);
    return receipt;
  }

  try {
    ports.commit(change.surface, boundedValue);
  } catch (error) {
    // The preserved fail-safe: an execution failure falls back rather than leaving a half-applied
    // policy, and the receipt says so instead of reporting success.
    const fallback = ports.failSafeValue(change.surface);
    const receipt = buildReceipt({
      learningDecisionFingerprint: fingerprint,
      learningCycleId: decision.learningCycleId,
      surface: change.surface,
      previousValue,
      requestedValue,
      boundedValue,
      appliedValue: fallback,
      applicationOutcome: "FAILED",
      fallbackReason: error instanceof Error ? error.message : "application surface threw",
      applicationTimestamp: context.applicationTimestamp,
      runtimeIdentity: context.runtimeIdentity,
      sourceCommit: context.sourceCommit,
    });
    registry.record(receipt);
    return receipt;
  }

  const receipt = buildReceipt({
    learningDecisionFingerprint: fingerprint,
    learningCycleId: decision.learningCycleId,
    surface: change.surface,
    previousValue,
    requestedValue,
    boundedValue,
    appliedValue: boundedValue,
    applicationOutcome: "APPLIED",
    applicationTimestamp: context.applicationTimestamp,
    runtimeIdentity: context.runtimeIdentity,
    sourceCommit: context.sourceCommit,
  });
  registry.record(receipt);
  return receipt;
}

/** Fails closed on anything that is not exactly an application receipt. */
export function assertLearningApplicationReceipt(value: unknown): asserts value is LearningApplicationReceipt {
  if (value == null || typeof value !== "object") throw new LearningApplicationError("MALFORMED_RECEIPT", "application receipt is required");
  const candidate = value as Partial<LearningApplicationReceipt>;
  if (candidate.schemaVersion !== LEARNING_APPLICATION_SCHEMA_VERSION) throw new LearningApplicationError("MALFORMED_RECEIPT", "application receipt schema version is unsupported");
  if (candidate.outcomeVersion !== APPLICATION_OUTCOME_VERSION) throw new LearningApplicationError("MALFORMED_RECEIPT", "application outcome version is unsupported");
  if (!SHA64.test(candidate.learningDecisionFingerprint ?? "")) throw new LearningApplicationError("MALFORMED_RECEIPT", "application receipt decision fingerprint is invalid");
  if (!["APPLIED", "NOOP", "REJECTED", "FAILED"].includes(candidate.applicationOutcome ?? "")) throw new LearningApplicationError("MALFORMED_RECEIPT", "application outcome is outside the closed set");
  for (const field of ["previousValue", "requestedValue", "boundedValue", "appliedValue"] as const) {
    if (!Number.isFinite(candidate[field])) throw new LearningApplicationError("MALFORMED_RECEIPT", field + " must be a finite number");
  }
  if (typeof candidate.applicationFingerprint !== "string" || !SHA64.test(candidate.applicationFingerprint)) throw new LearningApplicationError("MALFORMED_RECEIPT", "application fingerprint is invalid");
  const { schemaVersion: _schema, outcomeVersion: _outcome, applicationFingerprint: recorded, ...content } = candidate as LearningApplicationReceipt;
  if (applicationFingerprint(content) !== recorded) throw new LearningApplicationError("IDENTITY_CONFLICT", "application receipt does not match its own fingerprint");
}
