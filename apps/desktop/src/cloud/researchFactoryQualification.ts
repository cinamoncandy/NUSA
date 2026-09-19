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

type GateState = "PASS" | "FAIL" | "UNKNOWN";
interface GateDecision {
  readonly state: GateState;
  readonly reasons: readonly string[];
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

const REQUIRED_COST_SCENARIOS = Object.freeze(["BASE", "MODERATE", "SEVERE"] as const);
const FROZEN_COST_RETURN_DEGRADATION_RATIO = 0.5;
const FROZEN_COST_DRAWDOWN_EXPANSION_RATIO = 0.5;
const FROZEN_COST_MINIMUM_CLOSED_TRADES = 2;
const FROZEN_MAXIMUM_PBO = 0.5;

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function stableUnique(values: readonly string[]): readonly string[] {
  return freeze([...new Set(values)].sort());
}

function gate(state: GateState, reasons: readonly string[] = []): GateDecision {
  return freeze({ state, reasons: stableUnique(reasons) });
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
}

function canonicalParameters(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function validateRunProvenance(run: ResearchRunLeagueResult): void {
  const provenance = run.provenance;
  if (
    provenance == null
    || provenance.schemaVersion !== 1
    || !/^[0-9a-f]{40}$/i.test(provenance.sourceCommitSha)
    || !/^[0-9a-f]{64}$/i.test(provenance.runFingerprintSha256)
    || !provenance.dataset?.datasetId
    || !/^[0-9a-f]{64}$/i.test(provenance.dataset.contentSha256)
    || !provenance.dataset.market
    || !provenance.dataset.interval
    || !Number.isInteger(provenance.dataset.candleCount)
    || provenance.dataset.candleCount <= 0
    || !Number.isFinite(provenance.dataset.startOpenTime)
    || !Number.isFinite(provenance.dataset.endCloseTime)
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
  if (run.robustnessEvidence != null && !/^[0-9a-f]{64}$/i.test(provenance.evidenceIdentity.robustnessSha256 ?? "")) {
    throw new Error("research run robustness identity is missing or malformed");
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
      || binding.datasetId !== provenance.dataset.datasetId
      || binding.datasetContentSha256.toLowerCase() !== provenance.dataset.contentSha256.toLowerCase()
      || !entry.sourceDatasetIds.includes(binding.datasetId)
    ) {
      throw new Error(`research run candidate provenance mismatch for ${entry.id}`);
    }
  }
}

function baselineReason(outcome: LeagueCandidateOutcome): string | undefined {
  if (outcome === "REJECTED") return "LEAGUE_BASELINE_REJECTED";
  if (outcome === "INSUFFICIENT") return "LEAGUE_BASELINE_INSUFFICIENT";
  return undefined;
}

function pboGate(run: ResearchRunLeagueResult): GateDecision {
  const pbo = run.standing.probabilityBacktestOverfitting;
  const identity = run.provenance.searchOverfittingIdentity;
  const pboSha256 = run.provenance.evidenceIdentity.pboSha256;
  if (
    pbo == null
    || !Number.isFinite(pbo)
    || pbo < 0
    || pbo > 1
    || identity == null
    || !/^[0-9a-f]{64}$/i.test(pboSha256 ?? "")
    || !run.reasons.includes("SEARCH_OVERFITTING_EVIDENCE_PRESENT")
  ) {
    return gate("UNKNOWN", ["PBO_SURVIVAL_EVIDENCE_REQUIRED"]);
  }
  if (
    !Array.isArray(identity.candidateIds)
    || !Array.isArray(identity.familyIds)
    || !Array.isArray(identity.candidateSpecificationHashes)
  ) {
    return gate("UNKNOWN", ["PBO_PROVENANCE_MISMATCH"]);
  }
  const bindings = run.provenance.candidateBindings;
  const expectedCandidateIds = bindings.map((binding) => binding.candidateId);
  const expectedFamilyIds = [...new Set(bindings.map((binding) => binding.familyId))];
  const expectedSpecificationHashes = bindings.map((binding) => binding.specificationHash);
  if (
    identity.evidenceSha256 !== pboSha256
    || identity.probabilityBacktestOverfitting !== pbo
    || identity.datasetId !== run.provenance.dataset.datasetId
    || identity.datasetContentSha256.toLowerCase() !== run.provenance.dataset.contentSha256.toLowerCase()
    || identity.market !== run.provenance.dataset.market
    || identity.interval !== run.provenance.dataset.interval
    || identity.candleCount !== run.provenance.dataset.candleCount
    || identity.startOpenTime !== run.provenance.dataset.startOpenTime
    || identity.endCloseTime !== run.provenance.dataset.endCloseTime
    || !/^[0-9a-f]{64}$/i.test(identity.candidateConfigurationSha256)
    || !/^[0-9a-f]{64}$/i.test(identity.evaluationSha256)
    || !/^[0-9a-f]{64}$/i.test(identity.oosTimestampSha256)
    || !/^[0-9a-f]{64}$/i.test(identity.oosReturnMatrixSha256)
    || !sameStrings(identity.candidateIds, expectedCandidateIds)
    || !sameStrings(identity.familyIds, expectedFamilyIds)
    || !sameStrings(identity.candidateSpecificationHashes, expectedSpecificationHashes)
  ) {
    return gate("UNKNOWN", ["PBO_PROVENANCE_MISMATCH"]);
  }
  return pbo <= FROZEN_MAXIMUM_PBO
    ? gate("PASS")
    : gate("FAIL", ["PBO_EXCEEDS_FROZEN_THRESHOLD"]);
}

function costLoad(scenario: {
  readonly feeRate: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
}): number {
  return scenario.feeRate * 10_000 + scenario.spreadBps + scenario.slippageBps;
}

function sameMetric(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}

function costGate(entry: LeagueRankedEntry, run: ResearchRunLeagueResult): GateDecision {
  const evidence = run.robustnessEvidence;
  if (evidence == null) return gate("UNKNOWN", ["COST_STRESS_CANDIDATE_BINDING_REQUIRED"]);
  if (
    evidence.datasetId !== run.provenance.dataset.datasetId
    || evidence.datasetContentSha256.toLowerCase() !== run.provenance.dataset.contentSha256.toLowerCase()
    || evidence.parameterRobustness.provenance.sourceCommitSha.toLowerCase() !== run.provenance.sourceCommitSha.toLowerCase()
    || evidence.parameterRobustness.provenance.costModelVersion !== run.provenance.costModelVersion
  ) {
    return gate("UNKNOWN", ["COST_STRESS_PROVENANCE_MISMATCH"]);
  }
  if (!Array.isArray(evidence.candidateCostStress as unknown)) {
    return gate("UNKNOWN", ["COST_STRESS_CANDIDATE_BINDING_REQUIRED"]);
  }
  const binding = run.provenance.candidateBindings.find((candidate) => candidate.candidateId === entry.id);
  const matches = evidence.candidateCostStress.filter((candidate) => candidate.candidateId === entry.id);
  if (binding == null || matches.length !== 1) {
    return gate("UNKNOWN", ["COST_STRESS_CANDIDATE_BINDING_REQUIRED"]);
  }
  const candidate = matches[0]!;
  if (
    candidate.familyId !== entry.familyId
    || candidate.specificationHash !== binding.specificationHash
    || candidate.costStress.identity.datasetSha256.toLowerCase() !== run.provenance.dataset.contentSha256.toLowerCase()
  ) {
    return gate("UNKNOWN", ["COST_STRESS_PROVENANCE_MISMATCH"]);
  }
  if (candidate.costStress.identity.selectionMode !== "FIX_BASELINE_SELECTION") {
    return gate("UNKNOWN", ["COST_STRESS_FIXED_SELECTION_REQUIRED"]);
  }
  if (
    candidate.costStress.baselineScenarioId !== "BASE"
    || !sameStrings(candidate.costStress.scenarioIds, REQUIRED_COST_SCENARIOS)
    || candidate.costStress.scenarios.length !== REQUIRED_COST_SCENARIOS.length
  ) {
    return gate("UNKNOWN", ["COST_STRESS_PRECOMMITTED_GRID_REQUIRED"]);
  }
  const scenarios = candidate.costStress.scenarios;
  if (scenarios.some((scenario) => scenario.selectionMode !== "FIX_BASELINE_SELECTION")) {
    return gate("UNKNOWN", ["COST_STRESS_FIXED_SELECTION_REQUIRED"]);
  }
  if (scenarios.some((scenario) => scenario.totalOosClosedTrades < FROZEN_COST_MINIMUM_CLOSED_TRADES)) {
    return gate("UNKNOWN", ["INSUFFICIENT_CLOSED_TRADES"]);
  }
  const baseline = scenarios.find((scenario) => scenario.scenario.id === "BASE");
  if (baseline == null) return gate("UNKNOWN", ["COST_STRESS_PRECOMMITTED_GRID_REQUIRED"]);
  if (
    !sameMetric(baseline.markedTotalReturn, entry.components.outOfSamplePerformance)
    || !sameMetric(baseline.markedMaximumDrawdown, entry.components.maximumDrawdown)
    || !sameMetric(baseline.benchmarkOutperformance, entry.components.benchmarkExcess)
  ) {
    return gate("UNKNOWN", ["COST_STRESS_BASELINE_BINDING_MISMATCH"]);
  }
  if (scenarios.some((scenario) => scenario.closedTradeExpectancy == null || !Number.isFinite(scenario.closedTradeExpectancy))) {
    return gate("UNKNOWN", ["COST_STRESS_EXPECTANCY_EVIDENCE_MISSING"]);
  }
  const baselineCostLoad = costLoad(baseline.scenario);
  const highCost = scenarios.filter((scenario) => costLoad(scenario.scenario) >= baselineCostLoad * 2);
  const failures: string[] = [];
  if (
    baseline.markedTotalReturn > 0
    && highCost.some((scenario) => (
      (baseline.markedTotalReturn - scenario.markedTotalReturn) / baseline.markedTotalReturn
      >= FROZEN_COST_RETURN_DEGRADATION_RATIO
    ))
  ) failures.push("RETURN_COLLAPSE");
  if (scenarios.some((scenario) => (scenario.closedTradeExpectancy ?? 0) < 0)) {
    failures.push("EXPECTANCY_TURNS_NEGATIVE");
  }
  if (scenarios.some((scenario) => scenario.closedTradeProfitFactor != null && scenario.closedTradeProfitFactor < 1)) {
    failures.push("PROFIT_FACTOR_BELOW_ONE");
  }
  if (scenarios.some((scenario) => scenario.benchmarkOutperformance < 0)) {
    failures.push("BENCHMARK_EDGE_LOST");
  }
  if (
    baseline.markedMaximumDrawdown > 0
    && highCost.some((scenario) => (
      (scenario.markedMaximumDrawdown - baseline.markedMaximumDrawdown) / baseline.markedMaximumDrawdown
      >= FROZEN_COST_DRAWDOWN_EXPANSION_RATIO
    ))
  ) failures.push("DRAWDOWN_EXPANDS");
  return failures.length > 0 ? gate("FAIL", failures) : gate("PASS");
}

function parameterGate(entry: LeagueRankedEntry, run: ResearchRunLeagueResult): GateDecision {
  const evidence = run.robustnessEvidence;
  if (evidence == null) return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_CANDIDATE_BINDING_REQUIRED"]);
  const binding = run.provenance.candidateBindings.find((candidate) => candidate.candidateId === entry.id);
  if (
    binding == null
    || evidence.datasetId !== binding.datasetId
    || evidence.datasetContentSha256.toLowerCase() !== binding.datasetContentSha256.toLowerCase()
    || evidence.parameterRobustness.provenance.sourceCommitSha.toLowerCase() !== run.provenance.sourceCommitSha.toLowerCase()
    || evidence.parameterRobustness.provenance.costModelVersion !== run.provenance.costModelVersion
  ) {
    return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_PROVENANCE_MISMATCH"]);
  }
  if (!Array.isArray(evidence.parameterRobustness.references)) {
    return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_CANDIDATE_BINDING_REQUIRED"]);
  }
  const references = evidence.parameterRobustness.references.filter((reference) => (
    reference.candidateKey === entry.id && reference.familyId === entry.familyId
  ));
  if (references.length !== 1) {
    return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_CANDIDATE_BINDING_REQUIRED"]);
  }
  const reference = references[0]!;
  if (
    reference.parameters == null
    || canonicalParameters(reference.parameters) !== canonicalParameters(binding.parameters)
  ) {
    return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_PROVENANCE_MISMATCH"]);
  }
  if (
    !Number.isInteger(reference.immediateNeighborCount)
    || (reference.immediateNeighborCount ?? 0) < 1
    || !Number.isFinite(reference.referenceReturn)
    || !Number.isFinite(reference.immediateNeighborPositiveRatio)
    || !Number.isFinite(reference.immediateNeighborBenchmarkOutperformRatio)
    || !Number.isFinite(reference.allCandidatePositiveRatio)
    || !Number.isFinite(reference.signReversalRatio)
  ) {
    return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_NEIGHBOR_EVIDENCE_INSUFFICIENT"]);
  }
  const expectedAssessment = (reference.signReversalRatio ?? 0) >= 0.5
    ? "UNSTABLE"
    : (reference.referenceReturn ?? 0) <= 0
      ? "FLAT_WEAK"
      : (reference.immediateNeighborPositiveRatio ?? 0) >= 0.75
          && (reference.immediateNeighborBenchmarkOutperformRatio ?? 0) >= 0.5
        ? "BROAD_PLATEAU"
        : (reference.immediateNeighborPositiveRatio ?? 0) >= 0.5
          ? "NARROW_PLATEAU"
          : "ISOLATED_PEAK";
  if (reference.assessment !== expectedAssessment) {
    return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_ASSESSMENT_MISMATCH"]);
  }
  if (reference.assessment === "BROAD_PLATEAU" || reference.assessment === "NARROW_PLATEAU") {
    return gate("PASS");
  }
  if (["ISOLATED_PEAK", "FLAT_WEAK", "UNSTABLE"].includes(reference.assessment)) {
    return gate("FAIL", [`PARAMETER_ROBUSTNESS_${reference.assessment}`]);
  }
  return gate("UNKNOWN", ["PARAMETER_ROBUSTNESS_ASSESSMENT_UNKNOWN"]);
}

function economicEdgeGate(entry: LeagueRankedEntry): GateDecision {
  const totalReturn = entry.components.outOfSamplePerformance;
  const benchmarkExcess = entry.components.benchmarkExcess;
  if (!Number.isFinite(totalReturn) || !Number.isFinite(benchmarkExcess)) {
    return gate("UNKNOWN", ["ECONOMIC_EDGE_EVIDENCE_INVALID"]);
  }
  const failures: string[] = [];
  if (totalReturn <= 0) failures.push("NON_POSITIVE_AFTER_COST_OOS_RETURN");
  if (benchmarkExcess <= 0) failures.push("NON_POSITIVE_BUY_AND_HOLD_OUTPERFORMANCE");
  if (entry.reasons.includes("BENCHMARK_OUTPERFORMANCE_RATIO_NOT_MET")) {
    failures.push("BENCHMARK_OUTPERFORMANCE_RATIO_NOT_MET");
  }
  return failures.length > 0 ? gate("FAIL", failures) : gate("PASS");
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

  const mandatoryGates = [
    pboGate(run),
    costGate(entry, run),
    parameterGate(entry, run),
    economicEdgeGate(entry),
  ];
  const gateFailures = mandatoryGates.filter((decision) => decision.state === "FAIL");
  const gateUnknowns = mandatoryGates.filter((decision) => decision.state === "UNKNOWN");
  for (const decision of gateFailures) reasons.push(...decision.reasons);

  const hardRejected = entry.outcome === "REJECTED"
    || reasons.some((reason) => REJECTION_REASONS.has(reason))
    || gateFailures.length > 0;

  if (!hardRejected) {
    for (const decision of gateUnknowns) reasons.push(...decision.reasons);
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
 * Final fail-closed projection for the canonical Research Factory. It owns no backtest or score:
 * mandatory PBO, candidate-bound cost survival, candidate-local parameter robustness and positive
 * economic edge are non-compensatory gates over already-produced canonical evidence.
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
  if (reports.size !== run.standing.entries.length || reports.size !== run.evidenceReport.length) {
    throw new Error("research evidence report coverage mismatch");
  }

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
