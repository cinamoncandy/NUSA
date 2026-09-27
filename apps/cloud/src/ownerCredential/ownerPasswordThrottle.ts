/**
 * Per-account backoff for password attempts.
 *
 * `ownerPassword.ts` makes one guess cost a fraction of a second. That is the wrong unit: an
 * unauthenticated caller on the open internet gets to make as many guesses as the server will
 * answer, and a password an owner can remember is inside a search space that patience defeats.
 * The scrypt cost buys time against someone who has stolen the hash; it buys almost nothing
 * against someone talking to the live endpoint. This is the half that does.
 *
 * The rules, and why each is shaped this way:
 *
 *   - Backoff is per account, not per device or address. Both of those are chosen by the caller --
 *     `installationIdentity.ts` generates the device id locally, and an address is one proxy away
 *     from being unlimited -- so counting either would let the same attacker start fresh at will.
 *   - Delay doubles and is capped, and a locked account refuses without consulting the password at
 *     all. Refusing early here is correct where it was wrong in verification: the account is
 *     already known to exist, so no timing signal is created by declining faster.
 *   - A successful login clears the record, so a person who mistypes twice and then succeeds is not
 *     carrying a penalty into tomorrow.
 *   - Attempts are only ever counted, never a password or its shape. A throttle store that recorded
 *     "which guess" would be a second copy of the credential.
 *
 * Locking out the owner is itself a denial of service, so the ceiling is a wait, not a permanent
 * lock: the owner has no other way in and no administrator to call.
 */

export interface AttemptRecord {
  readonly failures: number;
  readonly lockedUntilMs: number | null;
  readonly lastFailureAtMs: number | null;
}

export const NO_ATTEMPTS: AttemptRecord = Object.freeze({ failures: 0, lockedUntilMs: null, lastFailureAtMs: null });

/** Free attempts before any delay, for ordinary mistyping. */
export const FREE_ATTEMPTS = 3;

/** First delay after the free attempts are spent; doubles per failure. */
export const BASE_DELAY_MS = 5_000;

/** Ceiling on the delay. Fifteen minutes is punishing for a script and survivable for a person. */
export const MAXIMUM_DELAY_MS = 15 * 60 * 1000;

/** A quiet period after which the counter resets: yesterday's typo is not evidence of an attack. */
export const DECAY_MS = 24 * 60 * 60 * 1000;

export type AttemptDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Whether an attempt may be made at all, and how long to wait when not. Fails closed on bad input. */
export function mayAttempt(record: AttemptRecord | undefined, nowMs: number): AttemptDecision {
  if (!positiveInteger(nowMs)) return Object.freeze({ allowed: false, retryAfterMs: MAXIMUM_DELAY_MS });
  if (record == null) return Object.freeze({ allowed: true });
  const lockedUntil = record.lockedUntilMs;
  if (lockedUntil == null) return Object.freeze({ allowed: true });
  if (!positiveInteger(lockedUntil)) return Object.freeze({ allowed: false, retryAfterMs: MAXIMUM_DELAY_MS });
  // A lock reaching further than the maximum delay means a clock moved or a row was tampered with;
  // honour the cap rather than the row, so neither can lock the owner out for a week.
  if (lockedUntil > nowMs) return Object.freeze({ allowed: false, retryAfterMs: Math.min(lockedUntil - nowMs, MAXIMUM_DELAY_MS) });
  return Object.freeze({ allowed: true });
}

const decayed = (record: AttemptRecord | undefined, nowMs: number): AttemptRecord => {
  if (record == null) return NO_ATTEMPTS;
  const last = record.lastFailureAtMs;
  if (last == null || !positiveInteger(last)) return NO_ATTEMPTS;
  return nowMs - last >= DECAY_MS ? NO_ATTEMPTS : record;
};

/** The record to store after a rejected password. */
export function recordFailure(record: AttemptRecord | undefined, nowMs: number): AttemptRecord {
  const base = decayed(record, nowMs);
  const failures = base.failures + 1;
  if (failures <= FREE_ATTEMPTS) {
    return Object.freeze({ failures, lockedUntilMs: null, lastFailureAtMs: nowMs });
  }
  const doublings = failures - FREE_ATTEMPTS - 1;
  // Compute the delay in floating point before clamping: doubling an integer past 2^53 would wrap
  // into nonsense, and the cap makes the precision irrelevant anyway.
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, doublings), MAXIMUM_DELAY_MS);
  return Object.freeze({ failures, lockedUntilMs: nowMs + delay, lastFailureAtMs: nowMs });
}

/** The record to store after an accepted password: none. */
export function recordSuccess(): AttemptRecord {
  return NO_ATTEMPTS;
}

/** How long a caller must wait right now, for a Retry-After header. Zero when not locked. */
export function retryAfterMs(record: AttemptRecord | undefined, nowMs: number): number {
  const decision = mayAttempt(record, nowMs);
  return decision.allowed ? 0 : decision.retryAfterMs;
}
