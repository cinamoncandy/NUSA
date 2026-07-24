export interface EquitySample {
  readonly timestamp: number;
  readonly equity: number;
}

const DEFAULT_MAX_SAMPLES = 500;

/**
 * In-memory equity time series backing the web UI's account performance chart. Same
 * non-durable, audit-only posture as PaperRuntime's reference Portfolio (E02-T006/T007):
 * resets on every restart rather than persisted, since PaperBroker's own SQLite-backed state
 * (via DesktopPersistenceStore) remains the single source of truth for the real account. A
 * bounded ring buffer (oldest sample dropped once full) keeps memory use flat regardless of
 * uptime.
 */
export class EquityHistoryRecorder {
  private readonly samples: EquitySample[] = [];

  constructor(private readonly maxSamples: number = DEFAULT_MAX_SAMPLES) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error("maxSamples must be a positive integer");
  }

  record(timestamp: number, equity: number): void {
    this.samples.push(Object.freeze({ timestamp, equity }));
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  history(): readonly EquitySample[] {
    return Object.freeze([...this.samples]);
  }
}
