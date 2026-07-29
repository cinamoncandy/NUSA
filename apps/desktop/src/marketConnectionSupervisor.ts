/**
 * The connection-state model and retry policy for the PUBLIC Upbit market feed (WO-0034-A4L).
 *
 * This module owns three things the codebase previously spread across a status string and a
 * pair of ad-hoc counters:
 *
 *   1. WHICH STATE THE FEED IS IN. Six named states, with explicit transitions. The state is
 *      never derived by re-parsing a human-readable status string, because a string that is
 *      also shown to a person will eventually be reworded, and a state machine reading it
 *      would silently change behaviour when that happens.
 *   2. WHETHER TO RETRY, AND WHEN. Bounded exponential backoff with BOTH an attempt ceiling
 *      and a wall-clock ceiling. `validateMarketReconnectPolicy` rejects an unbounded policy
 *      outright, so "retry forever" is not something a caller can configure by accident.
 *   3. WHAT ACTUALLY HAPPENED. One episode record per disconnection, carrying the times and
 *      the attempt count, so a completed observation can say how long the feed was down
 *      rather than only that it was.
 *
 * It opens no socket, owns no timer, and reaches no network. The caller owns the single
 * reconnect timer and tells this module when it is armed; that is what makes
 * `reconnectTimerCount` a measurement rather than an assumption.
 *
 * Nothing here touches orders, accounts, credentials, or any authenticated endpoint. The
 * feed it supervises is the public ticker stream and nothing else.
 */

export type MarketConnectionState =
  | "CONNECTED"
  | "STALE"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "RECOVERED"
  | "FAILED";

/**
 * FRESH and STALE are judgements. UNKNOWN is the absence of one: no message has ever
 * arrived, or the newest timestamp is in the future by more than the tolerance, so an age
 * cannot honestly be computed. Folding UNKNOWN into STALE would report a measured verdict
 * where none was measured; folding it into FRESH would be worse.
 */
export type MarketFreshness = "FRESH" | "STALE" | "UNKNOWN";

export type MarketReconnectFailureReason = "MAX_ATTEMPTS_EXCEEDED" | "MAX_RECONNECT_TIME_EXCEEDED";

/**
 * How an episode ended.
 *
 * ABANDONED is kept apart from FAILED on purpose: FAILED means the retry policy was spent,
 * ABANDONED means someone stopped the client while reconnection was still in progress. They
 * look the same in a downtime total and mean completely different things to an operator.
 */
export type MarketReconnectOutcome = "RECOVERED" | "FAILED" | "ABANDONED" | "IN_PROGRESS";

export interface MarketReconnectPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number;
  /** Hard ceiling on attempts within one disconnection episode. */
  readonly maxAttempts: number;
  /** Hard ceiling on wall-clock time spent reconnecting within one episode. */
  readonly maxTotalReconnectMs: number;
  /** Silence longer than this, while the socket is still open, is STALE rather than down. */
  readonly staleAfterMs: number;
}

/**
 * Ten attempts spread over at most ten minutes. Chosen so an ordinary network blip during a
 * 30-minute observation is ridden out instead of ending the session, while a genuinely dead
 * feed still terminates the session with a reason rather than retrying into the evening.
 */
export const DEFAULT_MARKET_RECONNECT_POLICY: MarketReconnectPolicy = Object.freeze({
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  maxAttempts: 10,
  maxTotalReconnectMs: 600_000,
  staleAfterMs: 30_000
});

/** Returns the reasons a policy is unusable. An empty array means it is usable. */
export function validateMarketReconnectPolicy(policy: MarketReconnectPolicy): readonly string[] {
  const violations: string[] = [];
  if (!Number.isSafeInteger(policy.initialDelayMs) || policy.initialDelayMs < 100) violations.push("INITIAL_DELAY_TOO_SMALL");
  if (!Number.isSafeInteger(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) violations.push("MAX_DELAY_BELOW_INITIAL");
  if (!Number.isFinite(policy.backoffFactor) || policy.backoffFactor < 1) violations.push("BACKOFF_FACTOR_NOT_INCREASING");
  // Both ceilings are required and both must be finite. An unbounded retry loop is exactly
  // the failure this module exists to prevent, so it is rejected here rather than left to a
  // reviewer to notice.
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) violations.push("MAX_ATTEMPTS_UNBOUNDED");
  if (!Number.isSafeInteger(policy.maxTotalReconnectMs) || policy.maxTotalReconnectMs < policy.initialDelayMs) violations.push("MAX_RECONNECT_TIME_UNBOUNDED");
  if (!Number.isSafeInteger(policy.staleAfterMs) || policy.staleAfterMs < 1_000) violations.push("STALE_THRESHOLD_TOO_SMALL");
  return Object.freeze(violations);
}

/** Bounded exponential backoff for the nth attempt of one episode. `attempt` is 1-based. */
export function marketReconnectDelay(attempt: number, policy: MarketReconnectPolicy = DEFAULT_MARKET_RECONNECT_POLICY): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive safe integer");
  const raw = policy.initialDelayMs * policy.backoffFactor ** (attempt - 1);
  return Math.min(policy.maxDelayMs, Math.round(Number.isFinite(raw) ? raw : policy.maxDelayMs));
}

export interface MarketFreshnessInput {
  readonly now: number;
  /** When the transport last accepted a payload, or null if it never has. */
  readonly lastMessageAt: number | null;
  /** Close time of the newest closed candle, or null if none has been produced. */
  readonly latestCandleCloseTime: number | null;
  readonly toleranceMs: number;
}

/**
 * Separates "the data is old" from "we have no idea how old the data is" (WO-0034-A4L req 4).
 *
 * The two inputs are combined by taking the NEWER of them. A REST candle poll can keep
 * producing while the socket is silent and vice versa; judging on either one alone reports a
 * stall that the other source was covering.
 */
export function evaluateMarketFreshness(input: MarketFreshnessInput): MarketFreshness {
  if (!Number.isFinite(input.now) || !Number.isFinite(input.toleranceMs) || input.toleranceMs < 0) return "UNKNOWN";
  const candidates = [input.lastMessageAt, input.latestCandleCloseTime].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (candidates.length === 0) return "UNKNOWN";
  const newest = Math.max(...candidates);
  // A timestamp meaningfully ahead of the clock makes the age negative. That is a clock or
  // source problem, not a freshness reading, and reporting FRESH from it would be a verdict
  // drawn from a number we know is wrong.
  if (newest - input.now > input.toleranceMs) return "UNKNOWN";
  return input.now - newest > input.toleranceMs ? "STALE" : "FRESH";
}

export interface MarketConnectionEpisode {
  readonly episodeId: number;
  readonly disconnectedAt: number;
  readonly reconnectAttemptCount: number;
  readonly recoveredAt: number | null;
  readonly totalDowntime: number;
  readonly finalReconnectState: MarketReconnectOutcome;
  readonly failureReason: MarketReconnectFailureReason | null;
}

export interface MarketConnectionDiagnostics {
  readonly marketConnectionState: MarketConnectionState;
  /** Attempts made in the CURRENT episode. Zero when the feed is not in trouble. */
  readonly reconnectAttempt: number;
  readonly reconnectAttemptLimit: number;
  readonly reconnectStartedAt: number | null;
  readonly lastMarketMessageAt: number | null;
  readonly lastSuccessfulReconnectAt: number | null;
  readonly activeMarketListenerCount: number;
  readonly activeMarketSubscriptionCount: number;
  readonly reconnectTimerCount: number;
  readonly reconnectFailureReason: MarketReconnectFailureReason | null;
  /** How long the current episode has been going. Zero when there is no open episode. */
  readonly currentDowntimeMs: number;
  readonly totalDowntimeMs: number;
  readonly episodes: readonly MarketConnectionEpisode[];
}

export type MarketReconnectDecision =
  | Readonly<{ action: "RETRY"; attempt: number; delayMs: number }>
  | Readonly<{ action: "GIVE_UP"; attempt: number; reason: MarketReconnectFailureReason }>;

interface OpenEpisode {
  readonly episodeId: number;
  readonly disconnectedAt: number;
  attempts: number;
}

export interface MarketConnectionSupervisorOptions {
  readonly policy?: MarketReconnectPolicy;
  readonly now?: () => number;
  readonly getListenerCount?: () => number;
  readonly getSubscriptionCount?: () => number;
  /** Bounded so a very long session cannot grow this record without limit. */
  readonly maxEpisodes?: number;
}

const DEFAULT_MAX_EPISODES = 200;
const safeCount = (value: number): number => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

export class MarketConnectionSupervisor {
  private connectionState: MarketConnectionState = "DISCONNECTED";
  private attempt = 0;
  private lastMessageAt: number | null = null;
  private lastSuccessfulReconnectAt: number | null = null;
  private failureReason: MarketReconnectFailureReason | null = null;
  private timerArmed = false;
  private episodeSequence = 0;
  private openEpisode?: OpenEpisode;
  /**
   * When the feed went down and has not come back. Kept apart from `openEpisode`, which is
   * closed the moment the retry policy gives up: the episode RECORD is finished then, but
   * the OUTAGE is not, and reporting "no outage in progress" from a FAILED state would show
   * an operator a disconnect time of "(none)" and a current downtime of zero while the feed
   * is still dead. Cleared only by a real recovery or by an owner stop.
   */
  private unresolvedSince: number | null = null;
  /**
   * The instant up to which the CURRENT outage has already been folded into
   * `closedDowntimeMs`. Without it, a give-up freezes the total while the feed is still
   * down, and `currentDowntimeMs` would overtake `totalDowntimeMs` -- two numbers from one
   * outage disagreeing with each other.
   */
  private downtimeAccountedUpTo = 0;
  private readonly episodeLog: MarketConnectionEpisode[] = [];
  private closedDowntimeMs = 0;
  private readonly policy: MarketReconnectPolicy;
  private readonly now: () => number;
  private readonly getListenerCount: () => number;
  private readonly getSubscriptionCount: () => number;
  private readonly maxEpisodes: number;

  constructor(options: MarketConnectionSupervisorOptions = {}) {
    this.policy = options.policy ?? DEFAULT_MARKET_RECONNECT_POLICY;
    const violations = validateMarketReconnectPolicy(this.policy);
    if (violations.length > 0) throw new Error(`invalid market reconnect policy: ${violations.join(",")}`);
    this.now = options.now ?? (() => Date.now());
    this.getListenerCount = options.getListenerCount ?? (() => 0);
    this.getSubscriptionCount = options.getSubscriptionCount ?? (() => 0);
    this.maxEpisodes = options.maxEpisodes ?? DEFAULT_MAX_EPISODES;
    if (!Number.isSafeInteger(this.maxEpisodes) || this.maxEpisodes < 1) throw new Error("maxEpisodes must be a positive safe integer");
  }

  state(): MarketConnectionState {
    return this.connectionState;
  }

  reconnectPolicy(): MarketReconnectPolicy {
    return this.policy;
  }

  /**
   * The transport opened a socket. An open episode closes as RECOVERED here; with no open
   * episode this is a first connection, which is CONNECTED and not a recovery of anything.
   */
  noteOpened(): MarketConnectionState {
    const now = this.now();
    if (this.openEpisode !== undefined) {
      this.closeEpisode("RECOVERED", now, null);
      this.lastSuccessfulReconnectAt = now;
      this.connectionState = "RECOVERED";
    } else if (this.unresolvedSince !== null) {
      // Reconnected after the policy had already given up (only reachable if the transport
      // is restarted). The FAILED episode stays as written -- the policy really did give up
      // -- but the downtime it did not cover is still folded in, so the total stays whole.
      this.closedDowntimeMs += Math.max(0, now - this.downtimeAccountedUpTo);
      this.lastSuccessfulReconnectAt = now;
      this.connectionState = "RECOVERED";
    } else {
      this.connectionState = "CONNECTED";
    }
    this.unresolvedSince = null;
    this.attempt = 0;
    this.failureReason = null;
    return this.connectionState;
  }

  /**
   * The transport accepted a payload. This is what settles RECOVERED into CONNECTED: an open
   * socket that delivers nothing is not a recovered feed, and treating the open alone as
   * recovery would report health from a connection that never carried data.
   */
  noteMessage(): MarketConnectionState {
    this.lastMessageAt = this.now();
    if (this.connectionState === "RECOVERED" || this.connectionState === "STALE") this.connectionState = "CONNECTED";
    return this.connectionState;
  }

  /**
   * The socket is open but has gone quiet. Deliberately does NOT open an episode: a stale
   * feed has not disconnected, and counting it as downtime would inflate every total with
   * periods where the connection was intact.
   */
  noteStale(): MarketConnectionState {
    if (this.connectionState === "CONNECTED" || this.connectionState === "RECOVERED") this.connectionState = "STALE";
    return this.connectionState;
  }

  /** The transport lost the socket. Returns whether, and when, to try again. */
  noteDisconnected(): MarketReconnectDecision {
    const now = this.now();
    if (this.openEpisode === undefined) {
      this.episodeSequence += 1;
      this.openEpisode = { episodeId: this.episodeSequence, disconnectedAt: now, attempts: 0 };
      // A fresh episode starts from zero. Carrying the previous one's count forward would
      // make a later outage inherit a spent budget and give up on its first attempt.
      this.attempt = 0;
      this.failureReason = null;
      if (this.unresolvedSince === null) {
        this.unresolvedSince = now;
        this.downtimeAccountedUpTo = now;
      }
    }
    this.connectionState = "DISCONNECTED";
    const attempt = this.attempt + 1;
    if (attempt > this.policy.maxAttempts) return this.giveUp(attempt, "MAX_ATTEMPTS_EXCEEDED", now);
    const delayMs = marketReconnectDelay(attempt, this.policy);
    // The wall-clock ceiling is checked against the moment the retry would FIRE, not the
    // moment it is scheduled. Checking only the current elapsed time arms one more attempt
    // that is already known to land past the ceiling.
    if (now - this.openEpisode.disconnectedAt + delayMs > this.policy.maxTotalReconnectMs) {
      return this.giveUp(attempt, "MAX_RECONNECT_TIME_EXCEEDED", now);
    }
    this.attempt = attempt;
    this.openEpisode.attempts = attempt;
    this.connectionState = "RECONNECTING";
    return Object.freeze({ action: "RETRY" as const, attempt, delayMs });
  }

  /**
   * The caller armed its single reconnect timer. Throws if one is already armed: two live
   * timers would double the retry rate and put the episode's attempt count out of step with
   * the number of connections actually attempted.
   */
  armReconnectTimer(): void {
    if (this.timerArmed) throw new Error("a reconnect timer is already armed");
    this.timerArmed = true;
  }

  disarmReconnectTimer(): void {
    this.timerArmed = false;
  }

  reconnectTimerArmed(): boolean {
    return this.timerArmed;
  }

  /** The owner stopped the client. Any episode still open ends ABANDONED, never RECOVERED. */
  noteStopped(): void {
    this.timerArmed = false;
    if (this.openEpisode !== undefined) this.closeEpisode("ABANDONED", this.now(), null);
    if (this.unresolvedSince !== null) this.closedDowntimeMs += Math.max(0, this.now() - this.downtimeAccountedUpTo);
    this.unresolvedSince = null;
    this.connectionState = "DISCONNECTED";
    this.attempt = 0;
  }

  diagnostics(): MarketConnectionDiagnostics {
    const now = this.now();
    // Measured from the outage, not from the episode record: after a give-up the record is
    // closed but the feed is still down, and zero would be a number that looks measured.
    const outageStartedAt = this.openEpisode?.disconnectedAt ?? this.unresolvedSince;
    const currentDowntimeMs = outageStartedAt === null || outageStartedAt === undefined ? 0 : Math.max(0, now - outageStartedAt);
    const unrecordedDowntimeMs = this.unresolvedSince === null ? 0 : Math.max(0, now - this.downtimeAccountedUpTo);
    return Object.freeze({
      marketConnectionState: this.connectionState,
      reconnectAttempt: this.attempt,
      reconnectAttemptLimit: this.policy.maxAttempts,
      reconnectStartedAt: outageStartedAt ?? null,
      lastMarketMessageAt: this.lastMessageAt,
      lastSuccessfulReconnectAt: this.lastSuccessfulReconnectAt,
      activeMarketListenerCount: safeCount(this.getListenerCount()),
      activeMarketSubscriptionCount: safeCount(this.getSubscriptionCount()),
      reconnectTimerCount: this.timerArmed ? 1 : 0,
      reconnectFailureReason: this.failureReason,
      currentDowntimeMs,
      totalDowntimeMs: this.closedDowntimeMs + unrecordedDowntimeMs,
      episodes: Object.freeze([...this.episodeLog])
    });
  }

  episodes(): readonly MarketConnectionEpisode[] {
    return Object.freeze([...this.episodeLog]);
  }

  private giveUp(attempt: number, reason: MarketReconnectFailureReason, now: number): MarketReconnectDecision {
    this.attempt = attempt - 1;
    this.failureReason = reason;
    this.connectionState = "FAILED";
    this.closeEpisode("FAILED", now, reason);
    return Object.freeze({ action: "GIVE_UP" as const, attempt, reason });
  }

  private closeEpisode(outcome: MarketReconnectOutcome, at: number, failureReason: MarketReconnectFailureReason | null): void {
    const open = this.openEpisode;
    if (open === undefined) return;
    const totalDowntime = Math.max(0, at - open.disconnectedAt);
    this.closedDowntimeMs += Math.max(0, at - this.downtimeAccountedUpTo);
    this.downtimeAccountedUpTo = at;
    this.episodeLog.push(Object.freeze({
      episodeId: open.episodeId,
      disconnectedAt: open.disconnectedAt,
      reconnectAttemptCount: open.attempts,
      recoveredAt: outcome === "RECOVERED" ? at : null,
      totalDowntime,
      finalReconnectState: outcome,
      failureReason
    }));
    // Oldest first, so the most recent episodes -- the ones an operator is looking at -- are
    // the ones that survive the bound.
    while (this.episodeLog.length > this.maxEpisodes) this.episodeLog.shift();
    this.openEpisode = undefined;
  }
}
