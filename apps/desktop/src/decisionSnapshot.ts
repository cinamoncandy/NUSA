import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";

export type DecisionStatus = "BUY" | "SELL" | "WAIT" | "HOLD";
export type DecisionReadResult =
  | { readonly ok: true; readonly snapshot: DecisionSnapshot }
  | { readonly ok: false; readonly status: "NO_DATA" | "UNAVAILABLE"; readonly message: "Decision data is not available" };

export interface DecisionSnapshot {
  readonly recommendation: DecisionStatus;
  readonly conviction: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
  readonly supportingEvidence: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly uncertainty: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  readonly summary: string;
  readonly generatedAt: number;
  readonly recommendationOnly: true;
  readonly productionMutationAllowed: false;
}

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) Object.freeze(value);
  return value;
};

const recommendation = (value: string): DecisionStatus => ["BUY", "SELL", "WAIT", "HOLD"].includes(value) ? value as DecisionStatus : "WAIT";

export function buildDecisionSnapshot(envelope: AiCioCommandCenterEnvelopeV1, now: number): DecisionSnapshot {
  const committee = envelope.snapshot.committee;
  const support = committee.reasons.filter((reason) => !/risk|block|stale|conflict/i.test(reason));
  const counter = [...committee.reasons.filter((reason) => /risk|block|stale|conflict/i.test(reason)), ...envelope.snapshot.warnings];
  const uncertainty = committee.conflictLevel === "HIGH" || counter.length > 2 ? "HIGH" : committee.confidence >= 0.8 ? "LOW" : "MEDIUM";
  const conviction = committee.confidence >= 0.9 ? "VERY_HIGH" : committee.confidence >= 0.75 ? "HIGH" : committee.confidence >= 0.5 ? "MEDIUM" : committee.confidence >= 0.25 ? "LOW" : "VERY_LOW";
  return freeze({ recommendation: recommendation(committee.decision), conviction, supportingEvidence: freeze(support), counterEvidence: freeze(counter), uncertainty, summary: `Recommendation: ${recommendation(committee.decision)}. ${committee.reasons.join(" ") || "Evidence is limited."}`, generatedAt: now, recommendationOnly: true, productionMutationAllowed: false });
}
