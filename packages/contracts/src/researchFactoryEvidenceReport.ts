import type { ResearchFactoryDecision, ResearchFactoryEvidence } from "./researchFactoryOutcome";

export interface ResearchFactoryEvidenceReport {
  readonly candidateId: string;
  readonly evaluationId: string;
  readonly outcome: ResearchFactoryDecision["outcome"];
  readonly summary: string;
  readonly failedEvidence: readonly (keyof ResearchFactoryEvidence)[];
  readonly missingEvidence: readonly (keyof ResearchFactoryEvidence)[];
  readonly counterEvidence: readonly string[];
  readonly regimeGaps: readonly string[];
  readonly overfitRisks: readonly string[];
  readonly costSensitivity: readonly string[];
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const EVIDENCE_KEYS = [
  "provenanceIntegrity",
  "costEvidence",
  "outOfSampleEvidence",
  "multipleTestingControl",
  "regimeRobustness",
  "sensitivityAndStress",
  "denominatorIntegrity",
  "replayDeterminism",
] as const satisfies readonly (keyof ResearchFactoryEvidence)[];

export function buildResearchFactoryEvidenceReport(
  decision: ResearchFactoryDecision,
  evidence: ResearchFactoryEvidence,
): ResearchFactoryEvidenceReport {
  const failedEvidence = EVIDENCE_KEYS.filter((key) => evidence[key] === "FAIL");
  const missingEvidence = EVIDENCE_KEYS.filter((key) => evidence[key] === "UNKNOWN");
  const counterEvidence = failedEvidence.map((key) => `FAILED:${key}`);
  const regimeGaps = evidence.regimeRobustness === "PASS" ? [] : [evidence.regimeRobustness === "FAIL" ? "REGIME_ROBUSTNESS_FAILED" : "REGIME_ROBUSTNESS_MISSING"];
  const overfitRisks = [
    ...(evidence.multipleTestingControl === "PASS" ? [] : [evidence.multipleTestingControl === "FAIL" ? "MULTIPLE_TESTING_CONTROL_FAILED" : "MULTIPLE_TESTING_CONTROL_MISSING"]),
    ...(evidence.outOfSampleEvidence === "PASS" ? [] : [evidence.outOfSampleEvidence === "FAIL" ? "OOS_EVIDENCE_FAILED" : "OOS_EVIDENCE_MISSING"]),
    ...(evidence.denominatorIntegrity === "PASS" ? [] : [evidence.denominatorIntegrity === "FAIL" ? "DENOMINATOR_INTEGRITY_FAILED" : "DENOMINATOR_INTEGRITY_MISSING"]),
  ];
  const costSensitivity = evidence.costEvidence === "PASS" && evidence.sensitivityAndStress === "PASS"
    ? ["EXPLICIT_COST_AND_STRESS_EVIDENCE_PASSED"]
    : [
        ...(evidence.costEvidence === "PASS" ? [] : [evidence.costEvidence === "FAIL" ? "COST_EVIDENCE_FAILED" : "COST_EVIDENCE_MISSING"]),
        ...(evidence.sensitivityAndStress === "PASS" ? [] : [evidence.sensitivityAndStress === "FAIL" ? "SENSITIVITY_STRESS_FAILED" : "SENSITIVITY_STRESS_MISSING"]),
      ];
  const summary = decision.outcome === "QUALIFIED_FOR_LEAGUE"
    ? "All required Research Factory evidence passed; candidate is eligible for League/PAPER evaluation only."
    : decision.outcome === "REJECTED"
      ? `Candidate rejected because required evidence failed: ${failedEvidence.join(", ")}.`
      : `Candidate remains insufficient because required evidence is missing: ${missingEvidence.join(", ")}.`;
  return Object.freeze({
    candidateId: decision.candidateId,
    evaluationId: decision.evaluationId,
    outcome: decision.outcome,
    summary,
    failedEvidence: Object.freeze(failedEvidence),
    missingEvidence: Object.freeze(missingEvidence),
    counterEvidence: Object.freeze(counterEvidence),
    regimeGaps: Object.freeze(regimeGaps),
    overfitRisks: Object.freeze(overfitRisks),
    costSensitivity: Object.freeze(costSensitivity),
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
