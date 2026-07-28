export type ShadowLongRunningHealth = "STABLE" | "CHECK_REQUIRED" | "UNSTABLE";

export interface ShadowLongRunningMemoryUsage {
  readonly rss: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

export interface ShadowLongRunningSourceSnapshot {
  readonly timestamp: number;
  readonly sessionId: string | null;
  readonly sessionState: string;
  readonly observationStartedAt: number | null;
  readonly elapsedTime: number;
  readonly signalCount: number;
  readonly evidenceCount: number;
  readonly marketListenerCount: number;
  readonly marketSubscriptionCount: number;
  readonly lastEventAt: number | null;
  readonly lastEvidenceAt: number | null;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly brokerCallCount: number;
  readonly privateApiCallCount: number;
}

export interface ShadowLongRunningSnapshot extends ShadowLongRunningSourceSnapshot {
  readonly memoryUsage: ShadowLongRunningMemoryUsage;
  readonly rendererMemoryUsage: number | null;
  readonly activeIntervalCount: number;
  readonly activeTimeoutCount: number;
  readonly timerCount: number;
  readonly listenerCount: number;
  readonly runtimeState: string;
}

export interface ShadowLongRunningDiagnostics {
  readonly currentSessionId: string | null;
  readonly sessionState: string;
  readonly observationStartedAt: number | null;
  readonly elapsedTime: number;
  readonly signalCount: number;
  readonly evidenceCount: number;
  readonly activeIntervalCount: number;
  readonly activeTimeoutCount: number;
  readonly marketListenerCount: number;
  readonly marketSubscriptionCount: number;
  readonly processMemoryUsage: ShadowLongRunningMemoryUsage;
  readonly rendererMemoryUsage: number | null;
  readonly lastEventAt: number | null;
  readonly lastEvidenceAt: number | null;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly brokerCallCount: number;
  readonly privateApiCallCount: number;
  readonly memoryHealth: ShadowLongRunningHealth;
  readonly snapshots: readonly ShadowLongRunningSnapshot[];
}

type TimerHandle = unknown;

const EMPTY_MEMORY: ShadowLongRunningMemoryUsage = Object.freeze({
  rss: 0,
  heapUsed: 0,
  heapTotal: 0,
  external: 0,
  arrayBuffers: 0
});

const readMemory = (): ShadowLongRunningMemoryUsage => {
  const usage = process.memoryUsage();
  return Object.freeze({
    rss: Number.isFinite(usage.rss) ? usage.rss : 0,
    heapUsed: Number.isFinite(usage.heapUsed) ? usage.heapUsed : 0,
    heapTotal: Number.isFinite(usage.heapTotal) ? usage.heapTotal : 0,
    external: Number.isFinite(usage.external) ? usage.external : 0,
    arrayBuffers: Number.isFinite(usage.arrayBuffers) ? usage.arrayBuffers : 0
  });
};

const safeCount = (value: number): number => Number.isSafeInteger(value) && value >= 0 ? value : 0;

/**
 * Read-only sampler for long Shadow observations. It owns one interval only while a session
 * is RUNNING and never changes runtime, market, account, or Evidence state.
 *
 * The memory heuristic intentionally does not use a byte threshold: three or more strictly
 * increasing samples are flagged because a real leak should survive ordinary GC noise. Fewer
 * samples remain CHECK_REQUIRED, never an optimistic PASS. This is a diagnostic heuristic,
 * not a claim of proof, and the complete sample series is retained for review.
 */
export class ShadowLongRunningDiagnosticsSampler {
  private interval: TimerHandle | undefined;
  private sessionId: string | null = null;
  private snapshots: ShadowLongRunningSnapshot[] = [];
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly readSource: () => ShadowLongRunningSourceSnapshot;
  private readonly readMemory: () => ShadowLongRunningMemoryUsage;
  private readonly readRendererMemory: () => number | null;
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancel: (handle: TimerHandle) => void;
  private currentMemory: ShadowLongRunningMemoryUsage = EMPTY_MEMORY;
  private currentRendererMemory: number | null = null;

  constructor(options: Readonly<{
    readSource: () => ShadowLongRunningSourceSnapshot;
    intervalMs?: number;
    now?: () => number;
    readMemory?: () => ShadowLongRunningMemoryUsage;
    readRendererMemory?: () => number | null;
    setInterval?: (callback: () => void, delayMs: number) => TimerHandle;
    clearInterval?: (handle: TimerHandle) => void;
  }>) {
    this.readSource = options.readSource;
    this.intervalMs = options.intervalMs ?? 60_000;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 0 || (this.intervalMs > 0 && this.intervalMs < 1_000)) throw new Error("diagnostic interval must be zero or at least 1000ms");
    this.now = options.now ?? (() => Date.now());
    this.readMemory = options.readMemory ?? readMemory;
    this.readRendererMemory = options.readRendererMemory ?? (() => null);
    this.schedule = options.setInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
    this.cancel = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
    this.currentMemory = Object.freeze({ ...this.readMemory() });
    this.currentRendererMemory = this.readRendererMemory();
  }

  start(sessionId: string): void {
    if (!sessionId || this.interval !== undefined) throw new Error("long-running diagnostics already active");
    this.sessionId = sessionId;
    this.snapshots = [];
    this.capture();
    if (this.intervalMs > 0) this.interval = this.schedule(() => this.capture(), this.intervalMs);
  }

  stop(): void {
    if (this.interval !== undefined) {
      this.cancel(this.interval);
      this.interval = undefined;
    }
    if (this.sessionId !== null) this.capture();
  }

  reset(): void {
    this.stop();
    this.sessionId = null;
    this.snapshots = [];
  }

  capture(): ShadowLongRunningSnapshot | null {
    if (this.sessionId === null) return null;
    const source = this.readSource();
    const memoryUsage = Object.freeze({ ...this.readMemory() });
    this.currentMemory = memoryUsage;
    this.currentRendererMemory = this.readRendererMemory();
    const snapshot = Object.freeze({
      ...source,
      timestamp: this.now(),
      memoryUsage,
      rendererMemoryUsage: this.currentRendererMemory,
      activeIntervalCount: this.interval === undefined ? 0 : 1,
      activeTimeoutCount: 0,
      timerCount: this.interval === undefined ? 0 : 1,
      listenerCount: safeCount(source.marketListenerCount),
      runtimeState: source.sessionState
    });
    this.snapshots.push(snapshot);
    return snapshot;
  }

  diagnostics(): ShadowLongRunningDiagnostics {
    const source = this.readSource();
    const memory = this.currentMemory;
    return Object.freeze({
      currentSessionId: source.sessionId,
      sessionState: source.sessionState,
      observationStartedAt: source.observationStartedAt,
      elapsedTime: source.elapsedTime,
      signalCount: source.signalCount,
      evidenceCount: source.evidenceCount,
      activeIntervalCount: this.interval === undefined ? 0 : 1,
      activeTimeoutCount: 0,
      marketListenerCount: source.marketListenerCount,
      marketSubscriptionCount: source.marketSubscriptionCount,
      processMemoryUsage: memory,
      rendererMemoryUsage: this.currentRendererMemory,
      lastEventAt: source.lastEventAt,
      lastEvidenceAt: source.lastEvidenceAt,
      actualOrderCount: source.actualOrderCount,
      actualFillCount: source.actualFillCount,
      cashMutationCount: source.cashMutationCount,
      positionMutationCount: source.positionMutationCount,
      brokerCallCount: source.brokerCallCount,
      privateApiCallCount: source.privateApiCallCount,
      memoryHealth: this.memoryHealth(),
      snapshots: Object.freeze([...this.snapshots])
    });
  }

  private memoryHealth(): ShadowLongRunningHealth {
    if (this.snapshots.length < 3) return "CHECK_REQUIRED";
    const heaps = this.snapshots.map((snapshot) => snapshot.memoryUsage.heapUsed);
    const strictlyIncreasing = heaps.every((value, index) => index === 0 || value > heaps[index - 1]!);
    return strictlyIncreasing ? "UNSTABLE" : "STABLE";
  }
}
