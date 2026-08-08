import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";

export interface ResearchStreamEvent {
  readonly market: string;
  readonly price: number;
  readonly eventTime: number;
  readonly receivedAt: number;
  readonly sourceEventId?: string;
}

export type ResearchStreamDisposition = "ACCEPTED" | "DUPLICATE" | "OUT_OF_ORDER" | "TOO_LATE" | "GAP" | "OVERLOADED" | "CLOCK_SKEW";
export interface ResearchStreamResult { readonly disposition: ResearchStreamDisposition; readonly event?: ResearchStreamEvent; readonly fingerprint: string; readonly watermark: number; readonly backlog: number; }

export interface ResearchStreamNormalizerOptions {
  readonly maxPendingEvents?: number;
  readonly maxSeenEvents?: number;
  readonly allowedLatenessMs?: number;
  readonly gapThresholdMs?: number;
  readonly maxClockSkewMs?: number;
}

export class ResearchStreamNormalizer {
  private readonly seen = new Set<string>();
  private readonly pending: ResearchStreamEvent[] = [];
  private readonly seenOrder: string[] = [];
  private readonly maxPendingEvents: number;
  private readonly maxSeenEvents: number;
  private readonly allowedLatenessMs: number;
  private readonly gapThresholdMs: number;
  private readonly maxClockSkewMs: number;
  private watermark = -Infinity;
  public constructor(options: ResearchStreamNormalizerOptions = {}) {
    this.maxPendingEvents = options.maxPendingEvents ?? 100;
    this.maxSeenEvents = options.maxSeenEvents ?? 10_000;
    this.allowedLatenessMs = options.allowedLatenessMs ?? 5_000;
    this.gapThresholdMs = options.gapThresholdMs ?? 60_000;
    this.maxClockSkewMs = options.maxClockSkewMs ?? 30_000;
  }
  public accept(event: ResearchStreamEvent): ResearchStreamResult {
    const fingerprint = createHash("sha256").update(canonicalResearchJson(event.sourceEventId == null ? event : { market: event.market, price: event.price, eventTime: event.eventTime, sourceEventId: event.sourceEventId }), "utf8").digest("hex");
    if (!event.market || !Number.isFinite(event.price) || event.price <= 0 || !Number.isSafeInteger(event.eventTime) || !Number.isSafeInteger(event.receivedAt)) return Object.freeze({ disposition: "CLOCK_SKEW", fingerprint, watermark: this.watermark, backlog: this.pending.length });
    if (event.eventTime - event.receivedAt > this.maxClockSkewMs) return Object.freeze({ disposition: "CLOCK_SKEW", fingerprint, watermark: this.watermark, backlog: this.pending.length });
    if (this.seen.has(fingerprint)) return Object.freeze({ disposition: "DUPLICATE", fingerprint, watermark: this.watermark, backlog: this.pending.length });
    if (event.eventTime < this.watermark - this.allowedLatenessMs) return Object.freeze({ disposition: "TOO_LATE", fingerprint, watermark: this.watermark, backlog: this.pending.length });
    if (this.pending.length >= this.maxPendingEvents) return Object.freeze({ disposition: "OVERLOADED", fingerprint, watermark: this.watermark, backlog: this.pending.length });
    const gap = this.watermark !== -Infinity && event.eventTime - this.watermark > this.gapThresholdMs;
    this.seen.add(fingerprint);
    this.seenOrder.push(fingerprint);
    if (this.seenOrder.length > this.maxSeenEvents) this.seen.delete(this.seenOrder.shift()!);
    this.pending.push(Object.freeze({ ...event }));
    this.pending.sort((left, right) => left.eventTime - right.eventTime || left.market.localeCompare(right.market));
    const next = this.pending.shift()!;
    this.watermark = Math.max(this.watermark, next.eventTime);
    return Object.freeze({ disposition: gap ? "GAP" : next.eventTime < this.watermark ? "OUT_OF_ORDER" : "ACCEPTED", event: next, fingerprint, watermark: this.watermark, backlog: this.pending.length });
  }
  public backlog(): number { return this.pending.length; }
}
