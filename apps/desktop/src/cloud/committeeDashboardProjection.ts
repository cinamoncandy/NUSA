import type { RecordedCommitteeDecision } from "../../../cloud/src/investmentCommitteeLedger";
import type { CommitteeDashboardSection } from "../../../cloud/src/dashboardAggregator";

export interface PersistedCommitteeDashboardInput {
  readonly decision: RecordedCommitteeDecision | null;
  readonly integrity: "VALID" | "UNAVAILABLE" | "INVALID";
  readonly generatedAt: number;
  readonly maximumAgeMs: number;
}

export function buildPersistedCommitteeDashboardSection(input: PersistedCommitteeDashboardInput): CommitteeDashboardSection {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("committee generatedAt is invalid");
  if (!Number.isSafeInteger(input.maximumAgeMs) || input.maximumAgeMs <= 0) throw new Error("committee maximumAgeMs is invalid");
  if (input.integrity === "INVALID") {
    return Object.freeze({ status: "BLOCKED", availability: "INVALID", generatedAt: input.generatedAt, reasons: Object.freeze(["COMMITTEE_LEDGER_INVALID"]), decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "UNKNOWN" });
  }
  if (input.integrity === "UNAVAILABLE" || input.decision == null) {
    return Object.freeze({ status: "BLOCKED", availability: "UNAVAILABLE", generatedAt: input.generatedAt, reasons: Object.freeze(["COMMITTEE_SOURCE_NOT_CONNECTED"]), decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "UNKNOWN" });
  }
  if (!Number.isSafeInteger(input.decision.decidedAt) || input.decision.decidedAt < 0 || input.decision.decidedAt > input.generatedAt) {
    return Object.freeze({ status: "BLOCKED", availability: "INVALID", generatedAt: input.generatedAt, reasons: Object.freeze(["COMMITTEE_DECISION_TIMESTAMP_INVALID"]), decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "UNKNOWN" });
  }
  const stale = input.generatedAt - input.decision.decidedAt > input.maximumAgeMs;
  return Object.freeze({
    status: stale ? "CAUTION" : "HEALTHY",
    availability: stale ? "STALE" : "AVAILABLE",
    generatedAt: input.generatedAt,
    reasons: Object.freeze(stale ? ["COMMITTEE_DECISION_STALE"] : ["COMMITTEE_LEDGER_VERIFIED"]),
    decision: input.decision.outcome,
    confidence: input.decision.confidence,
    edge: input.decision.edge,
    risk: input.decision.risk,
    conflictLevel: "UNKNOWN"
  });
}
