/**
 * A structured request logger, per DOKKAEBI.md's "Logging" rule: every command needs
 * requestId/commandId/userId/deviceId. Writes one JSON line per request via `sink` (default:
 * process.stdout.write, deliberately not console.log -- DOKKAEBI.md's coding rules explicitly
 * forbid console.log; a real Logger writes structured, parseable lines a log aggregator can
 * consume, not ad-hoc unstructured console calls) and keeps a bounded in-memory tail so the
 * operator can inspect recent activity via GET /api/audit/requests without needing external log
 * infrastructure -- same "small, bounded, operator-visible" posture as ControlPlane's own event
 * log and EquityHistoryRecorder.
 *
 * userId is always "operator": this is an explicitly single-user system (see DOKKAEBI.md's
 * Mission) with no per-user accounts, so there is exactly one possible identity to log, and
 * pretending otherwise would fabricate a multi-user concept that does not exist yet.
 * deviceId is whatever the client sends via the X-Device-Id header (app.js generates and
 * persists a random UUID per browser on first load) -- present when a browser sent one, absent
 * otherwise (e.g. curl/scripts), never invented.
 */
export interface LogEntry {
  readonly timestamp: string;
  readonly requestId: string;
  /** Present only for state-changing requests (non-GET) -- a GET is a read, not a command. */
  readonly commandId?: string;
  readonly userId: string;
  readonly deviceId?: string;
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
  readonly durationMs: number;
}

export type LogSink = (entry: LogEntry) => void;

export const stdoutSink: LogSink = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

const DEFAULT_MAX_ENTRIES = 500;

export class Logger {
  private readonly entries: LogEntry[] = [];

  constructor(private readonly sink: LogSink = stdoutSink, private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be a positive integer");
  }

  log(entry: LogEntry): void {
    this.sink(entry);
    this.entries.push(Object.freeze(entry));
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  /** Newest-first, matching ControlPlane's own event-log convention. */
  recent(): readonly LogEntry[] {
    return Object.freeze([...this.entries].reverse());
  }
}
