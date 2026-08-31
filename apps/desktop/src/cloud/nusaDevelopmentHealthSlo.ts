import type { NusaCiCriticalPathTelemetry } from "./nusaCiCriticalPathTelemetry";
import type { NusaDevelopmentQueue } from "./nusaDevelopmentControlPlane";
import type { NusaDevelopmentEvent } from "./nusaDevelopmentEventOrchestrator";
import type { NusaMergeReworkTelemetrySnapshot } from "./nusaDevelopmentMergeReworkTelemetry";
import type { EngineeringWorkPortfolio } from "./nusaEngineeringPortfolioScheduler";

export const NUSA_DEVELOPMENT_HEALTH_SLO_AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

export type NusaDevelopmentSloNumber =
  | Readonly<{ status: "MEASURED"; value: number }>
  | Readonly<{ status: "UNKNOWN"; value: null; reason: string }>;

export interface NusaEventToNextActionReceipt {
  readonly receiptId: string;
  readonly sourceEventId: string;
  readonly sourceOccurredAt: number;
  readonly nextActionObservedAt: number;
  readonly sourceFingerprint: string;
}

export interface NusaAgentHeartbeatReceipt {
  readonly agentId: string;
  readonly lastHeartbeatAt: number;
  readonly heartbeatTtlMs: number;
  readonly sourceFingerprint: string;
}

export interface NusaDevelopmentHealthSloInput {
  readonly queue: NusaDevelopmentQueue;
  readonly eventHistory: readonly NusaDevelopmentEvent[];
  /** Earliest instant for which eventHistory is known to be complete. null means completeness is unknown. */
  readonly eventHistoryStartedAt: number | null;
  readonly ciTelemetry: NusaCiCriticalPathTelemetry | null;
  readonly mergeReworkTelemetry: NusaMergeReworkTelemetrySnapshot | null;
  readonly workPortfolio: EngineeringWorkPortfolio | null;
  readonly eventLatencyReceipts: readonly NusaEventToNextActionReceipt[];
  readonly agentHeartbeatReceipts: readonly NusaAgentHeartbeatReceipt[];
  readonly windowStartedAt: number;
  readonly asOf: number;
}

export interface NusaDevelopmentHealthSloSnapshot {
  readonly schemaVersion: 1;
  readonly status: "MEASURED" | "PARTIAL";
  readonly asOf: number;
  readonly windowStartedAt: number;
  readonly metrics: Readonly<{
    queueAgeMs: NusaDevelopmentSloNumber;
    oldestP0P1WaitMs: NusaDevelopmentSloNumber;
    ciP50Ms: NusaDevelopmentSloNumber;
    ciP95Ms: NusaDevelopmentSloNumber;
    eventToNextActionP50Ms: NusaDevelopmentSloNumber;
    eventToNextActionP95Ms: NusaDevelopmentSloNumber;
    mergeThroughputPerHour: NusaDevelopmentSloNumber;
    stalledClaimCount: NusaDevelopmentSloNumber;
    stalledAgentCount: NusaDevelopmentSloNumber;
    duplicateWorkRate: NusaDevelopmentSloNumber;
    conflictRate: NusaDevelopmentSloNumber;
    blockedTimeRatio: NusaDevelopmentSloNumber;
    staleHeadReworkRate: NusaDevelopmentSloNumber;
  }>;
  readonly reasons: readonly string[];
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HOUR_MS = 60 * 60 * 1_000;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const measured = (value: number): NusaDevelopmentSloNumber => freeze({ status: "MEASURED" as const, value });
const unknown = (reason: string): NusaDevelopmentSloNumber => freeze({ status: "UNKNOWN" as const, value: null, reason });
const isTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) throw new Error("SLO_PERCENTILE_REQUIRES_OBSERVATIONS");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)]!;
}

function validateInput(input: NusaDevelopmentHealthSloInput): void {
  if (!isTimestamp(input.asOf) || !isTimestamp(input.windowStartedAt) || input.windowStartedAt >= input.asOf) {
    throw new Error("SLO_WINDOW_INVALID");
  }
  if (input.eventHistoryStartedAt !== null && (!isTimestamp(input.eventHistoryStartedAt) || input.eventHistoryStartedAt > input.asOf)) {
    throw new Error("SLO_EVENT_HISTORY_START_INVALID");
  }
  for (const event of input.eventHistory) {
    if (!isTimestamp(event.occurredAt) || event.occurredAt > input.asOf) throw new Error(`SLO_EVENT_TIMESTAMP_INVALID:${event.eventId}`);
    if (input.eventHistoryStartedAt !== null && event.occurredAt < input.eventHistoryStartedAt) {
      throw new Error(`SLO_EVENT_PRECEDES_HISTORY_START:${event.eventId}`);
    }
  }
}

function validateLatencyReceipts(receipts: readonly NusaEventToNextActionReceipt[], asOf: number): readonly number[] {
  const ids = new Set<string>();
  return receipts.map((receipt) => {
    if (!SAFE_ID.test(receipt.receiptId) || !SAFE_ID.test(receipt.sourceEventId)) throw new Error("SLO_EVENT_LATENCY_ID_INVALID");
    if (ids.has(receipt.receiptId)) throw new Error(`SLO_EVENT_LATENCY_RECEIPT_DUPLICATE:${receipt.receiptId}`);
    ids.add(receipt.receiptId);
    if (!SHA256.test(receipt.sourceFingerprint)) throw new Error(`SLO_EVENT_LATENCY_FINGERPRINT_INVALID:${receipt.receiptId}`);
    if (!isTimestamp(receipt.sourceOccurredAt) || !isTimestamp(receipt.nextActionObservedAt) || receipt.nextActionObservedAt > asOf) {
      throw new Error(`SLO_EVENT_LATENCY_TIMESTAMP_INVALID:${receipt.receiptId}`);
    }
    if (receipt.nextActionObservedAt < receipt.sourceOccurredAt) throw new Error(`SLO_EVENT_LATENCY_NEGATIVE:${receipt.receiptId}`);
    return receipt.nextActionObservedAt - receipt.sourceOccurredAt;
  });
}

function stalledAgentCount(receipts: readonly NusaAgentHeartbeatReceipt[], asOf: number): NusaDevelopmentSloNumber {
  if (receipts.length === 0) return unknown("AGENT_HEARTBEAT_EVIDENCE_MISSING");
  const ids = new Set<string>();
  let stalled = 0;
  for (const receipt of receipts) {
    if (!SAFE_ID.test(receipt.agentId)) throw new Error("SLO_AGENT_ID_INVALID");
    if (ids.has(receipt.agentId)) throw new Error(`SLO_AGENT_HEARTBEAT_DUPLICATE:${receipt.agentId}`);
    ids.add(receipt.agentId);
    if (!SHA256.test(receipt.sourceFingerprint)) throw new Error(`SLO_AGENT_FINGERPRINT_INVALID:${receipt.agentId}`);
    if (!isTimestamp(receipt.lastHeartbeatAt) || receipt.lastHeartbeatAt > asOf || !Number.isSafeInteger(receipt.heartbeatTtlMs) || receipt.heartbeatTtlMs <= 0) {
      throw new Error(`SLO_AGENT_HEARTBEAT_INVALID:${receipt.agentId}`);
    }
    if (receipt.lastHeartbeatAt + receipt.heartbeatTtlMs <= asOf) stalled += 1;
  }
  return measured(stalled);
}

function historyCoversWindow(input: NusaDevelopmentHealthSloInput): boolean {
  return input.eventHistoryStartedAt !== null && input.eventHistoryStartedAt <= input.windowStartedAt;
}

function mergeThroughput(input: NusaDevelopmentHealthSloInput): NusaDevelopmentSloNumber {
  if (!historyCoversWindow(input)) return unknown("EVENT_HISTORY_WINDOW_INCOMPLETE");
  const merges = input.eventHistory.filter((event) => event.type === "PR_MERGED" && event.occurredAt >= input.windowStartedAt && event.occurredAt <= input.asOf).length;
  return measured(merges / ((input.asOf - input.windowStartedAt) / HOUR_MS));
}

function blockedTimeRatio(input: NusaDevelopmentHealthSloInput): NusaDevelopmentSloNumber {
  if (!historyCoversWindow(input)) return unknown("EVENT_HISTORY_WINDOW_INCOMPLETE");
  const byWork = new Map<string, NusaDevelopmentEvent[]>();
  for (const event of input.eventHistory) {
    const events = byWork.get(event.workId) ?? [];
    events.push(event);
    byWork.set(event.workId, events);
  }

  let exposureMs = 0;
  let blockedMs = 0;
  for (const item of input.queue.items) {
    const events = (byWork.get(item.id) ?? []).sort((left, right) => left.occurredAt - right.occurredAt || left.eventId.localeCompare(right.eventId));
    const merged = events.find((event) => event.type === "PR_MERGED");
    const blocked = events.find((event) => event.type === "HUMAN_BLOCKED");
    if (item.state === "MERGED" && !merged) return unknown(`MERGE_EVENT_MISSING:${item.id}`);
    if (item.state === "BLOCKED_HUMAN" && !blocked) return unknown(`HUMAN_BLOCK_EVENT_MISSING:${item.id}`);
    if (item.state !== "BLOCKED_HUMAN" && blocked && (!merged || blocked.occurredAt < merged.occurredAt)) {
      return unknown(`HUMAN_BLOCK_STATE_INCONSISTENT:${item.id}`);
    }

    const start = Math.max(item.createdAt, input.windowStartedAt);
    const end = Math.min(input.asOf, merged?.occurredAt ?? input.asOf);
    if (end <= start) continue;
    exposureMs += end - start;
    if (blocked) {
      const blockStart = Math.max(start, blocked.occurredAt);
      if (end > blockStart) blockedMs += end - blockStart;
    }
  }
  return measured(exposureMs === 0 ? 0 : blockedMs / exposureMs);
}

function portfolioRates(portfolio: EngineeringWorkPortfolio | null): Readonly<{ duplicateWorkRate: NusaDevelopmentSloNumber; conflictRate: NusaDevelopmentSloNumber }> {
  if (!portfolio) return freeze({
    duplicateWorkRate: unknown("WORK_PORTFOLIO_EVIDENCE_MISSING"),
    conflictRate: unknown("WORK_PORTFOLIO_EVIDENCE_MISSING"),
  });
  const total = portfolio.packages.length;
  const duplicateWorkRate = measured(total === 0 ? 0 : portfolio.metrics.duplicateCount / total);
  if (portfolio.ready.length === 0) return freeze({ duplicateWorkRate, conflictRate: measured(0) });
  const conflicted = new Set<string>();
  for (const edge of portfolio.conflictEdges) {
    conflicted.add(edge.packageId);
    if (edge.conflictingPackageId !== null) conflicted.add(edge.conflictingPackageId);
  }
  return freeze({ duplicateWorkRate, conflictRate: measured(conflicted.size / portfolio.ready.length) });
}

function reworkRate(telemetry: NusaMergeReworkTelemetrySnapshot | null): NusaDevelopmentSloNumber {
  if (!telemetry || telemetry.totals.total === 0) return unknown("MERGE_REWORK_EVIDENCE_MISSING");
  if (telemetry.totals.unknown > 0) return unknown("MERGE_REWORK_UNKNOWN_OBSERVATIONS_PRESENT");
  return measured(telemetry.totals.staleHeadRevalidationRequired / telemetry.totals.total);
}

/**
 * Read-only #903 health projection. It composes existing canonical queue, event, CI, rework, and
 * portfolio evidence instead of creating a second scheduler/control plane. Metrics that cannot be
 * derived from complete provenance remain UNKNOWN; this function never fills gaps with estimates.
 */
export function buildNusaDevelopmentHealthSlo(input: NusaDevelopmentHealthSloInput): NusaDevelopmentHealthSloSnapshot {
  validateInput(input);
  const active = input.queue.items.filter((item) => item.state !== "MERGED");
  const p0p1 = active.filter((item) => item.priority === "P0" || item.priority === "P1");
  const queueAgeMs = measured(active.length === 0 ? 0 : Math.max(...active.map((item) => input.asOf - item.createdAt)));
  const oldestP0P1WaitMs = measured(p0p1.length === 0 ? 0 : Math.max(...p0p1.map((item) => input.asOf - item.createdAt)));
  const stalledClaimCountMetric = measured(input.queue.items.filter((item) => item.claim !== null && item.claim.leaseExpiresAt <= input.asOf).length);

  const latencies = validateLatencyReceipts(input.eventLatencyReceipts, input.asOf);
  const eventToNextActionP50Ms = latencies.length === 0 ? unknown("EVENT_TO_NEXT_ACTION_EVIDENCE_MISSING") : measured(nearestRank(latencies, 0.5));
  const eventToNextActionP95Ms = latencies.length === 0 ? unknown("EVENT_TO_NEXT_ACTION_EVIDENCE_MISSING") : measured(nearestRank(latencies, 0.95));
  const ciP50Ms = input.ciTelemetry ? measured(input.ciTelemetry.workflowP50Ms) : unknown("CI_TELEMETRY_MISSING");
  const ciP95Ms = input.ciTelemetry ? measured(input.ciTelemetry.workflowP95Ms) : unknown("CI_TELEMETRY_MISSING");
  const rates = portfolioRates(input.workPortfolio);

  const metrics = freeze({
    queueAgeMs,
    oldestP0P1WaitMs,
    ciP50Ms,
    ciP95Ms,
    eventToNextActionP50Ms,
    eventToNextActionP95Ms,
    mergeThroughputPerHour: mergeThroughput(input),
    stalledClaimCount: stalledClaimCountMetric,
    stalledAgentCount: stalledAgentCount(input.agentHeartbeatReceipts, input.asOf),
    duplicateWorkRate: rates.duplicateWorkRate,
    conflictRate: rates.conflictRate,
    blockedTimeRatio: blockedTimeRatio(input),
    staleHeadReworkRate: reworkRate(input.mergeReworkTelemetry),
  });
  const reasons = freeze(Object.entries(metrics)
    .filter(([, metric]) => metric.status === "UNKNOWN")
    .map(([name, metric]) => `${name}:${metric.status === "UNKNOWN" ? metric.reason : ""}`)
    .sort());
  return freeze({
    schemaVersion: 1 as const,
    status: reasons.length === 0 ? "MEASURED" as const : "PARTIAL" as const,
    asOf: input.asOf,
    windowStartedAt: input.windowStartedAt,
    metrics,
    reasons,
  });
}
