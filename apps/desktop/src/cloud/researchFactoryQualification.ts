import type { LeagueCandidateOutcome, LeagueRankedEntry } from "./nusaLeague";
import type { ResearchRunLeagueResult } from "./researchRunLeagueBridge";

export type ResearchFactoryOutcome = "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE";

export interface ResearchFactoryCandidateQualification {
  readonly candidateId: string;
  readonly outcome: ResearchFactoryOutcome;
  readonly reasons: readonly string[];
  readonly summary: string;
}

export interface ResearchFactoryQualificationResult {
  readonly schemaVersion: 1;
  readonly candidates: readonly ResearchFactoryCandidateQualification[];
  readonly coverage: Readonly<{
    readonly candidateCount: number;
    readonly qualifiedCount: number;
    readonly insufficientCount: number;
    readonly rejectedCount: number;
  }>;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const REQUIRED_REPORT_EVIDENCE = Object.freeze([
  "DEFLATED_SHARPE_EVIDENCE_MISSING",
  "COST_SENSITIVITY_EVIDENCE_MISSING",
  "PBO_EVIDENCE_MISSING",
  "REGIME_ROBUSTNESS_EVIDENCE_MISSING",
  "REGIME_ROBUSTNESS_EVIDENCE_INSUFFICIENT",
  "TRIAL_LEDGER_EVIDENCE_MISSING",
] as const);

const REJECTION_REASONS = Object.freeze(new Set([
  "DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD",
  "REGIME_FRAGILE_EDGE",
]));

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function validateRunProvenance(run: ResearchRunLeagueResult): void {
  const provenance = run.provenance;
  if (
    provenance == null
    || provenance.schemaVersion !== 1
    || !/^[0-9a-f]{40}$/i.test(provenance.sourceCommitSha)
    || !/^[0-9a-f]{64}$/i.test(provenance.runFingerprintSha256)
    || !provenance.dataset?.datasetId
    || !/^[0-9a-f]{64}$/i.test(provenance.dataset.contentSha256)
    || !Array.isArray(provenance.candidateBindings)
    || !provenance.benchmarkIdentity
    || provenance.benchmarkIdentity.kind !== "BUY_AND_HOLD"
    || !/^[0-9a-f]{64}$/i.test(provenance.benchmarkIdentity.evidenceSha256)
    || !provenance.evidenceIdentity
    || !/^[0-9a-f]{64}$/i.test(provenance.evidenceIdentity.dsrSha256)
    || !/^[0-9a-f]{64}$/i.test(provenance.evidenceIdentity.regimeSha256)
    || !/^[0-9a-f]{64}$/i.test(provenance.evidenceIdentity.oosObservationSha256)
  ) {
    throw new Error("research run provenance is missing or malformed");
  }
  if (!run.standing.provenance.sourceDatasetIds.includes(provenance.dataset.datasetId)) {
    throw new Error("research run provenance dataset does not match standing");
  }
  const bindings = new Map(provenance.candidateBindings.map((binding) => [binding.candidateId, binding] as const));
  if (
    bindings.size !== provenance.candidateBindings.length
    || bindings.size !== run.standing.entries.length
  ) {
    throw new Error("research run candidate provenance coverage mismatch");
  }
  for (const entry of run.standing.entries) {
    const binding = bindings.get(entry.id);
    if (
      binding == null
      || binding.familyId !== entry.familyId
      || !/^[0-9a-f]{64}$/i.test(binding.specificationHash)
      || !binding.datasetId
      || !/^[0-9a-f]{64}$/i.test(binding.datasetContentSha256)
      || !entry.sourceDatasetIds.includes(binding.datasetId)
    ) {
      throw new Error(`research run candidate provenance mismatch for ${entry.id}`);
    }
  }
}

function stableUnique(values: readonly string[]): readonly string[] {
  return freeze([...new Set(values)].sort());
}

function baselineReason(outcome: LeagueCandidateOutcome): string | undefined {
  if (outcome === "REJECTED") return "LEAGUE_BASELINE_REJECTED";
  if (outcome === "INSUFFICIENT") return "LEAGUE_BASELINE_INSUFFICIENT";
  return undefined;
}

function classify(
  entry: LeagueRankedEntry,
  missingEvidence: readonly string[],
  run: ResearchRunLeagueResult,
): ResearchFactoryCandidateQualification {
  const reasons: string[] = [];
  const baseline = baselineReason(entry.outcome);
  if (baseline != null) reasons.push(baseline);

  for (const reason of entry.reasons) {
    if (REJECTION_REASONS.has(reason)) reasons.push(reason);
  }

  const hardRejected = entry.outcome === "REJECTED" || reasons.some((reason) => REJECTION_REASONS.has(reason));
  if (!hardRejected) {
    if (entry.outcome === "INSUFFICIENT") reasons.push("INSUFFICIENT_OOS_BENCHMARK_EVIDENCE");
    if (run.hypothesis == null) reasons.push("PRECOMMITTED_HYPOTHESIS_REQUIRED");
    if (run.robustnessEvidence == null) reasons.push("PARAMETER_AND_COST_STRESS_EVIDENCE_REQUIRED");
    if (!run.reasons.includes("OOS_OBSERVATION_PROVENANCE_PRESENT")) reasons.push("OOS_OBSERVATION_PROVENANCE_REQUIRED");
    for (const required of REQUIRED_REPORT_EVIDENCE) {
      if (missingEvidence.includes(required)) reasons.push(required);
    }
  }

  const outcome: ResearchFactoryOutcome = hardRejected
    ? "REJECTED"
    : reasons.length > 0 ? "INSUFFICIENT" : "QUALIFIED_FOR_LEAGUE";
  const finalReasons = stableUnique(reasons);
  const summary = outcome === "QUALIFIED_FOR_LEAGUE"
    ? `Candidate ${entry.id} is qualified for League research eligibility from complete canonical evidence.`
    : outcome === "REJECTED"
      ? `Candidate ${entry.id} is rejected by canonical research evidence.`
      : `Candidate ${entry.id} remains insufficiently evidenced for League qualification.`;

  return freeze({
    candidateId: entry.id,
    outcome,
    reasons: finalReasons,
    summary,
  });
}

/**
 * Final fail-closed projection for the canonical Research Factory. It creates no new metric and
 * owns no backtest/ranking logic: it only requires the existing League/OOS/DSR/PBO/regime,
 * robustness, hypothesis and immutable trial-ledger evidence to be present before the stronger
 * QUALIFIED_FOR_LEAGUE label can be emitted.
 *
 * PAPER/SHADOW evidence remains downstream confirmation evidence and is deliberately not required
 * for initial League qualification. This result is research eligibility only and carries no
 * execution, capital, broker or LIVE authority.
 */
export function qualifyResearchFactoryRun(run: ResearchRunLeagueResult): ResearchFactoryQualificationResult {
  if (run.schemaVersion !== 1 || run.evidenceMode !== "RESEARCH_TIER_ONLY") {
    throw new Error("unsupported research run league result");
  }
  validateRunProvenance(run);
  const reports = new Map(run.evidenceReport.map((report) => [report.candidateId, report] as const));
  if (reports.size !== run.standing.entries.length || reports.size !== run.evidenceReport.length) {\n    throw new Error("research evidence report coverage mismatch");\n  }

  const candidates = run.standing.entries.map((entry) => {
    const report = reports.get(entry.id);
    if (report == null) throw new Error(`missing research evidence report for ${entry.id}`);
    if (report.outcome !== entry.outcome) throw new Error(`research evidence outcome mismatch for ${entry.id}`);
    return classify(entry, report.missingEvidence, run);
  });

  return freeze({
    schemaVersion: 1,
    candidates: freeze(candidates),
    coverage: freeze({
      candidateCount: candidates.length,
      qualifiedCount: candidates.filter((candidate) => candidate.outcome === "QUALIFIED_FOR_LEAGUE").length,
      insufficientCount: candidates.filter((candidate) => candidate.outcome === "INSUFFICIENT").length,
      rejectedCount: candidates.filter((candidate) => candidate.outcome === "REJECTED").length,
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
