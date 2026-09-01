/**
 * Point-in-time universe membership identity for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * Resolves historical membership from explicit dated events so evaluation does not silently use
 * today's survivor list. Malformed histories and invalid timestamps fail closed.
 */

export type UniverseMembershipEventType = "ADDED" | "REMOVED" | "DELISTED" | "MERGED" | "BANKRUPT" | "SYMBOL_CHANGED";

export interface UniverseMembershipEvent {
  readonly eventId: string;
  readonly symbol: string;
  readonly type: UniverseMembershipEventType;
  readonly effectiveAt: number;
  readonly renamedTo?: string;
}

export type UniverseMembershipResolution =
  | { readonly member: true }
  | { readonly member: false; readonly reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" | "REMOVED_BEFORE_EFFECTIVE_TIME" | "INVALID_EFFECTIVE_TIME" | "INVALID_EVENT_HISTORY" };

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

  // A symbol rename is represented as an exit from the old symbol plus exactly one ADDED event
  // for the new symbol at the same effective time. Requiring the paired event keeps membership
  // reconstruction explicit and prevents `renamedTo` from becoming observability-only metadata.
  for (const event of events) {
    if (event.type !== "SYMBOL_CHANGED") continue;
    const renamedTo = event.renamedTo!.trim();
    if (renamedTo === event.symbol) return false;
    const pairedAdds = events.filter((candidate) =>
      candidate.type === "ADDED"
      && candidate.symbol === renamedTo
      && candidate.effectiveAt === event.effectiveAt
    );
    if (pairedAdds.length !== 1) return false;
  }
  return true;
}

export function resolveUniverseMembership(symbol: string, asOf: number, events: readonly UniverseMembershipEvent[]): UniverseMembershipResolution {
  if (!isTimestamp(asOf)) return { member: false, reason: "INVALID_EFFECTIVE_TIME" };
  if (!eventHistoryIsWellFormed(events)) return { member: false, reason: "INVALID_EVENT_HISTORY" };

  const symbolEvents = events
    .filter((event) => event.symbol === symbol && event.effectiveAt <= asOf)
    .sort((a, b) => a.effectiveAt - b.effectiveAt);

  let lastAddIndex = -1;
  for (let i = symbolEvents.length - 1; i >= 0; i -= 1) {
    if (symbolEvents[i].type === "ADDED") { lastAddIndex = i; break; }
  }
  if (lastAddIndex === -1) return { member: false, reason: "NEVER_ADDED_BY_EFFECTIVE_TIME" };
  if (symbolEvents.slice(lastAddIndex + 1).some((event) => EXIT_EVENT_TYPES.includes(event.type))) {
    return { member: false, reason: "REMOVED_BEFORE_EFFECTIVE_TIME" };
  }
  return { member: true };
}

export function isUniverseMembershipConsistent(claims: readonly { readonly symbol: string; readonly asOf: number }[], events: readonly UniverseMembershipEvent[]): boolean {
  if (claims.length === 0) return false;
  return claims.every((claim) => resolveUniverseMembership(claim.symbol, claim.asOf, events).member);
}
