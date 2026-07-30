export type UncertaintyLevel = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export interface UncertaintyInput {
  readonly evidenceFreshness: number;
  readonly sourceAgreement: number;
  readonly sampleAdequacy: number;
  readonly modelStability: number;
  readonly missingCriticalInputs: boolean;
}

export interface UncertaintyResult {
  readonly level: UncertaintyLevel;
  readonly score: number;
  readonly maximumRecommendedWeight: number;
  readonly reasons: readonly string[];
}

const ratio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export const evaluateUncertainty = (input: UncertaintyInput): UncertaintyResult => {
  for (const [value, field] of [[input.evidenceFreshness, "evidenceFreshness"], [input.sourceAgreement, "sourceAgreement"], [input.sampleAdequacy, "sampleAdequacy"], [input.modelStability, "modelStability"]] as const) ratio(value, field);
  const reasons: string[] = [];
  if (input.evidenceFreshness < 0.5) reasons.push("EVIDENCE_STALE");
  if (input.sourceAgreement < 0.5) reasons.push("SOURCE_CONFLICT");
  if (input.sampleAdequacy < 0.5) reasons.push("SAMPLE_INSUFFICIENT");
  if (input.modelStability < 0.5) reasons.push("MODEL_UNSTABLE");
  if (input.missingCriticalInputs) reasons.push("CRITICAL_INPUT_MISSING");
  const confidence = (input.evidenceFreshness + input.sourceAgreement + input.sampleAdequacy + input.modelStability) / 4;
  const score = round(input.missingCriticalInputs ? 1 : 1 - confidence);
  const level = score >= 0.8 ? "VERY_HIGH" : score >= 0.6 ? "HIGH" : score >= 0.4 ? "MEDIUM" : score >= 0.2 ? "LOW" : "VERY_LOW";
  return Object.freeze({ level, score, maximumRecommendedWeight: round(Math.max(0, 1 - score)), reasons: Object.freeze(reasons) });
};
