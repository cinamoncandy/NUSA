import type { ApplicationOutcome } from "./learningApplication";
import type { MetaPartition } from "./metaOos";

/**
 * M2 - the display-only learning loop status projection.
 *
 * It reports what the durable stores already hold: the latest input set, cycle, decision, and
 * application identities, whether meta-OOS currently permits application, how supersession has
 * progressed, and where exploration stands. Everything here is a read of recorded history.
 *
 * The direction is one-way by construction. There is no path by which this object becomes an input:
 * it has no setters, it is produced by pure derivation from sources it does not own, it is frozen on
 * completion, and it holds identifiers and summary strings only - never a decision, a proposal, an
 * eligibility a caller could later edit, or anything the scheduler reads. The status of the loop is
 * an output of the loop's evidence and must stay one, or reporting on learning starts changing what
 * was learned (v2 section 28).
 *
 * The three summary fields are rendered as compact `key=value` strings rather than nested objects.
 * That is a constraint of the enclosing loop status rather than a shortcut: its value type permits
 * exactly one level of nesting, so anything nested here would inherit a shape it could not satisfy.
 * It suits the surface anyway - these are read from a status bar, where a single line each is what a
 * reviewer wants, and a flat scalar can never be mistaken for a structure to act upon.
 */

export const LEARNING_STATUS_VERSION = 1;

export type LearningLoopStatus = Readonly<{
  schemaVersion: typeof LEARNING_STATUS_VERSION;
  projectionScope: "UNVERIFIED_DISPLAY_ONLY_NOT_APPROVAL";
  /** Per-component state makes absent or malformed sources visible instead of implying health. */
  componentAvailability: string;
  /** Present only once an input set has actually been recorded. */
  latestLearningInputSetFingerprint?: string;
  latestLearningCycleId?: string;
  latestLearningDecisionFingerprint?: string;
  latestApplicationFingerprint?: string;
  applicationOutcome?: ApplicationOutcome;
  metaPartition?: MetaPartition;
  /** e.g. `INELIGIBLE - meta-OOS meta-holdout has 0 completed cycle(s) of 3 required`. A report, never an approval. */
  metaEligibility?: string;
  /** e.g. `links=4;lineage=3;fork=NONE`. */
  supersessionStatus?: string;
  /** e.g. `attempts=9;allotted=4;suppressed=5;EXHAUSTED;remaining=0`. */
  explorationStatus?: string;
}>;

/** The read-only facts this projection is built from. Every member is optional and read-only. */
export interface LearningStatusSource {
  readonly inputSet?: Readonly<{ readonly fingerprint: string; readonly learningCycleId: string }>;
  readonly decision?: Readonly<{ readonly fingerprint: string }>;
  readonly application?: Readonly<{ readonly fingerprint: string; readonly applicationOutcome: ApplicationOutcome }>;
  readonly meta?: Readonly<{
    readonly eligible: boolean;
    readonly partition: MetaPartition;
    readonly cyclesEvaluated: number;
    readonly reason: string;
  }>;
  readonly supersession?: Readonly<{ readonly links: number; readonly lineageLength: number; readonly forked: boolean }>;
  readonly exploration?: Readonly<{
    readonly attempts: number;
    readonly allotted: number;
    readonly suppressed: number;
    readonly exhausted: boolean;
    readonly allotmentRemaining: number;
  }>;
}

function summarize(values: ReadonlyArray<readonly [string, string | number]>): string {
  return values.map(([key, value]) => key + "=" + String(value)).join(";");
}

const SHA256 = /^[a-f0-9]{64}$/;
const CYCLE_ID = /^learning-cycle:[a-f0-9]{64}$/;
const APPLICATION_OUTCOMES = new Set<ApplicationOutcome>(["APPLIED", "NOOP", "REJECTED", "FAILED"]);
const META_PARTITIONS = new Set<MetaPartition>(["meta-train", "meta-validation", "meta-holdout"]);
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const safeReason = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= 256 && /^[\p{L}\p{N} .,:;()/_-]+$/u.test(value.trim());

/**
 * Builds the projection from already-read sources.
 *
 * Pure: it reads each source, freezes the result, and returns. It cannot mutate a source, cannot
 * record anything, and cannot be asked to do work on behalf of a decision.
 */
export function buildLearningLoopStatus(source: LearningStatusSource): LearningLoopStatus {
  const value: LearningStatusSource = source != null && typeof source === "object" ? source : Object.freeze({});
  const inputSetState = value.inputSet == null ? "UNKNOWN"
    : SHA256.test(value.inputSet.fingerprint) && CYCLE_ID.test(value.inputSet.learningCycleId)
      && value.inputSet.learningCycleId === "learning-cycle:" + value.inputSet.fingerprint ? "AVAILABLE" : "INVALID";
  const decisionState = value.decision == null ? "UNKNOWN"
    : SHA256.test(value.decision.fingerprint) ? "AVAILABLE" : "INVALID";
  const applicationState = value.application == null ? "UNKNOWN"
    : SHA256.test(value.application.fingerprint) && APPLICATION_OUTCOMES.has(value.application.applicationOutcome) ? "AVAILABLE" : "INVALID";
  const metaState = value.meta == null ? "UNKNOWN"
    : typeof value.meta.eligible === "boolean" && META_PARTITIONS.has(value.meta.partition)
      && nonNegativeInteger(value.meta.cyclesEvaluated) && safeReason(value.meta.reason) ? "AVAILABLE" : "INVALID";
  const supersessionState = value.supersession == null ? "UNKNOWN"
    : nonNegativeInteger(value.supersession.links) && nonNegativeInteger(value.supersession.lineageLength)
      && value.supersession.lineageLength <= value.supersession.links && typeof value.supersession.forked === "boolean" ? "AVAILABLE" : "INVALID";
  const explorationState = value.exploration == null ? "UNKNOWN"
    : nonNegativeInteger(value.exploration.attempts) && nonNegativeInteger(value.exploration.allotted)
      && nonNegativeInteger(value.exploration.suppressed) && nonNegativeInteger(value.exploration.allotmentRemaining)
      && value.exploration.allotted + value.exploration.suppressed <= value.exploration.attempts
      && typeof value.exploration.exhausted === "boolean"
      && value.exploration.exhausted === (value.exploration.allotmentRemaining === 0) ? "AVAILABLE" : "INVALID";
  const componentAvailability = summarize([
    ["inputSet", inputSetState], ["decision", decisionState], ["application", applicationState],
    ["meta", metaState], ["supersession", supersessionState], ["exploration", explorationState],
  ]);
  return Object.freeze({
    schemaVersion: LEARNING_STATUS_VERSION,
    projectionScope: "UNVERIFIED_DISPLAY_ONLY_NOT_APPROVAL",
    componentAvailability,
    ...(inputSetState !== "AVAILABLE"
      ? {}
      : {
          latestLearningInputSetFingerprint: value.inputSet!.fingerprint,
          latestLearningCycleId: value.inputSet!.learningCycleId,
        }),
    ...(decisionState !== "AVAILABLE" ? {} : { latestLearningDecisionFingerprint: value.decision!.fingerprint }),
    ...(applicationState !== "AVAILABLE"
      ? {}
      : { latestApplicationFingerprint: value.application!.fingerprint, applicationOutcome: value.application!.applicationOutcome }),
    ...(metaState !== "AVAILABLE"
      ? {}
      : {
          metaPartition: value.meta!.partition,
          // The verdict and its reason travel together so a rendered line can never show a bare
          // permission without the condition that produced it. Caller-supplied eligibility remains
          // explicitly unverified and is never an approval receipt.
          metaEligibility: "UNVERIFIED_INPUT; claimed=" + (value.meta!.eligible ? "ELIGIBLE" : "INELIGIBLE")
            + "; cycles=" + String(value.meta!.cyclesEvaluated) + "; reason=" + value.meta!.reason.trim(),
        }),
    ...(supersessionState !== "AVAILABLE"
      ? {}
      : {
          supersessionStatus: summarize([
            ["links", value.supersession!.links],
            ["lineage", value.supersession!.lineageLength],
            ["fork", value.supersession!.forked ? "DETECTED" : "NONE"],
          ]),
        }),
    ...(explorationState !== "AVAILABLE"
      ? {}
      : {
          explorationStatus: summarize([
            ["attempts", value.exploration!.attempts],
            ["allotted", value.exploration!.allotted],
            ["suppressed", value.exploration!.suppressed],
            ["state", value.exploration!.exhausted ? "EXHAUSTED" : "OPEN"],
            ["remaining", value.exploration!.allotmentRemaining],
          ]),
        }),
  });
}

/**
 * Every field this projection may ever carry.
 *
 * The test asserts the produced object contains nothing outside this set, which is what keeps the
 * projection from quietly growing an actionable field that a caller could start reading as an input.
 */
export const LEARNING_STATUS_FIELDS: readonly string[] = Object.freeze([
  "schemaVersion",
  "projectionScope",
  "componentAvailability",
  "latestLearningInputSetFingerprint",
  "latestLearningCycleId",
  "latestLearningDecisionFingerprint",
  "latestApplicationFingerprint",
  "applicationOutcome",
  "metaPartition",
  "metaEligibility",
  "supersessionStatus",
  "explorationStatus",
]);

/** Fields whose value is an identifier a downstream reader must never treat as a directive. */
export const LEARNING_STATUS_IDENTIFIERS: readonly string[] = Object.freeze([
  "latestLearningInputSetFingerprint",
  "latestLearningCycleId",
  "latestLearningDecisionFingerprint",
  "latestApplicationFingerprint",
]);
