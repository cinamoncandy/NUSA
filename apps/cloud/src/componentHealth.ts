import { createHash } from "node:crypto";

export const COMPONENT_HEALTH_STATES = Object.freeze(["HEALTHY", "DEGRADED", "STALE", "FAILED", "UNKNOWN"] as const);
export type ComponentHealthState = (typeof COMPONENT_HEALTH_STATES)[number];

export const COMPONENT_HEALTH_SIGNALS = Object.freeze(["PASS", "DEGRADED", "FAIL"] as const);
export type ComponentHealthSignal = (typeof COMPONENT_HEALTH_SIGNALS)[number];

export type ComponentHealthReasonCode =
  | "EVIDENCE_HEALTHY"
  | "EVIDENCE_DEGRADED"
  | "EVIDENCE_FAILED"
  | "EVIDENCE_STALE"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_INVALID_TIME"
  | "RECOVERY_NOT_VERIFIED";

export interface ComponentHealthEvidence {
  readonly componentId: string;
  readonly signal: ComponentHealthSignal;
  readonly observedAt: number;
  readonly provenance: string;
  readonly evidenceId: string;
}

export interface ComponentHealthPolicy {
  readonly staleAfterMs: number;
}

export interface ComponentHealthResult {
  readonly componentId: string;
  readonly state: ComponentHealthState;
  readonly reasonCode: ComponentHealthReasonCode;
  readonly evaluatedAt: number;
  readonly observedAt?: number;
  readonly provenance?: string;
  readonly evidenceId?: string;
  readonly fingerprint: string;
}

export interface ComponentHealthEvaluationInput {
  readonly componentId: string;
  readonly now: number;
  readonly policy: ComponentHealthPolicy;
  readonly latest?: ComponentHealthEvidence;
  readonly previousFailure?: ComponentHealthEvidence;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function fingerprint(value: Omit<ComponentHealthResult, "fingerprint">): string {
  const canonical = JSON.stringify({
    componentId: value.componentId,
    state: value.state,
    reasonCode: value.reasonCode,
    evaluatedAt: value.evaluatedAt,
    observedAt: value.observedAt ?? null,
    provenance: value.provenance ?? null,
    evidenceId: value.evidenceId ?? null
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function result(value: Omit<ComponentHealthResult, "fingerprint">): ComponentHealthResult {
  return Object.freeze({ ...value, fingerprint: fingerprint(value) });
}

export function evaluateComponentHealth(input: ComponentHealthEvaluationInput): ComponentHealthResult {
  const componentId = input.componentId.trim();
  if (!componentId) throw new Error("componentId is required");
  if (!validTime(input.now)) throw new Error("now must be a non-negative safe integer");
  if (!Number.isSafeInteger(input.policy.staleAfterMs) || input.policy.staleAfterMs < 0) throw new Error("staleAfterMs must be a non-negative safe integer");

  const base = { componentId, evaluatedAt: input.now } as const;
  const evidence = input.latest;
  if (evidence == null) return result({ ...base, state: "UNKNOWN", reasonCode: "EVIDENCE_MISSING" });
  if (evidence.componentId !== componentId || !evidence.provenance.trim() || !evidence.evidenceId.trim() || !validTime(evidence.observedAt) || evidence.observedAt > input.now) {
    return result({ ...base, state: "UNKNOWN", reasonCode: "EVIDENCE_INVALID_TIME" });
  }

  const evidenceFields = { observedAt: evidence.observedAt, provenance: evidence.provenance, evidenceId: evidence.evidenceId } as const;
  if (input.now - evidence.observedAt > input.policy.staleAfterMs) {
    return result({ ...base, ...evidenceFields, state: "STALE", reasonCode: "EVIDENCE_STALE" });
  }
  if (evidence.signal === "FAIL") return result({ ...base, ...evidenceFields, state: "FAILED", reasonCode: "EVIDENCE_FAILED" });
  if (evidence.signal === "DEGRADED") return result({ ...base, ...evidenceFields, state: "DEGRADED", reasonCode: "EVIDENCE_DEGRADED" });

  const previousFailure = input.previousFailure;
  if (previousFailure != null && previousFailure.componentId === componentId && validTime(previousFailure.observedAt) && evidence.observedAt <= previousFailure.observedAt) {
    return result({ ...base, ...evidenceFields, state: "UNKNOWN", reasonCode: "RECOVERY_NOT_VERIFIED" });
  }
  return result({ ...base, ...evidenceFields, state: "HEALTHY", reasonCode: "EVIDENCE_HEALTHY" });
}
