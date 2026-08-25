import { createHash } from "node:crypto";
import type { MarketConnectionEpisode, MarketReconnectOutcome } from "./marketConnectionSupervisor";

/**
 * The market-feed connection record for one Shadow session (WO-0034-A4L).
 *
 * This is SEPARATE evidence, written to its own file beside the event log rather than mixed
 * into it. Two reasons: the pilot event log is a hash chain whose links are the strategy's
 * own observations, and splicing transport events into it would change what a verified chain
 * means; and a session that never disconnected must be able to say so, which an append-only
 * log of disconnections cannot.
 *
 * `finalReconnectState` is NEVER_DISCONNECTED when no episode occurred. That is deliberately
 * not RECOVERED: nothing was recovered, and reporting a recovery from an uninterrupted
 * session would put a downtime story in the record where there was none.
 *
 * Nothing here is derived from an authenticated endpoint, an order, or a credential. It
 * describes the public feed's transport only.
 */

export type MarketConnectionFinalState = MarketReconnectOutcome | "NEVER_DISCONNECTED";

export interface MarketConnectionEvidence {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly generatedAt: number;
  readonly episodeCount: number;
  /** First disconnection of the session, or null if the feed never dropped. */
  readonly disconnectedAt: number | null;
  /** Attempts summed across every episode of the session. */
  readonly reconnectAttemptCount: number;
  /** Most recent recovery, or null if the feed never came back (or never dropped). */
  readonly recoveredAt: number | null;
  readonly totalDowntime: number;
  readonly finalReconnectState: MarketConnectionFinalState;
  readonly episodes: readonly MarketConnectionEpisode[];
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

export function hashMarketConnectionEvidence(value: MarketConnectionEvidence): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export function buildMarketConnectionEvidence(input: Readonly<{
  sessionId: string;
  episodes: readonly MarketConnectionEpisode[];
  generatedAt: number;
}>): MarketConnectionEvidence {
  const episodes = [...input.episodes].sort((left, right) => left.episodeId - right.episodeId);
  const recoveries = episodes.filter((episode) => episode.recoveredAt !== null);
  return Object.freeze({
    schemaVersion: 1,
    sessionId: input.sessionId,
    generatedAt: input.generatedAt,
    episodeCount: episodes.length,
    disconnectedAt: episodes.at(0)?.disconnectedAt ?? null,
    reconnectAttemptCount: episodes.reduce((sum, episode) => sum + episode.reconnectAttemptCount, 0),
    recoveredAt: recoveries.at(-1)?.recoveredAt ?? null,
    totalDowntime: episodes.reduce((sum, episode) => sum + episode.totalDowntime, 0),
    finalReconnectState: episodes.at(-1)?.finalReconnectState ?? "NEVER_DISCONNECTED",
    episodes: Object.freeze(episodes.map((episode) => Object.freeze({ ...episode })))
  });
}

/**
 * A session's connection record is safe when every episode ended in a recovery. A FAILED or
 * still-IN_PROGRESS episode is not a safety violation on its own -- no order was possible
 * either way -- but it does mean the observation ran with a feed it could not rely on, which
 * a reader of the archive has to be able to see without recomputing it.
 */
export function isUninterruptedMarketConnection(value: Readonly<Pick<MarketConnectionEvidence, "episodes">>): boolean {
  return value.episodes.every((episode) => episode.finalReconnectState === "RECOVERED");
}
