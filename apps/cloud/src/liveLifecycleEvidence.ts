import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";

export const LIVE_LIFECYCLE_STAGES = Object.freeze(["SUBMIT", "ACK", "FILL", "RECONCILIATION"] as const);
export type LiveLifecycleStage = typeof LIVE_LIFECYCLE_STAGES[number];

export interface CanonicalLiveLifecycleEntry {
  readonly kind: "LIFECYCLE";
  readonly sequence: 1 | 2 | 3 | 4;
  readonly stage: LiveLifecycleStage;
  readonly status: "OBSERVED";
  readonly source: "CANONICAL_MOCK";
  readonly executionMode: "FUTURE_LIVE_MOCK";
  readonly brokerMutation: "NONE";
  readonly eventId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly reason: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const digest = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");

/** Deterministic read-only rehearsal evidence; it never creates an order, fill, or broker request. */
export function buildCanonicalLiveLifecycleEvidence(anchor: string, occurredAt: string): readonly CanonicalLiveLifecycleEntry[] {
  if (!/^[a-f0-9]{64}$/.test(anchor) || !ISO_DATE.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) throw new Error("canonical LIVE lifecycle anchor is invalid");
  const correlationId = digest({ anchor, scenario: "NUSA_FUTURE_LIVE_BOUNDARY_V1" });
  const reasons: readonly string[] = [
    "DORMANT_BOUNDARY_SUBMIT_REHEARSAL",
    "DORMANT_BOUNDARY_ACK_REHEARSAL",
    "DORMANT_BOUNDARY_FILL_REHEARSAL",
    "DORMANT_BOUNDARY_RECONCILIATION_MATCH",
  ];
  const baseMs = Date.parse(occurredAt);
  return Object.freeze(LIVE_LIFECYCLE_STAGES.map((stage, index) => {
    const sequence = (index + 1) as 1 | 2 | 3 | 4;
    const eventId = digest({ correlationId, sequence, stage });
    return Object.freeze({
      kind: "LIFECYCLE" as const,
      sequence,
      stage,
      status: "OBSERVED" as const,
      source: "CANONICAL_MOCK" as const,
      executionMode: "FUTURE_LIVE_MOCK" as const,
      brokerMutation: "NONE" as const,
      eventId,
      correlationId,
      occurredAt: new Date(baseMs + index).toISOString(),
      reason: reasons[index],
    });
  }));
}
