/**
 * Display-only measurement of how long the Node event loop was blocked. The PAPER writer lease (30 s) and the public
 * /health both depend on the loop answering in time, so a multi-second stall explains a lost lease and app time-outs.
 * A timer that fires every `intervalMs` notes how late it ran. Only three numbers leave this module (a maximum, a count and
 * the time of the latest stall); nothing here reads or changes trading, risk, accounting or persistence state.
 */
export interface EventLoopStallSnapshot {
  readonly eventLoopMaxStallMs: number;
  readonly eventLoopStallCount: number;
  readonly lastEventLoopStallAt: number | null;
}

export interface EventLoopStallMonitor {
  start(): void;
  stop(): void;
  /** Takes one sample now; the timer calls this, tests call it directly. */
  sample(): void;
  snapshot(): EventLoopStallSnapshot;
}

export interface EventLoopStallMonitorOptions {
  readonly intervalMs?: number;
  /** A sample this much later than expected counts as a stall. */
  readonly thresholdMs?: number;
  readonly now?: () => number;
}

export function createEventLoopStallMonitor(options: EventLoopStallMonitorOptions = {}): EventLoopStallMonitor {
  const intervalMs = options.intervalMs ?? 250;
  const thresholdMs = options.thresholdMs ?? 1_000;
  const now = options.now ?? Date.now;
  let lastSampleAt = now();
  let maxStallMs = 0;
  let stallCount = 0;
  let lastStallAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const sample = (): void => {
    const at = now();
    const late = at - lastSampleAt - intervalMs;
    lastSampleAt = at;
    // A backwards clock step gives a negative number; it is not a stall and is ignored.
    if (!Number.isFinite(late) || late <= 0) return;
    if (late > maxStallMs) maxStallMs = Math.round(late);
    if (late >= thresholdMs) { stallCount += 1; lastStallAt = at; }
  };

  return {
    start() {
      if (timer != null) return;
      lastSampleAt = now();
      timer = setInterval(sample, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer != null) { clearInterval(timer); timer = undefined; } },
    sample,
    snapshot: () => Object.freeze({ eventLoopMaxStallMs: maxStallMs, eventLoopStallCount: stallCount, lastEventLoopStallAt: lastStallAt }),
  };
}
