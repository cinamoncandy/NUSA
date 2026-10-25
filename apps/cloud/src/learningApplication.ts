import { createHash } from "node:crypto";
import { assessChange, assertLearningDecision, assertLearningDecisionPremisesMatchCurrentSpec, learningDecisionFingerprint, MUTABLE_SURFACE_ALLOWLIST, type LearningDecision, type LearningDecisionCurrentResearchSpec } from "./learningDecision";

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
  readonly previousResearchSpecFingerprint: string;
  readonly intentFingerprint: string;
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
  readonly learningCycleId: string;
  readonly learningDecisionFingerprint: string;
}

export interface LearningApplicationIntent {
  readonly schemaVersion: typeof LEARNING_APPLICATION_SCHEMA_VERSION;
  readonly learningDecisionFingerprint: string;
  readonly learningCycleId: string;
  readonly previousResearchSpecFingerprint: string;
  readonly surface: string;
  readonly previousValue: number;
  readonly requestedValue: number;
  readonly boundedValue: number;
  readonly applicationTimestamp: string;
  readonly runtimeIdentity: string;
  readonly sourceCommit: string;
  readonly intentFingerprint: string;
}

export interface LearningApplicationJournal {
  terminalFor(decisionFingerprint: string, surface: string): LearningApplicationReceipt | undefined;
  pendingIntentFor(decisionFingerprint: string, surface: string): LearningApplicationIntent | undefined;
  pendingIntentForSurface(surface: string): LearningApplicationIntent | undefined;
  /** Returns true only for the invocation that durably created the write-ahead claim. */
  appendIntent(intent: LearningApplicationIntent): boolean;
  append(receipt: LearningApplicationReceipt): { readonly receipt: LearningApplicationReceipt };
}

export interface ApplicationLeaseResult<T> {
  readonly acquired: boolean;
  readonly value?: T;
}

/** The runtime's own canonical state and setter. Only ever reached after every check has passed. */
export interface ApplicationPorts {
  /** Canonical A3 owner lookup; omitted means ineligible. */
  readonly resolveMetaOosEligibility?: (decision: LearningDecision, decisionFingerprint: string) => MetaOosEligibility;
  /** Owner-read full spec identity and values, not a caller assertion. */
  readonly readCurrentResearchSpec: () => LearningDecisionCurrentResearchSpec;
  /** Reconcile a durable pending intent using the canonical application owner after restart. */
  readonly reconcileIntent?: (intent: LearningApplicationIntent) => "APPLIED" | "NOT_APPLIED" | "UNKNOWN";
  /** Existing canonical single-writer owner; the entire read/intent/mutate/receipt sequence runs inside it. */
  readonly withExclusiveApplicationLease: <T>(identity: string, operation: () => T) => ApplicationLeaseResult<T>;
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
  });
}

export function learningApplicationIntentFingerprint(intent: Omit<LearningApplicationIntent, "intentFingerprint" | "schemaVersion">): string {
  return digest(intent);
}

function buildReceipt(fields: Omit<LearningApplicationReceipt, "applicationFingerprint" | "schemaVersion" | "outcomeVersion">): LearningApplicationReceipt {
  return Object.freeze({
    ...fields,
    schemaVersion: LEARNING_APPLICATION_SCHEMA_VERSION,
    outcomeVersion: APPLICATION_OUTCOME_VERSION,
    applicationFingerprint: applicationFingerprint(fields),
  });
}

function buildIntent(fields: Omit<LearningApplicationIntent, "intentFingerprint" | "schemaVersion">): LearningApplicationIntent {
  const canonicalFields = { ...fields, schemaVersion: LEARNING_APPLICATION_SCHEMA_VERSION as typeof LEARNING_APPLICATION_SCHEMA_VERSION };
  return Object.freeze({ ...canonicalFields, intentFingerprint: learningApplicationIntentFingerprint(fields) });
}

function assertContext(context: ApplicationContext): void {
  if (context == null || typeof context !== "object") throw new LearningApplicationError("MALFORMED_CONTEXT", "application context is required");
  for (const [field, value] of Object.entries({ applicationTimestamp: context.applicationTimestamp, runtimeIdentity: context.runtimeIdentity, sourceCommit: context.sourceCommit })) {
    if (typeof value !== "string" || !BOUNDED.test(value)) throw new LearningApplicationError("MALFORMED_CONTEXT", field + " must be a bounded identifier");
  }
}

function assertEligibility(eligibility: MetaOosEligibility, decision: LearningDecision, fingerprint: string): void {
  if (eligibility == null || typeof eligibility !== "object") throw new LearningApplicationError("MALFORMED_ELIGIBILITY", "meta-OOS eligibility proof is required");
  if (typeof eligibility.eligible !== "boolean") throw new LearningApplicationError("MALFORMED_ELIGIBILITY", "eligibility result must be a boolean");
  if (!Number.isSafeInteger(eligibility.cyclesEvaluated) || eligibility.cyclesEvaluated < 0) throw new LearningApplicationError("MALFORMED_ELIGIBILITY", "cycles evaluated must be a non-negative safe integer");
  if (typeof eligibility.reason !== "string" || eligibility.reason.length === 0) throw new LearningApplicationError("MALFORMED_ELIGIBILITY", "eligibility must state its reason");
  if (eligibility.learningCycleId !== decision.learningCycleId || eligibility.learningDecisionFingerprint !== fingerprint) throw new LearningApplicationError("ELIGIBILITY_IDENTITY_MISMATCH", "meta-OOS eligibility is not bound to the exact decision cycle");
  if (eligibility.eligible && (eligibility.partition !== "meta-holdout" || eligibility.cyclesEvaluated < 3)) throw new LearningApplicationError("ELIGIBILITY_POLICY_INVALID", "only a sufficiently evidenced meta-holdout may authorize application");
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
    // A refusal is evidence about one attempt, not a terminal application. Do not let a temporary
    // META/readiness refusal permanently pin this decision to REJECTED.
    if (receipt.applicationOutcome === "REJECTED") return;
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

  /** Rehydrates from durable history after a restart, so exactly-once survives the process. */
  public rehydrate(receipts: readonly LearningApplicationReceipt[]): void {
    for (const receipt of receipts) this.record(receipt);
  }

  public size(): number {
    return this.receipts.size;
  }
}

function refusal(decision: LearningDecision, fingerprint: string, surface: string, previousValue: number, requestedValue: number, boundedValue: number, context: ApplicationContext, reason: string): LearningApplicationReceipt {
  const intent = buildIntent({
    learningDecisionFingerprint: fingerprint,
    learningCycleId: decision.learningCycleId,
    previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
    surface,
    previousValue,
    requestedValue,
    boundedValue,
    applicationTimestamp: context.applicationTimestamp,
    runtimeIdentity: context.runtimeIdentity,
    sourceCommit: context.sourceCommit,
  });
  return buildReceipt({
    learningDecisionFingerprint: fingerprint,
    learningCycleId: decision.learningCycleId,
    previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
    intentFingerprint: intent.intentFingerprint,
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
  ports: ApplicationPorts,
  context: ApplicationContext,
  journal: LearningApplicationJournal,
  registry: ApplicationRegistry,
): LearningApplicationReceipt {
  assertLearningDecision(decision);
  assertContext(context);
  if (ports == null || typeof ports !== "object" || journal == null || typeof journal !== "object") throw new LearningApplicationError("MALFORMED_PORTS", "application ports and durable journal are required");

  const admittedChange = decision.decisionOutcome === "ADMISSIBLE" ? decision.admissibleChanges[0] : undefined;
  // Serialize by mutation surface across cycles. A per-cycle key would allow two decisions to
  // race through the same canonical setter and strand each other's write-ahead intents.
  const leaseIdentity = admittedChange == null ? "learning-application:none" : "learning-application:surface:" + admittedChange.surface;
  if (typeof ports.withExclusiveApplicationLease !== "function") throw new LearningApplicationError("APPLICATION_OWNER_UNAVAILABLE", "canonical exclusive application owner is required");
  const leased = ports.withExclusiveApplicationLease(leaseIdentity, () => applyBoundedChangeUnderLease(decision, ports, context, journal, registry));
  if (leased == null || leased.acquired !== true) throw new LearningApplicationError("APPLICATION_OWNER_BUSY", "canonical application owner did not grant the exclusive lease; no mutation was attempted");
  if (!("value" in leased)) throw new LearningApplicationError("APPLICATION_OWNER_RESULT_MISSING", "exclusive application owner returned no operation result");
  return leased.value as LearningApplicationReceipt;
}

function applyBoundedChangeUnderLease(
  decision: LearningDecision,
  ports: ApplicationPorts,
  context: ApplicationContext,
  journal: LearningApplicationJournal,
  registry: ApplicationRegistry,
): LearningApplicationReceipt {

  const fingerprint = learningDecisionFingerprint(decision);

  // A decision that never admitted a change has nothing to apply, whatever it claims.
  const change = decision.admissibleChanges[0];
  const reject = (surface: string, previousValue: number, requestedValue: number, boundedValue: number, reason: string): LearningApplicationReceipt => {
    const receipt = refusal(decision, fingerprint, surface, previousValue, requestedValue, boundedValue, context, reason);
    const durable = journal.append(receipt).receipt;
    registry.record(durable);
    return durable;
  };
  if (decision.decisionOutcome !== "ADMISSIBLE" || change == null) {
    return reject("none", 0, 0, 0, "decision outcome did not admit a bounded change");
  }

  // A durable terminal mutation wins over any later eligibility or runtime-state fluctuation.
  // REJECTED is not cached as terminal: a later durable META evaluation may legitimately change it.
  const durableExisting = journal.terminalFor(fingerprint, change.surface);
  if (durableExisting != null && durableExisting.applicationOutcome !== "REJECTED") {
    registry.record(durableExisting);
    return durableExisting;
  }
  const existing = registry.recorded(fingerprint, change.surface);
  if (existing != null && existing.applicationOutcome !== "REJECTED") return existing;

  const priorIntent = journal.pendingIntentForSurface(change.surface);
  if (priorIntent != null) {
    // Resolve any older intent on this surface before considering the new decision. A single
    // invocation closes that prior attempt and never mutates for both decisions.
    return recoverIntent(priorIntent, ports, journal, registry);
  }

  // Meta-OOS eligibility is checked before any surface is touched, so a system without A3 cannot
  // mutate research policy no matter what else is true.
  let eligibility: MetaOosEligibility;
  try {
    eligibility = ports.resolveMetaOosEligibility?.(decision, fingerprint) ?? Object.freeze({
      eligible: false,
      partition: "meta-holdout",
      cyclesEvaluated: 0,
      reason: "canonical META-OOS owner is not wired",
      learningCycleId: decision.learningCycleId,
      learningDecisionFingerprint: fingerprint,
    });
    assertEligibility(eligibility, decision, fingerprint);
  } catch (error) {
    const current = ports.readCurrent(change.surface);
    const reason = error instanceof Error ? error.message : "canonical META-OOS lookup failed";
    return reject(change.surface, current, change.proposedValue, current, "meta-OOS eligibility unavailable: " + reason);
  }
  if (!eligibility.eligible) {
    const current = ports.readCurrent(change.surface);
    return reject(change.surface, current, change.proposedValue, current, "meta-OOS eligibility not established: " + eligibility.reason);
  }

  // Verify the full owner-read research identity immediately before application. Matching only the
  // numeric cadence is insufficient if another field in the canonical spec has changed.
  let currentSpec: LearningDecisionCurrentResearchSpec;
  try {
    currentSpec = ports.readCurrentResearchSpec();
    assertLearningDecisionPremisesMatchCurrentSpec(decision, currentSpec);
  } catch (error) {
    const current = ports.readCurrent(change.surface);
    const reason = error instanceof Error ? error.message : "canonical current research spec is unavailable";
    return reject(change.surface, current, change.proposedValue, current, "current research spec failed validation: " + reason);
  }

  // Defense in depth: A1's admission is not authority to skip the check.
  const reassessment = assessChange({ surface: change.surface, currentValue: change.currentValue, proposedValue: change.proposedValue });
  if (reassessment.verdict !== "ADMISSIBLE") {
    const current = ports.readCurrent(change.surface);
    return reject(change.surface, current, change.proposedValue, current, "surface re-check failed: " + reassessment.reason);
  }

  const previousValue = ports.readCurrent(change.surface);
  const requestedValue = change.proposedValue;
  const boundedValue = change.proposedValue;

  // Exactly-once: the same decision and surface never produces a second side effect. A replay is
  // answered with the first receipt, so it neither re-reads the runtime nor reaches the setter again.
  const existingAfterRead = registry.recorded(fingerprint, change.surface);
  if (existingAfterRead != null && existingAfterRead.applicationOutcome !== "REJECTED") return existingAfterRead;

  // Stale guard: a decision computed against one value may not be applied to another.
  if (previousValue !== change.currentValue) {
    return reject(change.surface, previousValue, requestedValue, previousValue, "stale previous value: decision expected " + String(change.currentValue) + " but the runtime is at " + String(previousValue));
  }

  // Already at the target: nothing to do, and nothing to claim.
  if (previousValue === requestedValue) {
    const intent = buildIntent({
      learningDecisionFingerprint: fingerprint,
      learningCycleId: decision.learningCycleId,
      previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
      surface: change.surface,
      previousValue,
      requestedValue,
      boundedValue,
      applicationTimestamp: context.applicationTimestamp,
      runtimeIdentity: context.runtimeIdentity,
      sourceCommit: context.sourceCommit,
    });
    if (journal.appendIntent(intent) !== true) throw new LearningApplicationError("APPLICATION_INTENT_ALREADY_CLAIMED", "another application attempt already owns the durable intent; no mutation was attempted");
    const receipt = buildReceipt({
      learningDecisionFingerprint: fingerprint,
      learningCycleId: decision.learningCycleId,
      previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
      intentFingerprint: intent.intentFingerprint,
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
    const durable = journal.append(receipt).receipt;
    registry.record(durable);
    return durable;
  }

  const intent = priorIntent ?? buildIntent({
    learningDecisionFingerprint: fingerprint,
    learningCycleId: decision.learningCycleId,
    previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
    surface: change.surface,
    previousValue,
    requestedValue,
    boundedValue,
    applicationTimestamp: context.applicationTimestamp,
    runtimeIdentity: context.runtimeIdentity,
    sourceCommit: context.sourceCommit,
  });
  // Write-ahead identity is durable before the runtime surface changes. If the process dies after
  // commit but before the outcome receipt, restart reconciliation must prove what happened.
  if (priorIntent == null && journal.appendIntent(intent) !== true) {
    throw new LearningApplicationError("APPLICATION_INTENT_ALREADY_CLAIMED", "another application attempt already owns the durable intent; no mutation was attempted");
  }

  try {
    ports.commit(change.surface, boundedValue);
    const actualApplied = ports.readCurrent(change.surface);
    if (actualApplied !== boundedValue) throw new LearningApplicationError("APPLICATION_READBACK_MISMATCH", "canonical application value does not match the requested bounded value");
  } catch (error) {
    // The preserved fail-safe: an execution failure falls back rather than leaving a half-applied
    // policy, and the receipt says so instead of reporting success.
    const fallback = ports.failSafeValue(change.surface);
    const surfacePolicy = MUTABLE_SURFACE_ALLOWLIST.find((candidate) => candidate.surface === change.surface);
    if (surfacePolicy == null || fallback !== surfacePolicy.failSafeValue || !Number.isSafeInteger(fallback)
      || fallback < surfacePolicy.minimum || fallback > surfacePolicy.maximum) {
      throw new LearningApplicationError("FAIL_SAFE_TARGET_INVALID", "canonical fail-safe target does not match the owner-defined surface contract");
    }
    try {
      ports.commit(change.surface, fallback);
    } catch {
      throw new LearningApplicationError("FAIL_SAFE_APPLY_FAILED", "application failed and fail-safe value could not be committed");
    }
    const actualFallback = ports.readCurrent(change.surface);
    if (actualFallback !== fallback) throw new LearningApplicationError("FAIL_SAFE_READBACK_MISMATCH", "committed fail-safe value does not match canonical read-back");
    const receipt = buildReceipt({
      learningDecisionFingerprint: fingerprint,
      learningCycleId: decision.learningCycleId,
      previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
      intentFingerprint: intent.intentFingerprint,
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
    const durable = journal.append(receipt).receipt;
    registry.record(durable);
    return durable;
  }

  const receipt = buildReceipt({
    learningDecisionFingerprint: fingerprint,
    learningCycleId: decision.learningCycleId,
    previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
    intentFingerprint: intent.intentFingerprint,
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
  const durable = journal.append(receipt).receipt;
  registry.record(durable);
  return durable;
}

function recoverIntent(
  intent: LearningApplicationIntent,
  ports: ApplicationPorts,
  journal: LearningApplicationJournal,
  registry: ApplicationRegistry,
): LearningApplicationReceipt {
  const reconciliation = ports.reconcileIntent?.(intent) ?? "UNKNOWN";
  if (reconciliation !== "APPLIED" && reconciliation !== "NOT_APPLIED" && reconciliation !== "UNKNOWN") {
    throw new LearningApplicationError("APPLICATION_INTENT_UNRESOLVED", "canonical reconciliation returned an unsupported result; no mutation was attempted");
  }
  if (reconciliation === "UNKNOWN") throw new LearningApplicationError("APPLICATION_INTENT_UNRESOLVED", "durable application intent cannot be reconciled safely; no mutation was attempted");
  const appliedValue = ports.readCurrent(intent.surface);
  if (reconciliation === "APPLIED" && appliedValue !== intent.boundedValue) {
    throw new LearningApplicationError("APPLICATION_INTENT_READBACK_MISMATCH", "reconciled applied intent does not match canonical state");
  }
  const receipt = buildReceipt({
    learningDecisionFingerprint: intent.learningDecisionFingerprint,
    learningCycleId: intent.learningCycleId,
    previousResearchSpecFingerprint: intent.previousResearchSpecFingerprint,
    intentFingerprint: intent.intentFingerprint,
    surface: intent.surface,
    previousValue: intent.previousValue,
    requestedValue: intent.requestedValue,
    boundedValue: intent.boundedValue,
    appliedValue,
    applicationOutcome: reconciliation === "APPLIED" ? "APPLIED" : "REJECTED",
    ...(reconciliation === "NOT_APPLIED" ? { rejectionReason: "recovery confirmed the previous intent was not applied; a new bounded attempt is required" } : {}),
    applicationTimestamp: intent.applicationTimestamp,
    runtimeIdentity: intent.runtimeIdentity,
    sourceCommit: intent.sourceCommit,
  });
  const durable = journal.append(receipt).receipt;
  registry.record(durable);
  return durable;
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
  if (!SHA64.test(candidate.intentFingerprint ?? "")) throw new LearningApplicationError("MALFORMED_RECEIPT", "application intent fingerprint is invalid");
  if (typeof candidate.learningCycleId !== "string" || !/^learning-cycle:[a-f0-9]{64}$/.test(candidate.learningCycleId)) throw new LearningApplicationError("MALFORMED_RECEIPT", "application cycle identity is invalid");
  if (!SHA64.test(candidate.previousResearchSpecFingerprint ?? "")) throw new LearningApplicationError("MALFORMED_RECEIPT", "application research spec identity is invalid");
  assertContext({
    applicationTimestamp: candidate.applicationTimestamp ?? "",
    runtimeIdentity: candidate.runtimeIdentity ?? "",
    sourceCommit: candidate.sourceCommit ?? "",
  });
  const requiredKeys = ["schemaVersion", "learningDecisionFingerprint", "learningCycleId", "previousResearchSpecFingerprint", "intentFingerprint", "surface", "previousValue", "requestedValue", "boundedValue", "appliedValue", "applicationOutcome", "applicationFingerprint", "applicationTimestamp", "runtimeIdentity", "sourceCommit", "outcomeVersion"];
  const expectedKeys = (candidate.applicationOutcome === "FAILED" ? [...requiredKeys, "fallbackReason"] : candidate.applicationOutcome === "REJECTED" ? [...requiredKeys, "rejectionReason"] : requiredKeys).sort();
  const actualKeys = Object.keys(value as Record<string, unknown>).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) throw new LearningApplicationError("MALFORMED_RECEIPT", "application receipt fields do not match the closed schema");
  const { schemaVersion: _schema, outcomeVersion: _outcome, applicationFingerprint: recorded, ...content } = candidate as LearningApplicationReceipt;
  if (applicationFingerprint(content) !== recorded) throw new LearningApplicationError("IDENTITY_CONFLICT", "application receipt does not match its own fingerprint");
}

export function assertLearningApplicationIntent(value: unknown): asserts value is LearningApplicationIntent {
  if (value == null || typeof value !== "object") throw new LearningApplicationError("MALFORMED_INTENT", "application intent is required");
  const candidate = value as Partial<LearningApplicationIntent>;
  if (candidate.schemaVersion !== LEARNING_APPLICATION_SCHEMA_VERSION) throw new LearningApplicationError("MALFORMED_INTENT", "application intent schema version is unsupported");
  if (!SHA64.test(candidate.learningDecisionFingerprint ?? "") || !/^learning-cycle:[a-f0-9]{64}$/.test(candidate.learningCycleId ?? "")) throw new LearningApplicationError("MALFORMED_INTENT", "application intent identity is invalid");
  if (!SHA64.test(candidate.previousResearchSpecFingerprint ?? "")) throw new LearningApplicationError("MALFORMED_INTENT", "application intent research spec identity is invalid");
  if (typeof candidate.surface !== "string" || !BOUNDED.test(candidate.surface)) throw new LearningApplicationError("MALFORMED_INTENT", "application intent surface is invalid");
  for (const field of ["previousValue", "requestedValue", "boundedValue"] as const) if (!Number.isFinite(candidate[field])) throw new LearningApplicationError("MALFORMED_INTENT", field + " must be finite");
  assertContext({ applicationTimestamp: candidate.applicationTimestamp ?? "", runtimeIdentity: candidate.runtimeIdentity ?? "", sourceCommit: candidate.sourceCommit ?? "" });
  const { schemaVersion: _schema, intentFingerprint: recorded, ...content } = candidate as LearningApplicationIntent;
  const expectedKeys = ["schemaVersion", "learningDecisionFingerprint", "learningCycleId", "previousResearchSpecFingerprint", "surface", "previousValue", "requestedValue", "boundedValue", "applicationTimestamp", "runtimeIdentity", "sourceCommit", "intentFingerprint"].sort();
  const actualKeys = Object.keys(value as Record<string, unknown>).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) throw new LearningApplicationError("MALFORMED_INTENT", "application intent fields do not match the closed schema");
  if (typeof recorded !== "string" || !SHA64.test(recorded) || learningApplicationIntentFingerprint(content) !== recorded) throw new LearningApplicationError("IDENTITY_CONFLICT", "application intent does not match its own fingerprint");
}
