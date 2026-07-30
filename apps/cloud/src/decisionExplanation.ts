export type ExplanationRecommendation = "BUY" | "SELL" | "WAIT" | "HOLD";

export interface DecisionExplanationInput {
  readonly recommendation: ExplanationRecommendation;
  readonly supportingEvidence: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly uncertainty: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
}

export interface DecisionExplanation {
  readonly recommendation: ExplanationRecommendation;
  readonly shortSummary: string;
  readonly why: readonly string[];
  readonly whyNot: readonly string[];
  readonly uncertainty: DecisionExplanationInput["uncertainty"];
  readonly recommendationOnly: true;
  readonly productionMutationAllowed: false;
}

export const explainDecision = (input: DecisionExplanationInput): DecisionExplanation => {
  if (input.supportingEvidence.length === 0 && input.counterEvidence.length === 0) throw new Error("decision explanation requires evidence");
  const why = Object.freeze([...input.supportingEvidence]);
  const whyNot = Object.freeze([...input.counterEvidence]);
  const shortSummary = input.recommendation === "WAIT" || input.recommendation === "HOLD"
    ? `${input.recommendation}: evidence is not sufficient for an active recommendation.`
    : `${input.recommendation}: supporting evidence outweighs the available counter evidence.`;
  return Object.freeze({ recommendation: input.recommendation, shortSummary, why, whyNot, uncertainty: input.uncertainty, recommendationOnly: true, productionMutationAllowed: false });
};
