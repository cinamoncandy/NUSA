import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../../packages/contracts/src/researchRuntime";
import { createResearchBenchmarkScorecard, type ResearchBenchmarkPolicy, type ResearchBenchmarkSlice } from "./researchBenchmarkScorecard";
import type { ResearchExperimentResult } from "./researchDataset";
import type { PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { DeflatedSharpeEvidence } from "./researchSearchAdjustedEvidence";
import type { RegimeAwareStrategyEvaluation } from "./regimeAwareStrategyEvaluation";
import type { RegimeHealthAssessment } from "./regimeHealth";
import type { AbstentionAssessment } from "./abstentionEngine";
import type { GhostExecutionResult } from "./ghostExecution";
import type { CounterfactualAssessment } from "./counterfactualEngine";
import type { ResearchTrialLedgerSummary } from "./researchTrialLedger";
import { runLeagueResearchPipeline } from "./leagueResearchPipeline";
import {
  buildLeagueCandidateEvidenceReport,
  evaluateLeague,
  type LeagueCandidateEvidenceReport,
  type LeagueCandidateInput,
  type LeaguePolicy,
  type LeagueStanding,
} from "./nusaLeague";
import type { LeagueCapitalAllocationAdvisory, LeagueCapitalAllocationPolicy } from "./leagueCapitalAllocation";
import { LeagueCapitalAllocationError } from "./leagueCapitalAllocation";
import { extractResearchRunOosObservations, ResearchRunOosObservationError, type OosObservationTrace } from "./researchRunOosObservationEvidence";
import { gatePaperForwardLeagueEvidence, type PaperForwardLeagueEvidenceDecision, type PaperForwardLeagueEvidenceSource } from "./paperForwardLeagueEvidence";
import {
  validateResearchCandidateSpecificationBinding,
  type ResearchCandidateSpecification,
} from "./researchCandidateSpecification";
import {
  validateResearchRunRobustnessEvidence,
  type ResearchRunRobustnessEvidence,
} from "./researchRunRobustnessEvidence";
import {
  validateResearchHypothesisBinding,
  type ResearchHypothesis,
} from "./researchHypothesis";

/**
 * Minimal adapter joining a real research run to the League pipeline.
 *
 * The canonical research execution path (scripts/research-real-market-run.js) already produces
 * exactly what the benchmark scorecard consumes -- a ResearchExperimentResult per candidate --
 * but stopped at printing raw out-of-sample numbers, so the League ranking and the capital
 * allocation advisory had no caller and could not influence anything.
 *
 * This owns no research logic of its own. It computes no metric, runs no backtest, and defines no
 * ranking: it maps each experiment onto the benchmark scorecard the League already requires, then
 * hands the result to the existing pipeline. It deliberately does not create a second research
 * engine alongside the one that exists.
 *
 * The familyId is supplied by the caller rather than derived here, because only the caller knows
 * whether two candidates are genuinely different strategies or two tunings of one. Labeling
 * tuned variants as separate families would defeat the allocation's family concentration cap,
 * which is the whole reason that cap exists.
 */
export interface ResearchRunCandidate {
  /** Stable candidate id. Must match the benchmark slice id the scorecard produces. */
  readonly id: string;
  /** Strategy family. Tuned variants of one strategy MUST share a familyId. */
  readonly familyId: string;
  readonly experiment: ResearchExperimentResult;
  /** Immutable provenance contract bound to this candidate's experiment and dataset. */
  readonly candidateSpecification: ResearchCandidateSpecification;
  /** Optional point-in-time multi-window regime evidence for this candidate's own experiment. */
  readonly regimeAwareEvaluation?: RegimeAwareStrategyEvaluation;
  /** Candidate-specific DSR produced from this search's cost-aware OOS returns. */
  readonly deflatedSharpe?: DeflatedSharpeEvidence;
  /** Current regime evidence produced by the canonical regime-health engine, when available. */
  readonly regime?: RegimeHealthAssessment;
  /** Existing abstention decision for this candidate, when the canonical engine produced one. */
  readonly abstention?: AbstentionAssessment;
  /** Existing ghost execution result; this bridge never creates one implicitly. */
  readonly ghostExecution?: GhostExecutionResult;
  /** Existing counterfactual assessment; this bridge never creates one implicitly. */
  readonly counterfactual?: CounterfactualAssessment;
  /** Existing immutable trial-ledger summary for the research attempt, when available. */
  readonly trialLedgerSummary?: ResearchTrialLedgerSummary;
  /**
   * Longitudinal PAPER evidence may enter League only through the VERIFIED provenance gate.
   * INSUFFICIENT evidence remains visible in bridge reasons but never populates paperPerformance.
   */
  readonly paperForwardEvidence?: PaperForwardLeagueEvidenceSource;
}

export interface ResearchRunLeagueResult {
  readonly schemaVersion: 1;
  readonly evidenceMode: "RESEARCH_TIER_ONLY";
  /** Immutable run-level identity binding every candidate and evidence projection together. */
  readonly provenance: ResearchRunProvenance;
  /** The League ranking. Always produced: a refused allocation does not invalidate the ranking. */
  readonly standing: LeagueStanding;
  /** Deterministic human-readable projection of the evidence already present in each entry. */
  readonly evidenceReport: readonly LeagueCandidateEvidenceReport[];
  /**
   * Run-level parameter-neighborhood and cost-stress evidence. This is intentionally kept
   * outside candidate evidence breadth because it describes the shared research run, not
   * independent evidence for any one candidate.
   */
  readonly robustnessEvidence?: ResearchRunRobustnessEvidence;
  /** The explicit market hypothesis that precommitted this research run, when available. */
  readonly hypothesis?: ResearchHypothesis;
  readonly allocation?: LeagueCapitalAllocationAdvisory;
  /** Why no allocation advisory could be produced, when that is the case. */
  readonly allocationUnavailableReason?: string;
  readonly reasons: readonly string[];
  /** Candle-level OOS observations preserved for downstream Ghost/Counterfactual adapters. */
  readonly oosObservationEvidence?: Readonly<Record<string, readonly OosObservationTrace[]>>;
}

export interface ResearchRunProvenance {
  readonly schemaVersion: 1;
  readonly runFingerprintSha256: string;
  readonly sourceCommitSha: string;
  readonly costModelVersion: string;
  readonly dataset: Readonly<{
    readonly datasetId: string;
    readonly contentSha256: string;
    readonly source: string;
    readonly market: string;
    readonly interval: string;
    readonly startOpenTime: number;
    readonly endCloseTime: number;
  }>;
  readonly hypothesisHash?: string;
  readonly candidateBindings: readonly Readonly<{
    readonly candidateId: string;
    readonly familyId: string;
    readonly lineageId: string;
    readonly specificationHash: string;
    readonly datasetId: string;
    readonly datasetContentSha256: string;
    readonly parameters: Readonly<Record<string, string | number | boolean>>;
  }>[];
  readonly benchmarkIdentity: Readonly<{
    readonly kind: "BUY_AND_HOLD";
    readonly evidenceSha256: string;
  }>;
  readonly evidenceIdentity: Readonly<{
    readonly pboSha256?: string;
    readonly dsrSha256: string;
    readonly robustnessSha256?: string;
    readonly regimeSha256: string;
    readonly oosObservationSha256: string;
  }>;
}

export class ResearchRunLeagueBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunLeagueBridgeError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
}

/**
 * Joins real research-run experiments to the existing League ranking and allocation advisory.
 * Research-advisory authority only: produces no order, broker call, capital amount, or LIVE
 * authority. PAPER evidence, when supplied, is accepted only after VERIFIED candidate/dataset/hash
 * admission and remains PAPER/SHADOW evidence inside the research ranking.
 */
export function buildResearchRunLeague(
  candidates: readonly ResearchRunCandidate[],
  options: {
    readonly benchmarkPolicy?: ResearchBenchmarkPolicy;
    readonly probabilityBacktestOverfitting?: PboCscvEvidence;
    readonly leaguePolicy?: LeaguePolicy;
    readonly allocationPolicy?: Partial<LeagueCapitalAllocationPolicy>;
    readonly generatedAt?: string;
    /** Already-verified run-level sensitivity/stress evidence; never used to grant authority. */
    readonly robustnessEvidence?: ResearchRunRobustnessEvidence;
    /** Explicit, read-only hypothesis provenance for this research run. */
    readonly hypothesis?: ResearchHypothesis;
  } = {},
): ResearchRunLeagueResult {
  if (candidates.length === 0) {
    throw new ResearchRunLeagueBridgeError("EMPTY_RESEARCH_RUN", "research run league requires at least one candidate");
  }
  const ids = new Set<string>();
  const specificationHashes = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim()) throw new ResearchRunLeagueBridgeError("INVALID_CANDIDATE_ID", "candidate id is required");
    if (!candidate.familyId.trim()) throw new ResearchRunLeagueBridgeError("INVALID_FAMILY_ID", `candidate ${candidate.id} requires a familyId`);
    if (ids.has(candidate.id)) throw new ResearchRunLeagueBridgeError("DUPLICATE_CANDIDATE_ID", `duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    const configuredCandidates = candidate.experiment.experimentConfig?.candidates;
    if (
      !Array.isArray(configuredCandidates)
      || configuredCandidates.length !== 1
      || configuredCandidates[0]?.id !== candidate.id
    ) {
      throw new ResearchRunLeagueBridgeError(
        "CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH",
        `candidate ${candidate.id} must own exactly one matching experiment candidate`,
      );
    }

    try {
      const specificationDecision = validateResearchCandidateSpecificationBinding(
        candidate.candidateSpecification,
        {
          candidateId: candidate.id,
          familyId: candidate.familyId,
          datasetId: candidate.experiment.manifest.datasetId,
          datasetContentSha256: candidate.experiment.manifest.contentSha256,
          parameters: configuredCandidates[0]?.parameters ?? {},
          evaluationGeneratedAt: candidate.experiment.generatedAt,
        },
      );
      if (specificationDecision.status !== "VERIFIED") {
        throw new ResearchRunLeagueBridgeError(
          "INVALID_CANDIDATE_SPECIFICATION",
          `candidate ${candidate.id} has invalid bound specification: ${specificationDecision.reasons.join(",")}`,
        );
      }
      specificationHashes.set(candidate.id, specificationDecision.specificationHash);
    } catch (error) {
      if (error instanceof ResearchRunLeagueBridgeError) throw error;
      throw new ResearchRunLeagueBridgeError(
        "INVALID_CANDIDATE_SPECIFICATION",
        `candidate ${candidate.id} has malformed bound specification`,
      );
    }
  }

  const firstSpecification = candidates[0]!.candidateSpecification;
  const sourceCommitSha = firstSpecification.codeSha.trim().toLowerCase();
  const costModelVersion = firstSpecification.costModelVersion.trim();
  for (const candidate of candidates.slice(1)) {
    if (candidate.candidateSpecification.codeSha.trim().toLowerCase() !== sourceCommitSha) {
      throw new ResearchRunLeagueBridgeError(
        "CANDIDATE_SOURCE_MISMATCH",
        "all research candidates must use one source commit",
      );
    }
    if (candidate.candidateSpecification.costModelVersion.trim() !== costModelVersion) {
      throw new ResearchRunLeagueBridgeError(
        "COST_MODEL_IDENTITY_MISMATCH",
        "all research candidates must use one cost model version",
      );
    }
  }

  if (options.robustnessEvidence != null) {
    try {
      validateResearchRunRobustnessEvidence(options.robustnessEvidence);
    } catch (error) {
      if (error instanceof ResearchRunLeagueBridgeError) throw error;
      const message = error instanceof Error ? error.message : "malformed robustness evidence";
      throw new ResearchRunLeagueBridgeError("INVALID_ROBUSTNESS_EVIDENCE", message);
    }
    const firstManifest = candidates[0]!.experiment.manifest;
    if (candidates.some((candidate) => (
      candidate.experiment.manifest.datasetId !== firstManifest.datasetId
      || candidate.experiment.manifest.contentSha256 !== firstManifest.contentSha256
    ))) {
      throw new ResearchRunLeagueBridgeError(
        "ROBUSTNESS_PROVENANCE_MISMATCH",
        "run-level robustness evidence requires one shared candidate dataset",
      );
    }
    if (
      options.robustnessEvidence.datasetId !== firstManifest.datasetId
      || options.robustnessEvidence.datasetContentSha256 !== firstManifest.contentSha256
    ) {
      throw new ResearchRunLeagueBridgeError(
        "ROBUSTNESS_PROVENANCE_MISMATCH",
        "run-level robustness evidence does not match candidate dataset provenance",
      );
    }
  }

  let hypothesisHash: string | undefined;
  if (options.hypothesis != null) {
    const firstManifest = candidates[0]!.experiment.manifest;
    const expectedEvaluationGeneratedAt = options.generatedAt ?? candidates[0]!.experiment.generatedAt;
    const decision = validateResearchHypothesisBinding(options.hypothesis, {
      hypothesisId: options.hypothesis.hypothesisId,
      familyId: candidates[0]!.familyId,
      market: firstManifest.market,
      interval: firstManifest.interval,
      sourceDatasetId: firstManifest.datasetId,
      evaluationGeneratedAt: expectedEvaluationGeneratedAt,
    });
    const candidateBindingMismatch = candidates.some((candidate) => (
      candidate.familyId !== options.hypothesis!.familyId
      || candidate.experiment.manifest.market !== options.hypothesis!.market
      || candidate.experiment.manifest.interval !== options.hypothesis!.interval
      || candidate.experiment.manifest.datasetId !== options.hypothesis!.sourceDatasetId
    ));
    if (decision.status !== "VERIFIED" || candidateBindingMismatch) {
      throw new ResearchRunLeagueBridgeError(
        "HYPOTHESIS_PROVENANCE_MISMATCH",
        decision.reasons.join(",") || "hypothesis does not bind to every candidate in the research run",
      );
    }
    hypothesisHash = decision.hypothesisHash;
  }

  const slices: readonly ResearchBenchmarkSlice[] = candidates.map((candidate) => ({
    id: candidate.id,
    experiment: candidate.experiment,
  }));
  const scorecard = createResearchBenchmarkScorecard(slices, options.benchmarkPolicy);

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const paperDecisions = new Map<string, PaperForwardLeagueEvidenceDecision>();
  const leagueCandidates: readonly LeagueCandidateInput[] = scorecard.slices.map((slice) => {
    const candidate = byId.get(slice.id)!;
    const paperDecision = candidate.paperForwardEvidence == null
      ? undefined
      : gatePaperForwardLeagueEvidence(
          {
            candidateId: candidate.id,
            datasetId: candidate.experiment.manifest.datasetId,
            datasetContentSha256: candidate.experiment.manifest.contentSha256,
          },
          candidate.paperForwardEvidence,
        );
    if (paperDecision != null) paperDecisions.set(candidate.id, paperDecision);
    return {
      id: slice.id,
      familyId: candidate.familyId,
      benchmark: slice,
      ...(candidate.deflatedSharpe == null ? {} : { deflatedSharpe: candidate.deflatedSharpe }),
      ...(candidate.regime == null ? {} : { regime: candidate.regime }),
      ...(candidate.regimeAwareEvaluation == null ? {} : { regimeAwareEvaluation: candidate.regimeAwareEvaluation }),
      ...(candidate.abstention == null ? {} : { abstention: candidate.abstention }),
      ...(candidate.ghostExecution == null ? {} : { ghostExecution: candidate.ghostExecution }),
      ...(candidate.counterfactual == null ? {} : { counterfactual: candidate.counterfactual }),
      ...(candidate.trialLedgerSummary == null ? {} : { trialLedgerSummary: candidate.trialLedgerSummary }),
      ...(paperDecision?.paperPerformance == null ? {} : { paperPerformance: paperDecision.paperPerformance }),
    };
  });

  const reasons: string[] = ["RESEARCH_TIER_ONLY", "NO_EXECUTION_AUTHORITY"];
  const paperDecisionValues = [...paperDecisions.values()];
  if (paperDecisionValues.some((decision) => decision.strength === "VERIFIED")) reasons.push("VERIFIED_PAPER_FORWARD_EVIDENCE_PRESENT");
  else reasons.push("NOT_PAPER_EVIDENCE");
  if (paperDecisionValues.some((decision) => decision.strength === "INSUFFICIENT")) reasons.push("PAPER_FORWARD_EVIDENCE_INSUFFICIENT");

  const oosObservationEvidence: Record<string, readonly OosObservationTrace[]> = {};
  for (const candidate of candidates) {
    try {
      oosObservationEvidence[candidate.id] = extractResearchRunOosObservations(candidate.id, candidate.experiment);
    } catch (error) {
      if (error instanceof ResearchRunOosObservationError && (
        error.code === "MISSING_OOS_OBSERVATION_SOURCE" ||
        error.code === "INSUFFICIENT_OBSERVATION_EVIDENCE"
      )) {
        reasons.push("INSUFFICIENT_OBSERVATION_EVIDENCE");
        continue;
      }
      if (error instanceof ResearchRunOosObservationError) {
        throw new ResearchRunLeagueBridgeError(
          "INVALID_OOS_OBSERVATION_EVIDENCE",
          `candidate ${candidate.id} contains invalid OOS evidence`,
        );
      }
      throw error;
    }
  }
  if (Object.keys(oosObservationEvidence).length === candidates.length) reasons.push("OOS_OBSERVATION_PROVENANCE_PRESENT");
  if (new Set(candidates.map((candidate) => candidate.familyId)).size <= 1) reasons.push("SINGLE_FAMILY_RESEARCH_RUN");
  if (candidates.every((candidate) => candidate.regimeAwareEvaluation != null)) reasons.push("POINT_IN_TIME_REGIME_EVIDENCE_PRESENT");
  if (options.probabilityBacktestOverfitting != null) reasons.push("SEARCH_OVERFITTING_EVIDENCE_PRESENT");
  if (options.robustnessEvidence != null) {
    reasons.push("PARAMETER_ROBUSTNESS_EVIDENCE_PRESENT", "COST_STRESS_EVIDENCE_PRESENT");
  }
  if (options.hypothesis != null) reasons.push("PRECOMMITTED_HYPOTHESIS_PRESENT");

  const pipelineInput = {
    candidates: leagueCandidates,
    ...(options.probabilityBacktestOverfitting == null
      ? {}
      : { probabilityBacktestOverfitting: options.probabilityBacktestOverfitting }),
    ...(options.leaguePolicy == null ? {} : { leaguePolicy: options.leaguePolicy }),
    ...(options.allocationPolicy == null ? {} : { allocationPolicy: options.allocationPolicy }),
    ...(options.generatedAt == null ? {} : { generatedAt: options.generatedAt }),
  };

  let standing: LeagueStanding;
  let allocation: LeagueCapitalAllocationAdvisory | undefined;
  let allocationUnavailableReason: string | undefined;
  try {
    const pipeline = runLeagueResearchPipeline(pipelineInput);
    standing = pipeline.standing;
    allocation = pipeline.allocation;
  } catch (error) {
    // A refused allocation is a real research finding -- typically that the run's candidates do
    // not yet carry enough independent evidence to justify allocating across them at all. It is
    // not a reason to discard the ranking, and never a reason to invent an allocation.
    if (!(error instanceof LeagueCapitalAllocationError)) throw error;
    standing = evaluateLeague(leagueCandidates, {
      ...(options.probabilityBacktestOverfitting == null
        ? {}
        : { probabilityBacktestOverfitting: options.probabilityBacktestOverfitting }),
      ...(options.leaguePolicy == null ? {} : { policy: options.leaguePolicy }),
      ...(options.generatedAt == null ? {} : { generatedAt: options.generatedAt }),
    });
    allocationUnavailableReason = error.code;
    reasons.push("NO_ALLOCATION_ADVISORY_AVAILABLE");
  }

  const evidenceReport = freeze(standing.entries.map((entry) => buildLeagueCandidateEvidenceReport(entry, {
    pboAvailable: options.probabilityBacktestOverfitting != null,
  })));

  const canonicalManifest = candidates
    .map((candidate) => candidate.experiment.manifest)
    .sort((left, right) => (
      left.datasetId.localeCompare(right.datasetId)
      || left.contentSha256.localeCompare(right.contentSha256)
    ))[0]!;
  const canonicalDataset = freeze({
    datasetId: canonicalManifest.datasetId,
    contentSha256: canonicalManifest.contentSha256,
    source: canonicalManifest.source,
    market: canonicalManifest.market,
    interval: canonicalManifest.interval,
    startOpenTime: canonicalManifest.startOpenTime,
    endCloseTime: canonicalManifest.endCloseTime,
  });
  const candidateBindings = freeze(candidates.map((candidate) => freeze({
    candidateId: candidate.id,
    familyId: candidate.familyId,
    lineageId: candidate.candidateSpecification.lineageId,
    specificationHash: specificationHashes.get(candidate.id)!,
    datasetId: candidate.experiment.manifest.datasetId,
    datasetContentSha256: candidate.experiment.manifest.contentSha256,
    parameters: freeze({ ...candidate.candidateSpecification.parameters }),
  })).sort((left, right) => left.candidateId.localeCompare(right.candidateId)));
  const benchmarkIdentity = freeze({
    kind: "BUY_AND_HOLD" as const,
    evidenceSha256: hashCanonical(scorecard.slices),
  });
  const evidenceIdentity = freeze({
    ...(options.probabilityBacktestOverfitting == null
      ? {}
      : { pboSha256: hashCanonical(options.probabilityBacktestOverfitting) }),
    dsrSha256: hashCanonical(candidates.map((candidate) => ({
      candidateId: candidate.id,
      deflatedSharpe: candidate.deflatedSharpe ?? null,
      trialLedgerSummary: candidate.trialLedgerSummary ?? null,
    })).sort((left, right) => left.candidateId.localeCompare(right.candidateId))),
    ...(options.robustnessEvidence == null
      ? {}
      : { robustnessSha256: hashCanonical(options.robustnessEvidence) }),
    regimeSha256: hashCanonical(candidates.map((candidate) => ({
      candidateId: candidate.id,
      regime: candidate.regime ?? null,
      regimeAwareEvaluation: candidate.regimeAwareEvaluation ?? null,
    })).sort((left, right) => left.candidateId.localeCompare(right.candidateId))),
    oosObservationSha256: hashCanonical(oosObservationEvidence),
  });
  const provenancePayload = {
    schemaVersion: 1 as const,
    sourceCommitSha,
    costModelVersion,
    dataset: canonicalDataset,
    ...(hypothesisHash == null ? {} : { hypothesisHash }),
    candidateBindings,
    benchmarkIdentity,
    evidenceIdentity,
  };
  const runFingerprintSha256 = hashCanonical({
    provenance: provenancePayload,
    standing,
    evidenceReport,
    allocation: allocation ?? null,
    allocationUnavailableReason: allocationUnavailableReason ?? null,
  });
  const provenance = freeze({ ...provenancePayload, runFingerprintSha256 });

  return freeze({
    schemaVersion: 1,
    evidenceMode: "RESEARCH_TIER_ONLY",
    provenance,
    standing,
    evidenceReport,
    ...(options.robustnessEvidence == null ? {} : { robustnessEvidence: options.robustnessEvidence }),
    ...(options.hypothesis == null ? {} : { hypothesis: options.hypothesis }),
    ...(allocation == null ? {} : { allocation }),
    ...(allocationUnavailableReason == null ? {} : { allocationUnavailableReason }),
    ...(Object.keys(oosObservationEvidence).length === 0 ? {} : { oosObservationEvidence: freeze(oosObservationEvidence) }),
    reasons: freeze([...new Set(reasons)].sort()),
  });
}
