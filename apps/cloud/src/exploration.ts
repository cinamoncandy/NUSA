import { createHash } from "node:crypto";

/**
 * A6 - diversity and exploration control.
 *
 * The failure this exists to prevent is re-running the same failed experiment indefinitely: the same
 * family, the same shape, the same outcome, arrived at again because nothing remembers that it was
 * already tried. Every recorded attempt is therefore counted against the space it occupies, and a
 * bounded exploration allotment decides how much genuinely new ground the next cycle may cover.
 *
 * Two properties are deliberately structural rather than advisory.
 *
 * **`EXHAUSTED` is a normal durable answer.** When the allotment runs out the result is `EXHAUSTED`
 * and it is recorded as such. The budget is never raised automatically to make a request succeed, so
 * "we wanted to explore" cannot itself create the room to explore. Getting more room is an owner
 * decision, like widening the aperture.
 *
 * **Exploration is not a gate bypass.** Nothing in this module produces a qualified candidate, a pass,
 * or an admission. The strongest verdict it can offer is "may be *evaluated*", and evaluation is the
 * same PIT, OOS, walk-forward, cost, sample, qualification, and Governance path every other candidate
 * takes. Suppressed and exhausted attempts are recorded rather than dropped, because a plan that kept
 * re-trying one idea and never noticed is exactly the evidence worth keeping (v2 sections 25-27).
 */

export const EXPLORATION_SCHEMA_VERSION = 1;
export const EXPLORATION_POLICY_VERSION = "exploration-v1";

export class ExplorationError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExplorationError";
  }
}

/**
 * The owner-set exploration allotment for one cycle.
 *
 * This is a fixed owner number, not something learning derives from how much it would like to try.
 */
export const EXPLORATION_ALLOTMENT_PER_CYCLE = 4;

/** Families that are exhausted may not be re-proposed regardless of remaining allotment. */
export const FAMILY_REPETITION_CEILING = 3;

export type ExplorationVerdict = "ALLOTTED" | "SUPPRESSED_EXACT_DUPLICATE" | "SUPPRESSED_FAMILY_CEILING" | "EXHAUSTED";

export interface ExperimentShape {
  /** Stable identity of a proposed experiment, derived from its full configuration. */
  readonly experimentIdentity: string;
  /** Strategy family it belongs to, e.g. `RULE/CLOSE/FIVE`. */
  readonly family: string;
  /** Exact configuration identity, used for exact-duplicate detection. */
  readonly configurationIdentity: string;
}

export interface ExplorationAttempt {
  readonly verdict: ExplorationVerdict;
  readonly experimentIdentity: string;
  readonly family: string;
  /** How many attempts in this family have been recorded before this one. */
  readonly familyRepetitionCount: number;
  /** How many near-duplicates of this shape have already been attempted. */
  readonly nearDuplicateCount: number;
  /**
   * The precomputed near-duplicate key, so a replayed attempt can still be compared for similarity
   * without needing the original configuration identity to have been stored alongside it.
   */
  readonly nearDuplicateKey: string;
  readonly allotmentRemaining: number;
  /** Explains a suppression or exhaustion in words a reviewer can check. */
  readonly reason: string;
  /**
   * Always the same list. Exploration never narrows it: a proposal reaching here still has every
   * gate ahead of it, and this field states so explicitly rather than leaving it to be assumed.
   */
  readonly gatesStillRequired: readonly string[];
}

export const GATES_STILL_REQUIRED: readonly string[] = Object.freeze([
  "point-in-time",
  "out-of-sample",
  "walk-forward",
  "cost-completeness",
  "minimum-sample",
  "qualification",
  "governance",
]);

const SHA64 = /^[a-f0-9]{64}$/;
const BOUNDED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * Near-duplicate shape: identity excluded, membership and configuration kept.
 *
 * Two proposals for the same family and the same configuration are near-duplicates even when their
 * outer identity differs, because the difference between them is naming rather than substance.
 */
function nearDuplicateKey(shape: ExperimentShape): string {
  return digest({ family: shape.family, configurationIdentity: shape.configurationIdentity });
}

function assertShape(shape: ExperimentShape): void {
  if (shape == null || typeof shape !== "object") throw new ExplorationError("MALFORMED_SHAPE", "experiment shape is required");
  for (const [field, value] of Object.entries({ experimentIdentity: shape.experimentIdentity, family: shape.family, configurationIdentity: shape.configurationIdentity })) {
    if (typeof value !== "string" || !BOUNDED.test(value)) throw new ExplorationError("MALFORMED_SHAPE", field + " must be a bounded identifier");
  }
  if (!SHA64.test(shape.configurationIdentity)) throw new ExplorationError("MALFORMED_SHAPE", "configuration identity must be a SHA-256 digest");
}

/**
 * Records exploration attempts and decides whether a new one may be *evaluated*.
 *
 * It holds only attempt receipts: no candidate, no qualification, no performance evidence, and no
 * research request is produced or reachable here, so there is no path by which exploration could
 * promote itself.
 */
export class ExplorationRegistry {
  private readonly attempts: ExplorationAttempt[] = [];
  private consumed = 0;

  /** Attempts recorded so far in this cycle, whether they were allotted or suppressed. */
  public recordedAttempts(): readonly ExplorationAttempt[] {
    return Object.freeze([...this.attempts]);
  }

  public allotmentRemaining(): number {
    return Math.max(0, EXPLORATION_ALLOTMENT_PER_CYCLE - this.consumed);
  }

  public familyRepetitionCount(family: string): number {
    return this.attempts.filter((attempt) => attempt.family === family).length;
  }

  public nearDuplicateCount(shape: ExperimentShape): number {
    const key = nearDuplicateKey(shape);
    return this.attempts.filter((attempt) => attempt.experimentIdentity !== shape.experimentIdentity && attempt.nearDuplicateKey === key).length;
  }

  private record(attempt: ExplorationAttempt): ExplorationAttempt {
    this.attempts.push(attempt);
    return Object.freeze(attempt);
  }

  /**
   * Decides whether a proposed experiment may be evaluated, recording the decision either way.
   *
   * Checks run in a fixed order so the reason is deterministic: exhaustion first, because no further
   * room exists at all; then exact duplication; then family repetition; then allotment.
   */
  public propose(shape: ExperimentShape): ExplorationAttempt {
    assertShape(shape);
    const dupKey = nearDuplicateKey(shape);

    if (this.allotmentRemaining() <= 0) {
      return this.record({
        verdict: "EXHAUSTED",
        experimentIdentity: shape.experimentIdentity,
        family: shape.family,
        familyRepetitionCount: this.familyRepetitionCount(shape.family),
        nearDuplicateCount: this.nearDuplicateCount(shape),
      nearDuplicateKey: dupKey,
        allotmentRemaining: 0,
        reason: "exploration allotment of " + String(EXPLORATION_ALLOTMENT_PER_CYCLE) + " for this cycle is used up; it is not raised automatically to admit another attempt",
        gatesStillRequired: GATES_STILL_REQUIRED,
      });
    }

    if (this.attempts.some((attempt) => attempt.experimentIdentity === shape.experimentIdentity)) {
      return this.record({
        verdict: "SUPPRESSED_EXACT_DUPLICATE",
        experimentIdentity: shape.experimentIdentity,
        family: shape.family,
        familyRepetitionCount: this.familyRepetitionCount(shape.family),
        nearDuplicateCount: this.nearDuplicateCount(shape),
      nearDuplicateKey: dupKey,
        allotmentRemaining: this.allotmentRemaining(),
        reason: "this exact experiment identity has already been attempted and is not proposed again",
        gatesStillRequired: GATES_STILL_REQUIRED,
      });
    }

    const repetition = this.familyRepetitionCount(shape.family);
    if (repetition >= FAMILY_REPETITION_CEILING) {
      return this.record({
        verdict: "SUPPRESSED_FAMILY_CEILING",
        experimentIdentity: shape.experimentIdentity,
        family: shape.family,
        familyRepetitionCount: repetition,
        nearDuplicateCount: this.nearDuplicateCount(shape),
      nearDuplicateKey: dupKey,
        allotmentRemaining: this.allotmentRemaining(),
        reason: "family " + shape.family + " has " + String(repetition) + " attempt(s) at its ceiling of " + String(FAMILY_REPETITION_CEILING) + "; re-running it is the loop this control exists to break",
        gatesStillRequired: GATES_STILL_REQUIRED,
      });
    }

    // Only an allotted attempt consumes allotment. Suppressions cost nothing, so they cannot be used
    // to drain the budget and they never manufacture room.
    this.consumed += 1;
    return this.record({
      verdict: "ALLOTTED",
      experimentIdentity: shape.experimentIdentity,
      family: shape.family,
      familyRepetitionCount: repetition + 1,
      nearDuplicateCount: this.nearDuplicateCount(shape),
      nearDuplicateKey: dupKey,
      allotmentRemaining: this.allotmentRemaining(),
      reason: "within the owner-set exploration allotment; it still faces every gate in the normal path",
      gatesStillRequired: GATES_STILL_REQUIRED,
    });
  }

  public status(): { readonly attempts: number; readonly allotted: number; readonly suppressed: number; readonly exhausted: boolean; readonly allotmentRemaining: number } {
    const allotted = this.attempts.filter((attempt) => attempt.verdict === "ALLOTTED").length;
    const suppressed = this.attempts.length - allotted;
    return Object.freeze({
      attempts: this.attempts.length,
      allotted,
      suppressed,
      exhausted: this.allotmentRemaining() <= 0,
      allotmentRemaining: this.allotmentRemaining(),
    });
  }

  /**
   * Replays durable attempts so a restart does not hand back allotment that was already spent.
   *
   * The allotment is re-derived from recorded attempts rather than stored as a mutable counter, so it
   * cannot drift from the history it summarizes.
   */
  public rehydrate(attempts: readonly ExplorationAttempt[]): void {
    for (const attempt of attempts) {
      if (!Object.values(["ALLOTTED", "SUPPRESSED_EXACT_DUPLICATE", "SUPPRESSED_FAMILY_CEILING", "EXHAUSTED"]).includes(attempt.verdict)) {
        throw new ExplorationError("MALFORMED_ATTEMPT", "exploration verdict is outside the closed set");
      }
      this.attempts.push(attempt);
    }
    this.consumed = this.attempts.filter((attempt) => attempt.verdict === "ALLOTTED").length;
  }
}
