import { createHash } from "node:crypto";

export type CanonicalComponentHealthStatus = "HEALTHY" | "DEGRADED" | "STALE" | "FAILED" | "UNKNOWN";
export type CanonicalComponentHealthReason =
  | "FRESH_EVIDENCE"
  | "DEGRADED_EVIDENCE"
  | "STALE_EVIDENCE"
  | "FAILED_EVIDENCE"
  | "MISSING_EVIDENCE"
  | "FUTURE_EVIDENCE"
  | "OUT_OF_ORDER_EVIDENCE";

export interface CanonicalComponentHealthInput {
  readonly component: string;
  readonly observedAt: number | null;
  readonly now: number;
  readonly maximumAgeMs: number;
  readonly previousObservedAt?: number | null;
  readonly failed?: boolean;
  readonly degraded?: boolean;
  readonly provenance?: string;
}

export interface CanonicalComponentHealth {
  readonly schemaVersion: 1;
  readonly component: string;
  readonly status: CanonicalComponentHealthStatus;
  readonly reason: CanonicalComponentHealthReason;
  readonly observedAt: number | null;
  readonly evaluatedAt: number;
  readonly provenance: string | null;
  readonly fingerprintSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

export function evaluateCanonicalComponentHealth(input: CanonicalComponentHealthInput): CanonicalComponentHealth {
  if (!input.component.trim()) throw new Error("component is required");
  assertTimestamp(input.now, "now");
  if (!Number.isSafeInteger(input.maximumAgeMs) || input.maximumAgeMs <= 0) throw new Error("maximumAgeMs must be positive");
  if (input.observedAt != null) assertTimestamp(input.observedAt, "observedAt");
  if (input.previousObservedAt != null) assertTimestamp(input.previousObservedAt, "previousObservedAt");
  const provenance = input.provenance?.trim() || null;

  let status: CanonicalComponentHealthStatus;
  let reason: CanonicalComponentHealthReason;
  if (input.observedAt == null) {
    status = "UNKNOWN";
    reason = "MISSING_EVIDENCE";
  } else if (input.observedAt > input.now) {
    status = "FAILED";
    reason = "FUTURE_EVIDENCE";
  } else if (input.previousObservedAt != null && input.observedAt < input.previousObservedAt) {
    status = "FAILED";
    reason = "OUT_OF_ORDER_EVIDENCE";
  } else if (input.failed) {
    status = "FAILED";
    reason = "FAILED_EVIDENCE";
  } else if (input.now - input.observedAt > input.maximumAgeMs) {
    status = "STALE";
    reason = "STALE_EVIDENCE";
  } else if (input.degraded) {
    status = "DEGRADED";
    reason = "DEGRADED_EVIDENCE";
  } else {
    status = "HEALTHY";
    reason = "FRESH_EVIDENCE";
  }

  const base = Object.freeze({
    schemaVersion: 1 as const,
    component: input.component,
    status,
    reason,
    observedAt: input.observedAt,
    evaluatedAt: input.now,
    provenance
  });
  const fingerprintSha256 = fingerprint(base);
  if (!SHA256.test(fingerprintSha256)) throw new Error("health fingerprint generation failed");
  return Object.freeze({ ...base, fingerprintSha256 });
}
