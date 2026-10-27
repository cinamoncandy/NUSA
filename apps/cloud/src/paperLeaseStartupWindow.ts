/**
 * Diagnostics for the gap between owning the renewable PAPER writer lease and the first event-loop turn.
 * The lease heartbeat is an event-loop timer, so synchronous startup work after acquisition counts against the
 * lease TTL. This only measures and reports; it never reads or changes the lease, TTL or any guard.
 */
export interface LeaseStartupWindow {
  /** Call right after the repository (which owns the lease) was constructed. */
  readonly leaseOwned: (constructionMs: number) => void;
  /** Call when the event loop first turns after composition; logs once. */
  readonly firstLoopTurn: () => void;
}

export function describeLeaseStartupWindow(input: { readonly constructionMs: number; readonly toFirstLoopTurnMs: number; readonly leaseDurationMs: number }): string {
  const whole = (value: number) => Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  const construction = whole(input.constructionMs);
  const toTurn = whole(input.toFirstLoopTurnMs);
  const ttl = whole(input.leaseDurationMs);
  // Construction (acquire + legacy recovery + ledger backfill) and the composition after it both run before any heartbeat.
  const starved = construction + toTurn;
  const level = starved >= ttl ? "LEASE_AT_RISK" : starved >= ttl / 2 ? "SLOW" : "OK";
  return `[paper-lease] startup window level=${level} repositoryConstruction=${construction}ms compositionToFirstLoopTurn=${toTurn}ms ttl=${ttl}ms`;
}

export function createLeaseStartupWindow(leaseDurationMs: number, log: (line: string) => void, monotonicMs: () => number = () => performance.now()): LeaseStartupWindow {
  let ownedAt: number | undefined;
  let constructionMs = 0;
  let reported = false;
  return Object.freeze({
    leaseOwned: (ms: number) => { ownedAt = monotonicMs(); constructionMs = ms; },
    firstLoopTurn: () => {
      if (reported || ownedAt === undefined) return;
      reported = true;
      try { log(describeLeaseStartupWindow({ constructionMs, toFirstLoopTurnMs: monotonicMs() - ownedAt, leaseDurationMs })); } catch { /* diagnostics never affect startup */ }
    },
  });
}
