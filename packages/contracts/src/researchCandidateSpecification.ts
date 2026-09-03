export interface ResearchCandidateCostModel {
  readonly feeBps: number;
  readonly slippageBps: number;
  readonly spreadBps: number;
  readonly turnoverAssumption: number;
}

export interface ResearchCandidateSpecification {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly hypothesisId: string;
  readonly familyId: string;
  readonly lineageId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parametersCanonicalJson: string;
  readonly codeSha: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly costModel: ResearchCandidateCostModel;
  readonly createdAt: string;
  readonly evaluationWindowStart: string;
  readonly evaluationWindowEnd: string;
  readonly authority: "PAPER_ONLY";
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const nonNegativeFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function validateResearchCandidateSpecification(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["CANDIDATE_SPEC_INVALID"];
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  if (v.schemaVersion !== 1) errors.push("SCHEMA_VERSION_INVALID");
  for (const key of ["candidateId","hypothesisId","familyId","lineageId","strategyId","strategyVersion","datasetId"] as const) {
    if (typeof v[key] !== "string" || !ID.test(v[key] as string)) errors.push(`${key.toUpperCase()}_INVALID`);
  }
  if (typeof v.parametersCanonicalJson !== "string" || v.parametersCanonicalJson.trim() === "") errors.push("PARAMETERS_CANONICAL_JSON_INVALID");
  else {
    try { JSON.parse(v.parametersCanonicalJson); } catch { errors.push("PARAMETERS_CANONICAL_JSON_INVALID"); }
  }
  if (typeof v.codeSha !== "string" || !SHA40.test(v.codeSha)) errors.push("CODE_SHA_INVALID");
  if (typeof v.datasetContentSha256 !== "string" || !SHA256.test(v.datasetContentSha256)) errors.push("DATASET_CONTENT_SHA256_INVALID");
  const c = v.costModel;
  if (!c || typeof c !== "object" || Array.isArray(c)) errors.push("COST_MODEL_INVALID");
  else {
    const cost = c as Record<string, unknown>;
    for (const key of ["feeBps","slippageBps","spreadBps","turnoverAssumption"] as const) if (!nonNegativeFinite(cost[key])) errors.push(`COST_MODEL_${key.toUpperCase()}_INVALID`);
  }
  for (const key of ["createdAt","evaluationWindowStart","evaluationWindowEnd"] as const) if (typeof v[key] !== "string" || !Number.isFinite(Date.parse(v[key] as string))) errors.push(`${key.toUpperCase()}_INVALID`);
  if (typeof v.evaluationWindowStart === "string" && typeof v.evaluationWindowEnd === "string" && Number.isFinite(Date.parse(v.evaluationWindowStart)) && Number.isFinite(Date.parse(v.evaluationWindowEnd)) && Date.parse(v.evaluationWindowStart) >= Date.parse(v.evaluationWindowEnd)) errors.push("EVALUATION_WINDOW_INVALID");
  if (v.authority !== "PAPER_ONLY") errors.push("AUTHORITY_INVALID");
  return Object.freeze([...new Set(errors)]);
}

export function createResearchCandidateSpecification(input: Omit<ResearchCandidateSpecification,"schemaVersion"|"authority">): ResearchCandidateSpecification {
  const value: ResearchCandidateSpecification = Object.freeze({ schemaVersion: 1, ...input, costModel: Object.freeze({ ...input.costModel }), authority: "PAPER_ONLY" });
  const errors = validateResearchCandidateSpecification(value);
  if (errors.length) throw new Error(`RESEARCH_CANDIDATE_SPEC_INVALID:${errors.join(",")}`);
  return value;
}
