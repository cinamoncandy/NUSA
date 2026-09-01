/**
 * Point-in-time universe membership identity for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "point-in-time universe
 * identity including delistings, symbol changes, mergers, bankruptcies, and historical
 * membership" requirement: whether a symbol was actually a valid, tradeable member of the
 * evaluated universe at the moment a prediction was made. Reconstructing this from today's
 * survivor list would silently exclude every delisted/merged/bankrupt symbol from historical
 * evaluation, understating tail risk and inflating apparent accuracy (survivorship bias) -- this
 * module instead resolves membership from an explicit, dated event history.
 */

export type UniverseMembershipEventType = "ADDED" | "REMOVED" | "DELISTED" | "MERGED" | "BANKRUPT" | "SYMBOL_CHANGED";

/** One dated event affecting a symbol's universe membership. */
export interface UniverseMembershipEvent {
  readonly eventId: string;
  readonly symbol: string;
  readonly type: UniverseMembershipEventType;
  readonly effectiveAt: number;
  /** For SYMBOL_CHANGED only: the new symbol this one becomes as of effectiveAt. */
  readonly renamedTo?: string;
}

export type UniverseMembershipResolution =
  | { readonly member: true }
  | {
      readonly member: false;
      readonly reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" | "REMOVED_BEFORE_EFFECTIVE_TIME" | "INVALID_EFFECTIVE_TIME" | "INVALID_EVENT_HISTORY";
    };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const EVENT_TYPES: readonly UniverseMembershipEventType[] = ["ADDED", "REMOVED", "DELISTED", "MERGED", "BANKRUPT", "SYMBOL_CHANGED"];
const EXIT_EVENT_TYPES: readonly UniverseMembershipEventType[] = ["REMOVED", "DELISTED", "MERGED", "BANKRUPT", "SYMBOL_CHANGED"];

function eventHistoryIsWellFormed(events: readonly UniverseMembershipEvent[]): boolean {
  if (events.length === 0) return false;
  const ids = new Set<string>();
  const symbolTimes = new Set<string>();
  for (const event of events) {
    if (typeof event.eventId !== "string" || !event.eventId.trim()) return false;
    if (typeof event.symbol !== "string" || !event.symbol.trim()) return false;
    if (!EVENT_TYPES.includes(event.type)) return false;
    if (!isTimestamp(event.effectiveAt)) return false;
    if (event.type === "SYMBOL_CHANGED" && (typeof event.renamedTo !== "string" || !event.renamedTo.trim())) return false;
    if (ids.has(event.eventId)) return false;
    ids.add(event.eventId);
    const symbolTime = `${event.symbol}\u0000${event.effectiveAt}`;
    if (symbolTimes.has(symbolTime)) return false;
    symbolTimes.add(symbolTime);
  }
  return true;
}

/**
 * Resolves whether `symbol` was a valid universe member at `asOf`, from an explicit dated event
 * history -- never from a current/survivor list. Fails closed: a malformed event history or
 * invalid `asOf` is treated as non-membership, never as membership by default. The symbol is a
 * member iff it has an ADDED event at or before `asOf` and no exit event (REMOVED, DELISTED,
 * MERGED, BANKRUPT, SYMBOL_CHANGED) at or before `asOf` that is later than its most recent ADDED
 * event -- this allows re-adds after a prior removal to be handled correctly. Multiple events for
 * the same symbol at the same effective time are rejected as ambiguous rather than resolved by
 * input ordering.
 */
export function resolveUniverseMembership(
  symbol: string,
  asOf: number,
  events: readonly UniverseMembershipEvent[],
): UniverseMembershipResolution {
  if (!isTimestamp(asOf)) return { member: false, reason: "INVALID_EFFECTIVE_TIME" };
  if (!eventHistoryIsWellFormed(events)) return { member: false, reason: "INVALID_EVENT_HISTORY" };

  const symbolEvents = events
    .filter((event) => event.symbol === symbol && event.effectiveAt <= asOf)
    .sort((a, b) => a.effectiveAt - b.effectiveAt);

  const lastAddIndex = (() => {
    for (let i = symbolEvents.length - 1; i >= 0; i -= 1) {
      if (symbolEvents[i].type === "ADDED") return i;
    }
    return -1;
  })();
  if (lastAddIndex === -1) return { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" };

  const exitAfterLastAdd = symbolEvents
    .slice(lastAddIndex + 1)
    .some((event) => EXIT_EVENT_TYPES.includes(event.type));
  if (exitAfterLastAdd) return { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" };

  return { member: true };
}

/**
 * True only when every (symbol, asOf) pair in `claims` resolves to actual membership per the
 * given event history -- the structural check that an evaluated cohort did not silently include
 * a symbol that had already delisted/merged/gone bankrupt/been removed by the prediction time,
 * or one that had not yet been added to the universe.
 */
export function isUniverseMembershipConsistent(
  claims: readonly { readonly symbol: string; readonly asOf: number }[],
  events: readonly UniverseMembershipEvent[],
): boolean {
  if (claims.length === 0) return false;
  return claims.every((claim) => resolveUniverseMembership(claim.symbol, claim.asOf, events).member);
}
