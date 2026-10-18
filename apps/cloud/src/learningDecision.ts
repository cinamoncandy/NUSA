import { createHash } from "node:crypto";
import { assertLearningInputSet, learningCycleId, learningInputSetFingerprint, type LearningInputSet } from "./learningInputSet";

/**
 * A1 - the Learning Decision.
 *
 * A decision consumes the fixed identity of a Learning Input Set (A2), never an arbitrary query
 * result, and it is a **receipt rather than an authority**. The only shape this module can produce is
 *
 *     Learning Decision -> validation -> bounded application
 *
 * The forbidden shape, which this module is deliberately incapable of expressing, is
 *
 *     Learning Decision -> direct arbitrary config mutation
 *
 * There is no function here that mutates configuration, no setter, and no apply path. Decisions are
 * built by pure derivation and returned frozen. Application is A4's job and happens against an
 * owner-defined aperture; what A4 actually applied is attached afterwards by `withApplication`, which
 * returns a *new* decision rather than editing this one (v2 sections 21-24).
 *
 * The mutable surface is an owner allowlist, not something learning may extend. Today it holds exactly
 * one field: `longBarTickEvery` in [1, 4]. A proposal naming any other field is refused, so learning
 * cannot invent a mutable field out of a successful trial. A proposal naming an immutable surface is
 * refused as well, and that refusal is unconditional: it does not become admissible because the
 * evidence behind the decision was negative, or because the change is small, or because it is late in
 * the programme.
 *
 * Nothing here claims performance. `decisionOutcome` reports only what validation concluded about a
 * proposal. PERFORMANCE_IMPROVEMENT stays UNPROVEN until a cost-complete realized PAPER comparison
 * says otherwise, and no decision can move that flag.
 */

export const LEARNING_DECISION_SCHEMA_VERSION = 1;
export const ALLOWED_SURFACE_VERSION = "learning-allowed-surface-v1";
export const IMMUTABLE_SURFACE_VERSION = "learning-immutable-surface-v1";
/** A decision with no completed meta cycle has no basis at all. Learning may not lower this floor. */
export const META_MINIMUM_DECISION_CYCLES = 1;

export class LearningDecisionError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningDecisionError";
  }
}

/** One owner-defined mutable field. Learning may only propose inside these bounds. */
export interface MutableSurfaceDefinition {
  readonly surface: string;
  readonly minimum: number;
  readonly maximum: number;
  /** Largest step one cycle may take, independent of the absolute bounds. */
  readonly maximumDeltaPerCycle: number;
}

/**
 * The complete mutable aperture as of this version.
 *
 * This is an owner decision recorded in code, not a learning output. Extending it requires an owner
 * change that also updates ALLOWED_SURFACE_VERSION and the falsification tests; learning has no path
 * to add a row here at runtime.
 */
export const MUTABLE_SURFACE_ALLOWLIST: readonly MutableSurfaceDefinition[] = Object.freeze([
  Object.freeze({ surface: "longBarTickEvery", minimum: 1, maximum: 4, maximumDeltaPerCycle: 1 }),
]);

/**
 * Surfaces no decision may ever move, by exact name or by prefix.
 *
 * These are the PAPER-only guarantees, the Risk limits, the qualification and sampling rules, the
 * out-of-sample and walk-forward integrity rules, cost completeness, leakage rules, and the
 * Governance and Release authorities. A proposal naming one of them is recorded REJECTED rather than
 * silently dropped, so the attempt itself becomes durable evidence (v2 section 29).
 */
const IMMUTABLE_EXACT: readonly string[] = Object.freeze([
  "PAPER_ONLY",
  "liveAuthority",
  "productionMutationAllowed",
  "aiAuthority",
  "aiDecisionAuthority",
  "minimumSample",
  "minimumSampleSize",
  "oosWindow",
  "oosRatio",
  "walkForward",
  "purge",
  "embargo",
  "costGate",
  "costCompleteness",
  "leakageRules",
  "governance",
  "releaseAuthority",
  "brokerAuthority",
  "orderAuthority",
  "withdrawalAuthority",
]);
const IMMUTABLE_PREFIXES: readonly string[] = Object.freeze(["risk", "qualification", "governance", "release", "live", "broker", "order"]);

/** A proposal naming a surface that is neither allowlisted nor immutable is still refused. */
function isImmutableSurface(surface: string): boolean {
  if (IMMUTABLE_EXACT.includes(surface)) return true;
  const lower = surface.toLowerCase();
  return IMMUTABLE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function allowlistedSurface(surface: string): MutableSurfaceDefinition | undefined {
  return MUTABLE_SURFACE_ALLOWLIST.find((definition) => definition.surface === surface);
}

export type LearningChangeVerdict = "ADMISSIBLE" | "REJECTED";

/** The §27 aperture fields, carried per change so a later application is bounded and auditable. */
export interface LearningChangeAssessment {
  readonly surface: string;
  readonly currentValue: number;
  readonly proposedValue: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumDeltaPerCycle?: number;
  readonly verdict: LearningChangeVerdict;
  readonly reason: string;
}

export interface LearningChangeRequest {
  readonly surface: string;
  readonly currentValue: number;
  readonly proposedValue: number;
}

export type LearningDecisionOutcome = "APPLIED" | "REJECTED" | "INSUFFICIENT";
export type MetaOosPartition = "meta-train" | "meta-validation" | "meta-holdout";

export interface LearningDecision {
  readonly schemaVersion: typeof LEARNING_DECISION_SCHEMA_VERSION;
  readonly learningCycleId: string;
  readonly learningInputSetFingerprint: string;
  readonly previousResearchSpecFingerprint: string;
  readonly learningPolicyVersion: string;
  readonly objectiveVersion: string;
  readonly proposedChanges: readonly LearningChangeAssessment[];
  readonly admissibleChanges: readonly LearningChangeAssessment[];
  readonly rejectedChanges: readonly LearningChangeAssessment[];
  /** Empty until a bounded application reports what it actually did. */
  readonly appliedChanges: readonly LearningChangeAssessment[];
  readonly reasonEvidence: readonly string[];
  /** Largest absolute step among admissible changes; zero when nothing is admissible. */
  readonly changeMagnitude: number;
  readonly allowedSurfaceVersion: string;
  readonly immutableSurfaceVersion: string;
  readonly metaOosPartition: MetaOosPartition;
  readonly decisionOutcome: LearningDecisionOutcome;
  readonly resultingResearchSpecFingerprint?: string;
  readonly createdAt: string;
  readonly sourceCommit: string;
  readonly runtimeIdentity: string;
}

export interface LearningDecisionInput {
  readonly inputSet: LearningInputSet;
  readonly previousResearchSpecFingerprint: string;
  readonly objectiveVersion: string;
  readonly proposedChanges: readonly LearningChangeRequest[];
  readonly reasonEvidence: readonly string[];
  readonly metaOosPartition: MetaOosPartition;
  /** Completed meta cycles backing this partition. Below the floor the decision is INSUFFICIENT. */
  readonly metaCyclesEvaluated: number;
  readonly createdAt: string;
  readonly sourceCommit: string;
  readonly runtimeIdentity: string;
}

const SHA64 = /^[a-f0-9]{64}$/;
const BOUNDED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LearningDecisionError("NON_FINITE_VALUE", "learning decision contains a non-finite number");
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
  throw new LearningDecisionError("NON_CANONICAL_VALUE", "learning decision contains a value that has no canonical form");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertBoundedString(value: unknown, field: string): string {
  if (typeof value !== "string" || !BOUNDED.test(value) || hasControlCharacter(value)) {
    throw new LearningDecisionError("MALFORMED_DECISION_INPUT", field + " must be a bounded identifier");
  }
  return value;
}

/**
 * Classifies one proposal against the owner allowlist and the immutable surface.
 *
 * Order matters: the immutable surface is tested first and unconditionally, so no amount of
 * allowlist overlap, evidence weight, or change size can make an immutable field movable.
 */
export function assessChange(request: LearningChangeRequest): LearningChangeAssessment {
  if (request == null || typeof request !== "object") throw new LearningDecisionError("MALFORMED_CHANGE", "proposed change is required");
  const surface = assertBoundedString(request.surface, "change surface");
  if (!Number.isFinite(request.currentValue) || !Number.isFinite(request.proposedValue)) {
    throw new LearningDecisionError("MALFORMED_CHANGE", "change values must be finite numbers");
  }

  if (isImmutableSurface(surface)) {
    return Object.freeze({
      surface,
      currentValue: request.currentValue,
      proposedValue: request.proposedValue,
      verdict: "REJECTED" as const,
      reason: "immutable surface: no learning decision may move it, whatever the evidence",
    });
  }

  const definition = allowlistedSurface(surface);
  if (definition == null) {
    return Object.freeze({
      surface,
      currentValue: request.currentValue,
      proposedValue: request.proposedValue,
      verdict: "REJECTED" as const,
      reason: "surface is not on the owner allowlist: learning may not invent a mutable field",
    });
  }

  const bounds = Object.freeze({
    minimum: definition.minimum,
    maximum: definition.maximum,
    maximumDeltaPerCycle: definition.maximumDeltaPerCycle,
  });

  if (request.proposedValue < definition.minimum || request.proposedValue > definition.maximum) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "proposed value is outside the owner bounds" });
  }
  if (Math.abs(request.proposedValue - request.currentValue) > definition.maximumDeltaPerCycle) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "step exceeds the maximum delta allowed in one cycle" });
  }
  if (request.proposedValue === request.currentValue) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "proposal does not change the current value" });
  }

  return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "ADMISSIBLE" as const, reason: "within the owner-defined aperture for one cycle" });
}

/**
 * Builds a Learning Decision by pure derivation.
 *
 * The outcome is a statement about validation, not about performance and not about what was done:
 * - `INSUFFICIENT` - the meta partition has no completed cycle, so there is nothing to decide from.
 * - `REJECTED`     - at least one proposal was made and every one of them was refused.
 * - `APPLIED`      - at least one change is admissible, so the decision admits a bounded application.
 *
 * `APPLIED` therefore means "admitted to bounded application", never "already in effect". The applied
 * values arrive separately from A4, and an execution failure is recorded in A4's own receipt rather
 * than rewriting this decision (v2 section 23).
 */
export function buildLearningDecision(input: LearningDecisionInput): LearningDecision {
  if (input == null || typeof input !== "object") throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "learning decision input is required");
  assertLearningInputSet(input.inputSet);
  if (!SHA64.test(input.previousResearchSpecFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "previous research spec fingerprint must be a SHA-256 digest");
  assertBoundedString(input.objectiveVersion, "objective version");
  assertBoundedString(input.metaOosPartition, "meta-OOS partition");
  assertBoundedString(input.createdAt, "created at");
  assertBoundedString(input.sourceCommit, "source commit");
  assertBoundedString(input.runtimeIdentity, "runtime identity");
  if (!Number.isSafeInteger(input.metaCyclesEvaluated) || input.metaCyclesEvaluated < 0) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "meta cycle count must be a non-negative integer");
  if (!Array.isArray(input.proposedChanges)) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "proposed changes must be a list");
  if (!Array.isArray(input.reasonEvidence)) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "reason evidence must be a list");
  for (const reference of input.reasonEvidence) assertBoundedString(reference, "reason evidence reference");

  const proposedChanges = Object.freeze(input.proposedChanges.map(assessChange));
  const admissibleChanges = Object.freeze(proposedChanges.filter((change) => change.verdict === "ADMISSIBLE"));
  const rejectedChanges = Object.freeze(proposedChanges.filter((change) => change.verdict === "REJECTED"));
  const changeMagnitude = admissibleChanges.reduce((largest, change) => Math.max(largest, Math.abs(change.proposedValue - change.currentValue)), 0);

  // Insufficient meta evidence outranks every other conclusion. A decision that cannot cite a single
  // completed meta cycle is never allowed to read as APPLIED, and the bar is not lowered to make it.
  const decisionOutcome: LearningDecisionOutcome =
    input.metaCyclesEvaluated < META_MINIMUM_DECISION_CYCLES ? "INSUFFICIENT" : admissibleChanges.length > 0 ? "APPLIED" : proposedChanges.length > 0 ? "REJECTED" : "INSUFFICIENT";

  return Object.freeze({
    schemaVersion: LEARNING_DECISION_SCHEMA_VERSION,
    learningCycleId: learningCycleId(input.inputSet),
    learningInputSetFingerprint: learningInputSetFingerprint(input.inputSet),
    previousResearchSpecFingerprint: input.previousResearchSpecFingerprint,
    learningPolicyVersion: input.inputSet.learningPolicyVersion,
    objectiveVersion: input.objectiveVersion,
    proposedChanges,
    admissibleChanges,
    rejectedChanges,
    appliedChanges: Object.freeze([]),
    reasonEvidence: Object.freeze([...input.reasonEvidence]),
    changeMagnitude,
    allowedSurfaceVersion: ALLOWED_SURFACE_VERSION,
    immutableSurfaceVersion: IMMUTABLE_SURFACE_VERSION,
    metaOosPartition: input.metaOosPartition,
    decisionOutcome,
    createdAt: input.createdAt,
    sourceCommit: input.sourceCommit,
    runtimeIdentity: input.runtimeIdentity,
  });
}

/** The deterministic identity of a decision. Same decision content yields the same fingerprint. */
export function learningDecisionFingerprint(decision: LearningDecision): string {
  return digest(decision);
}

/**
 * Attaches what a bounded application actually did, returning a new immutable decision.
 *
 * A4 owns the application and calls this; A1 owns only the shape. The applied values are still
 * checked against the same aperture, so an application cannot report a value the decision never
 * admitted, and an execution that failed simply reports no applied change while its own receipt
 * carries the failure.
 */
export function withApplication(
  decision: LearningDecision,
  application: { readonly appliedChanges: readonly LearningChangeAssessment[]; readonly resultingResearchSpecFingerprint: string },
): LearningDecision {
  assertLearningDecision(decision);
  if (!Array.isArray(application.appliedChanges)) throw new LearningDecisionError("MALFORMED_APPLICATION", "applied changes must be a list");
  if (!SHA64.test(application.resultingResearchSpecFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_APPLICATION", "resulting research spec fingerprint must be a SHA-256 digest");

  const admitted = new Map(decision.admissibleChanges.map((change) => [change.surface, change]));
  for (const applied of application.appliedChanges) {
    const admission = admitted.get(applied.surface);
    if (admission == null) throw new LearningDecisionError("UNADMITTED_APPLICATION", "application reported a surface the decision never admitted");
    if (applied.proposedValue !== admission.proposedValue) throw new LearningDecisionError("UNADMITTED_APPLICATION", "application reported a value the decision never admitted for " + applied.surface);
  }

  return Object.freeze({
    ...decision,
    appliedChanges: Object.freeze([...application.appliedChanges]),
    resultingResearchSpecFingerprint: application.resultingResearchSpecFingerprint,
    decisionOutcome: application.appliedChanges.length > 0 ? ("APPLIED" as const) : ("REJECTED" as const),
  });
}

/**
 * Fails closed on anything that is not exactly a Learning Decision.
 *
 * Frozen-ness is deliberately *not* checked here. It is a construction guarantee, enforced by
 * `buildLearningDecision` and `withApplication` returning frozen objects. A receipt read back from
 * durable storage is a fresh object by construction, so requiring it to be frozen would make every
 * replay fail and the ledger unreadable.
 */
export function assertLearningDecision(value: unknown): asserts value is LearningDecision {
  if (value == null || typeof value !== "object") throw new LearningDecisionError("MALFORMED_DECISION", "learning decision is required");
  const candidate = value as Partial<LearningDecision>;
  if (candidate.schemaVersion !== LEARNING_DECISION_SCHEMA_VERSION) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision schema version is unsupported");
  if (!SHA64.test(candidate.learningInputSetFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision input fingerprint is invalid");
  if (!SHA64.test(candidate.previousResearchSpecFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_DECISION", "previous research spec fingerprint is invalid");
  if (candidate.allowedSurfaceVersion !== ALLOWED_SURFACE_VERSION) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision allowed-surface version is unsupported");
  if (candidate.immutableSurfaceVersion !== IMMUTABLE_SURFACE_VERSION) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision immutable-surface version is unsupported");
  for (const field of ["proposedChanges", "admissibleChanges", "rejectedChanges", "appliedChanges", "reasonEvidence"] as const) {
    if (!Array.isArray(candidate[field])) throw new LearningDecisionError("MALFORMED_DECISION", field + " must be a list");
  }
  if (!["APPLIED", "REJECTED", "INSUFFICIENT"].includes(candidate.decisionOutcome ?? "")) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision outcome is outside the closed set");
  if (!Number.isFinite(candidate.changeMagnitude) || (candidate.changeMagnitude as number) < 0) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision change magnitude is invalid");
}
