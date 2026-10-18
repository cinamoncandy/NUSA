import type { ApplicationOutcome } from "./learningApplication";

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
  /** Present only once an input set has actually been recorded. */
  latestLearningInputSetFingerprint?: string;
  latestLearningCycleId?: string;
  latestLearningDecisionFingerprint?: string;
  latestApplicationFingerprint?: string;
  applicationOutcome?: ApplicationOutcome;
  /** e.g. `train+validation+holdout`. The scope the eligibility covers, never a single lane's vote. */
  metaScope?: string;
  /** e.g. `INELIGIBLE - meta-OOS has train 0/3, validation 0/3, holdout 0/3 completed cycle(s)`. A report, never an approval. */
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
    readonly partition: string;
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

/**
 * Builds the projection from already-read sources.
 *
 * Pure: it reads each source, freezes the result, and returns. It cannot mutate a source, cannot
 * record anything, and cannot be asked to do work on behalf of a decision.
 */
export function buildLearningLoopStatus(source: LearningStatusSource): LearningLoopStatus {
  if (source == null || typeof source !== "object") return Object.freeze({ schemaVersion: LEARNING_STATUS_VERSION });
  return Object.freeze({
    schemaVersion: LEARNING_STATUS_VERSION,
    ...(source.inputSet == null
      ? {}
      : {
          latestLearningInputSetFingerprint: source.inputSet.fingerprint,
          latestLearningCycleId: source.inputSet.learningCycleId,
        }),
    ...(source.decision == null ? {} : { latestLearningDecisionFingerprint: source.decision.fingerprint }),
    ...(source.application == null
      ? {}
      : { latestApplicationFingerprint: source.application.fingerprint, applicationOutcome: source.application.applicationOutcome }),
    ...(source.meta == null
      ? {}
      : {
          // Eligibility is global rather than a vote per partition, so what travels here is the
          // scope it covers. A bare partition would read as though that one lane decided.
          metaScope: source.meta.partition,
          // The verdict and its reason travel together so a rendered line can never show a bare
          // permission without the condition that produced it.
          metaEligibility: (source.meta.eligible ? "ELIGIBLE" : "INELIGIBLE") + " - " + source.meta.reason,
        }),
    ...(source.supersession == null
      ? {}
      : {
          supersessionStatus: summarize([
            ["links", source.supersession.links],
            ["lineage", source.supersession.lineageLength],
            ["fork", source.supersession.forked ? "DETECTED" : "NONE"],
          ]),
        }),
    ...(source.exploration == null
      ? {}
      : {
          explorationStatus: summarize([
            ["attempts", source.exploration.attempts],
            ["allotted", source.exploration.allotted],
            ["suppressed", source.exploration.suppressed],
            ["state", source.exploration.exhausted ? "EXHAUSTED" : "OPEN"],
            ["remaining", source.exploration.allotmentRemaining],
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
  "latestLearningInputSetFingerprint",
  "latestLearningCycleId",
  "latestLearningDecisionFingerprint",
  "latestApplicationFingerprint",
  "applicationOutcome",
  "metaScope",
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
