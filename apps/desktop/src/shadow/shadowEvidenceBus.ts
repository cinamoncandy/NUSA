import type { ShadowPilotEvent } from "../shadow/shadowPilotRuntime";
import type { ShadowCompletionEvidence } from "../shadow/shadowCompletionEvidence";
import type { MarketConnectionEvidence } from "../exchange/marketConnectionEvidence";

/**
 * Bounded, exactly-once delivery bus between the synchronous Shadow runtime and its
 * asynchronous sinks (WO-0034-A3).
 *
 * The runtime publishes from inside a ticker callback, which cannot await a disk write, so
 * events are queued and drained on a microtask. Everything else in this file exists to make
 * that gap safe rather than convenient:
 *
 *   - EXACTLY ONCE. A (sessionId, sequence) pair is delivered to each sink at most once and,
 *     unless the bus halts, at least once. Re-publishing the same pair is dropped as a
 *     duplicate rather than written twice, because a duplicated evidence row is
 *     indistinguishable from a real repeated event once the session is over.
 *   - BOUNDED. The queue has a fixed capacity. An unbounded queue would trade a visible
 *     stall for invisible memory growth and a late crash.
 *   - OVERFLOW HALTS. Dropping the oldest or newest event would leave a hash-chained
 *     evidence file with a hole in it, which the verifier would later report as corruption
 *     with no way to tell it apart from tampering. Refusing to continue is the honest
 *     failure.
 *   - WRITER FAILURE HALTS. A sink that throws means the durable record is already
 *     incomplete. Continuing to accept events after that would build a session whose
 *     evidence cannot be trusted, so the bus stops and says why.
 *
 * A halted bus never un-halts. The session it belonged to is finished; a new session gets a
 * new bus.
 */

export type ShadowEvidenceBusStatus = "OPEN" | "HALTED";

export type ShadowEvidenceHaltReason = "QUEUE_OVERFLOW" | "SINK_WRITE_FAILED" | "SINK_FLUSH_FAILED" | "SINK_FINALIZE_FAILED";

export interface ShadowEvidenceSink {
  readonly name: string;
  /** Receives each event exactly once, in sequence order. Throwing halts the bus. */
  deliver(event: ShadowPilotEvent): Promise<void> | void;
  /** Flushes sink-local buffers after queued delivery. Throwing halts the bus. */
  flush?(): Promise<void> | void;
  /** Called once when the session ends. Throwing halts the bus but does not undo delivery. */
  finalize?(reason: string, status: "COMPLETED" | "ABORTED", completion?: ShadowCompletionEvidence, marketConnection?: MarketConnectionEvidence): Promise<void> | void;
}

export interface ShadowEvidenceBusDiagnostics {
  readonly status: ShadowEvidenceBusStatus;
  readonly haltReason: ShadowEvidenceHaltReason | null;
  readonly haltDetail: string | null;
  readonly published: number;
  readonly delivered: number;
  readonly duplicatesDropped: number;
  readonly queueDepth: number;
  readonly queueCapacity: number;
  readonly highWaterMark: number;
  readonly finalized: boolean;
}

export interface ShadowEvidenceBusOptions {
  readonly sessionId: string;
  readonly sinks: readonly ShadowEvidenceSink[];
  /** Fixed queue capacity. Exceeding it halts rather than dropping. */
  readonly capacity?: number;
  readonly onHalt?: (reason: ShadowEvidenceHaltReason, detail: string) => void;
}

const DEFAULT_CAPACITY = 1_000;

export class ShadowEvidenceBus {
  private readonly sessionId: string;
  private readonly sinks: readonly ShadowEvidenceSink[];
  private readonly capacity: number;
  private readonly onHalt?: (reason: ShadowEvidenceHaltReason, detail: string) => void;

  private queue: ShadowPilotEvent[] = [];
  /** Sequences accepted into the queue; the basis of the exactly-once guarantee. */
  private readonly accepted = new Map<number, string | undefined>();
  private status: ShadowEvidenceBusStatus = "OPEN";
  private haltReason: ShadowEvidenceHaltReason | null = null;
  private haltDetail: string | null = null;
  private published = 0;
  private delivered = 0;
  private duplicatesDropped = 0;
  private highWaterMark = 0;
  private finalized = false;
  private draining: Promise<void> = Promise.resolve();

  constructor(options: ShadowEvidenceBusOptions) {
    this.sessionId = options.sessionId;
    this.sinks = Object.freeze([...options.sinks]);
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("event bus capacity must be a positive safe integer");
    this.capacity = capacity;
    if (options.onHalt) this.onHalt = options.onHalt;
  }

  /**
   * Accepts an event for delivery. Synchronous by design: the caller is inside a market-data
   * callback and must not await. Returns false when the event was refused -- the caller is
   * expected to treat that as a halt condition, not to retry.
   */
  publish(event: ShadowPilotEvent): boolean {
    if (this.status !== "OPEN") return false;
    if (event.sessionId !== this.sessionId) {
      this.halt("SINK_WRITE_FAILED", `event belongs to session ${event.sessionId}, bus serves ${this.sessionId}`);
      return false;
    }
    const acceptedEventHash = this.accepted.get(event.sequence);
    if (acceptedEventHash !== undefined || this.accepted.has(event.sequence)) {
      if (acceptedEventHash !== event.eventSha256) {
        this.halt("SINK_WRITE_FAILED", `conflicting duplicate event sequence ${event.sequence}`);
        return false;
      }
      this.duplicatesDropped += 1;
      return true;
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence !== this.accepted.size + 1) {
      this.halt("SINK_WRITE_FAILED", `event sequence ${event.sequence} is not the next canonical sequence`);
      return false;
    }
    if (this.queue.length >= this.capacity) {
      // Dropping either end would silently punch a hole in a hash-chained file.
      this.halt("QUEUE_OVERFLOW", `queue reached capacity ${this.capacity} with sequence ${event.sequence} pending`);
      return false;
    }
    this.accepted.set(event.sequence, event.eventSha256);
    this.queue.push(event);
    this.published += 1;
    this.highWaterMark = Math.max(this.highWaterMark, this.queue.length);
    this.scheduleDrain();
    return true;
  }

  private scheduleDrain(): void {
    this.draining = this.draining.then(() => this.drain()).catch(() => undefined);
  }

  private async drain(): Promise<void> {
    while (this.status === "OPEN" && this.queue.length > 0) {
      const event = this.queue[0]!;
      for (const sink of this.sinks) {
        try {
          await sink.deliver(event);
        } catch (error) {
          // The event stays at the head of the queue: it was not delivered, and the bus is
          // halted, so it will never be delivered twice by a later retry either.
          this.halt("SINK_WRITE_FAILED", `${sink.name}: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      }
      this.queue.shift();
      this.delivered += 1;
    }
  }

  /** Resolves once everything accepted so far has been delivered (or the bus has halted). */
  async flush(): Promise<void> {
    // A halted delivery may be a non-cancellable sink promise. Do not make shutdown wait
    // forever for an event that can no longer be made durable; finalize the session as ABORTED.
    if (this.status === "HALTED" && this.queue.length > 0) return;
    await this.draining;
    for (const sink of this.sinks) {
      if (!sink.flush) continue;
      try {
        await sink.flush();
      } catch (error) {
        this.halt("SINK_FLUSH_FAILED", `${sink.name}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }
  }

  /**
   * Drains, then finalizes every sink exactly once. A halted bus still finalizes, so a
   * partial session is sealed as ABORTED rather than left open and ambiguous on disk.
   */
  async finalize(reason: string, status: "COMPLETED" | "ABORTED" = "COMPLETED", completion?: ShadowCompletionEvidence, marketConnection?: MarketConnectionEvidence): Promise<void> {
    await this.flush();
    if (this.finalized) return;
    this.finalized = true;
    const effective = this.status === "HALTED" || this.queue.length > 0 ? "ABORTED" : status;
    for (const sink of this.sinks) {
      if (!sink.finalize) continue;
      try {
        await sink.finalize(reason, effective, completion, marketConnection);
      } catch (error) {
        this.halt("SINK_FINALIZE_FAILED", `${sink.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private halt(reason: ShadowEvidenceHaltReason, detail: string): void {
    if (this.status === "HALTED") return;
    this.status = "HALTED";
    this.haltReason = reason;
    this.haltDetail = detail;
    try {
      this.onHalt?.(reason, detail);
    } catch {
      // A broken halt listener must not mask the halt itself.
    }
  }

  diagnostics(): ShadowEvidenceBusDiagnostics {
    return Object.freeze({
      status: this.status,
      haltReason: this.haltReason,
      haltDetail: this.haltDetail,
      published: this.published,
      delivered: this.delivered,
      duplicatesDropped: this.duplicatesDropped,
      queueDepth: this.queue.length,
      queueCapacity: this.capacity,
      highWaterMark: this.highWaterMark,
      finalized: this.finalized
    });
  }
}

/**
 * Keeps every delivered event in memory for the current session. Used by diagnostics and by
 * tests; it is never the system of record, and it deliberately does not tolerate a gap so
 * that a disagreement with the durable sink surfaces instead of being smoothed over.
 */
export class InMemoryEvidenceSink implements ShadowEvidenceSink {
  readonly name = "in-memory";
  private readonly events: ShadowPilotEvent[] = [];
  private finalizedAs: "COMPLETED" | "ABORTED" | null = null;

  deliver(event: ShadowPilotEvent): void {
    const expected = this.events.length + 1;
    if (event.sequence !== expected) throw new Error(`in-memory sink expected sequence ${expected}, received ${event.sequence}`);
    this.events.push(event);
  }

  finalize(_reason: string, status: "COMPLETED" | "ABORTED", _completion?: ShadowCompletionEvidence, _marketConnection?: MarketConnectionEvidence): void {
    this.finalizedAs = status;
  }

  snapshot(): readonly ShadowPilotEvent[] { return Object.freeze([...this.events]); }
  finalStatus(): "COMPLETED" | "ABORTED" | null { return this.finalizedAs; }
}

/**
 * Writes each event into a durable, hash-chained archive. This is the system of record.
 *
 * It owns no policy: it appends, and it lets an append failure propagate so the bus halts.
 * Swallowing a write error here would produce exactly the outcome A3 exists to prevent -- a
 * session that looks complete and whose evidence file silently is not.
 */
export interface DurableEvidenceWriter {
  append(event: ShadowPilotEvent, receivedAt?: number): Promise<unknown>;
  flush?(): Promise<unknown>;
  finalize(completionReason: string, generatedAt?: number, status?: "COMPLETED" | "ABORTED", completion?: ShadowCompletionEvidence, marketConnection?: MarketConnectionEvidence): Promise<unknown>;
}

export class DurableEvidenceSink implements ShadowEvidenceSink {
  readonly name = "durable-archive";

  constructor(private readonly archive: DurableEvidenceWriter, private readonly now: () => number = Date.now) {}

  async deliver(event: ShadowPilotEvent): Promise<void> {
    await this.archive.append(event, this.now());
  }

  async flush(): Promise<void> {
    await this.archive.flush?.();
  }

  async finalize(reason: string, status: "COMPLETED" | "ABORTED", completion?: ShadowCompletionEvidence, marketConnection?: MarketConnectionEvidence): Promise<void> {
    await this.archive.finalize(reason, this.now(), status, completion, marketConnection);
  }
}
