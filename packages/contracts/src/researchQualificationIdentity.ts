import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

/** Existing finalizer-v1 metadata. Classification remains owned by Research Factory. */
export const RESEARCH_FACTORY_QUALIFICATION_POLICY = Object.freeze({
  schemaVersion: 1,
  id: "research-factory-qualification-v1" as const,
  ruleVersion: 1,
  maximumPbo: 0.5,
  costReturnDegradationRatio: 0.5,
  costDrawdownExpansionRatio: 0.5,
  costMinimumClosedTrades: 2,
  requiredCostScenarios: Object.freeze(["BASE", "MODERATE", "SEVERE"] as const),
  requiredReportEvidence: Object.freeze([
    "DEFLATED_SHARPE_EVIDENCE_MISSING", "COST_SENSITIVITY_EVIDENCE_MISSING",
    "PBO_EVIDENCE_MISSING", "REGIME_ROBUSTNESS_EVIDENCE_MISSING",
    "REGIME_ROBUSTNESS_EVIDENCE_INSUFFICIENT", "TRIAL_LEDGER_EVIDENCE_MISSING",
  ] as const),
  rejectionReasons: Object.freeze(["DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD", "REGIME_FRAGILE_EDGE"]),
});

export interface ResearchQualificationIdentity {
  readonly schemaVersion: 1;
  readonly policyId: "research-factory-qualification-v1";
  readonly policySha256: string;
  readonly runFingerprintSha256: string;
  readonly resultSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");

/** Consistency only: not authenticity, precommit chronology, or promotion authority. */
export function createResearchQualificationIdentity(runFingerprintSha256: string, result: unknown): ResearchQualificationIdentity {
  if (!SHA256.test(runFingerprintSha256)) throw new Error("research qualification identity run fingerprint is invalid");
  const identity = {
    policyId: RESEARCH_FACTORY_QUALIFICATION_POLICY.id,
    policySha256: hash(RESEARCH_FACTORY_QUALIFICATION_POLICY),
    runFingerprintSha256,
  };
  return Object.freeze({ schemaVersion: 1, ...identity, resultSha256: hash({ ...identity, result }) });
}

export function verifyResearchQualificationIdentity(value: unknown, runFingerprintSha256: string, result: unknown): ResearchQualificationIdentity {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("research qualification identity is missing or malformed");
  const expected = createResearchQualificationIdentity(runFingerprintSha256, result);
  if (canonicalResearchJson(value) !== canonicalResearchJson(expected)) throw new Error("research qualification identity checksum mismatch");
  return expected;
}

export function bindResearchQualificationIdentity<const T extends object>(runFingerprintSha256: string, result: T): Readonly<T & { validationIdentity: ResearchQualificationIdentity }> {
  return Object.freeze({ ...result, validationIdentity: createResearchQualificationIdentity(runFingerprintSha256, result) });
}
