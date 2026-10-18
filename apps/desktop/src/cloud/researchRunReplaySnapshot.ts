import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../../packages/contracts/src/researchRuntime";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import { qualifyResearchFactoryRun, type ResearchFactoryQualificationResult } from "./researchFactoryQualification";
import {
  buildResearchRunLeague,
  type ResearchRunCandidate,
  type ResearchRunLeagueResult,
  type ResearchRunProvenance,
} from "./researchRunLeagueBridge";
import type { PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { ResearchBenchmarkPolicy } from "./researchBenchmarkScorecard";
import type { LeaguePolicy } from "./nusaLeague";
import type { LeagueCapitalAllocationPolicy } from "./leagueCapitalAllocation";
import type { ResearchRunRobustnessEvidence } from "./researchRunRobustnessEvidence";
import type { ResearchHypothesis } from "./researchHypothesis";
import type { PaperForwardEvidenceAdmission } from "./paperForwardEvidenceAdmission";

export interface ResearchRunReplayOptions {
  readonly benchmarkPolicy?: ResearchBenchmarkPolicy;
  readonly probabilityBacktestOverfitting?: PboCscvEvidence;
  readonly leaguePolicy?: LeaguePolicy;
  readonly allocationPolicy?: Partial<LeagueCapitalAllocationPolicy>;
  readonly generatedAt?: string;
  readonly robustnessEvidence?: ResearchRunRobustnessEvidence;
  readonly hypothesis?: ResearchHypothesis;
  /**
   * Durable execution identity copied from the canonical original run. Legacy snapshots may omit
   * it, but callers cannot invent or replace it: createResearchRunReplaySnapshot derives the value
   * from originalRun.provenance so replay preserves the precommit/execution identity edge.
   */
  readonly boundExecution?: ResearchRunProvenance["boundExecution"];
}

export interface ResearchRunReplaySnapshotPayload {
  readonly schemaVersion: 1;
  readonly sourceCommitSha: string;
  readonly originalRunFingerprintSha256: string;
  readonly candidates: readonly ResearchRunCandidate[];
  readonly options: ResearchRunReplayOptions;
}

export interface ResearchRunReplaySnapshot extends ResearchRunReplaySnapshotPayload {
  readonly snapshotSha256: string;
}

export interface ResearchRunPaperReplayEvidence {
  readonly admission: PaperForwardEvidenceAdmission;
  readonly paperPerformance: PaperPerformanceSummary;
}

export interface ResearchRunReplayResult {
  readonly run: ResearchRunLeagueResult;
  readonly qualification: ResearchFactoryQualificationResult;
}

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");

function validatePayload(payload: ResearchRunReplaySnapshotPayload): void {
  if (payload.schemaVersion !== 1 || !SHA40.test(payload.sourceCommitSha) || !SHA64.test(payload.originalRunFingerprintSha256)) {
    throw new Error("research replay snapshot identity is invalid");
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) throw new Error("research replay snapshot requires candidates");
  const ids = new Set<string>();
  for (const candidate of payload.candidates) {
    if (!candidate.id.trim() || ids.has(candidate.id)) throw new Error("research replay snapshot candidate identity is invalid");
    ids.add(candidate.id);
    if (candidate.candidateSpecification.codeSha.trim().toLowerCase() !== payload.sourceCommitSha) {
      throw new Error("research replay snapshot source commit mismatch");
    }
  }
}

function sameBoundExecution(
  left: ResearchRunProvenance["boundExecution"],
  right: ResearchRunProvenance["boundExecution"],
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return canonicalResearchJson(left) === canonicalResearchJson(right);
}

/**
 * Captures the exact serializable research candidates/options that produced a canonical League
 * run. This is the immutable bridge needed for later PAPER feedback: the later replay uses the
 * original candidate dataset/specification instead of silently pairing PAPER results with a fresh
 * daily dataset that only happens to share a strategy label.
 *
 * Durable boundExecution is always copied from originalRun. A caller-supplied value may only be an
 * exact assertion of that canonical value; it can never create or replace execution provenance.
 */
export function createResearchRunReplaySnapshot(
  candidates: readonly ResearchRunCandidate[],
  options: ResearchRunReplayOptions,
  originalRun: ResearchRunLeagueResult,
): ResearchRunReplaySnapshot {
  const { boundExecution: assertedBoundExecution, ...unboundOptions } = options;
  const canonicalBoundExecution = originalRun.provenance.boundExecution;
  if (assertedBoundExecution != null && !sameBoundExecution(assertedBoundExecution, canonicalBoundExecution)) {
    throw new Error("research replay snapshot execution binding assertion mismatch");
  }
  const replayOptions: ResearchRunReplayOptions = freeze({
    ...unboundOptions,
    ...(canonicalBoundExecution == null ? {} : { boundExecution: freeze({ ...canonicalBoundExecution }) }),
  });
  const payload: ResearchRunReplaySnapshotPayload = freeze({
    schemaVersion: 1,
    sourceCommitSha: originalRun.provenance.sourceCommitSha,
    originalRunFingerprintSha256: originalRun.provenance.runFingerprintSha256,
    candidates: freeze(candidates.map((candidate) => freeze({ ...candidate }))),
    options: replayOptions,
  });
  validatePayload(payload);
  const reproduced = buildResearchRunLeague(payload.candidates, payload.options);
  if (reproduced.provenance.runFingerprintSha256 !== payload.originalRunFingerprintSha256) {
    throw new Error("research replay snapshot does not reproduce original run provenance");
  }
  return freeze({ ...payload, snapshotSha256: hash(payload) });
}

/**
 * Verifies the immutable archive envelope without executing Research/League semantics.
 *
 * This boundary is intentionally narrower than a replay: bootstrap identity discovery may scan
 * hundreds of MiB of historical snapshots, so repeating every historical League run there would
 * turn a tiny identity lookup into unbounded CPU work. The selected snapshot is still subjected to
 * the existing full semantic replay before any PAPER_RESEARCH_ONLY challenger can be deployed.
 */
export function validateResearchRunReplaySnapshotIntegrity(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshotPayload {
  const { snapshotSha256, ...payload } = snapshot;
  validatePayload(payload);
  if (!SHA64.test(snapshotSha256) || hash(payload) !== snapshotSha256) throw new Error("research replay snapshot checksum mismatch");
  return payload;
}

function validateSnapshot(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshotPayload {
  const payload = validateResearchRunReplaySnapshotIntegrity(snapshot);
  const reproduced = buildResearchRunLeague(payload.candidates, payload.options);
  if (reproduced.provenance.runFingerprintSha256 !== payload.originalRunFingerprintSha256) {
    throw new Error("research replay snapshot provenance drift");
  }
  return payload;
}

/**
 * Re-evaluates the exact original Research run with candidate-matched longitudinal PAPER evidence.
 * Evidence for a different dataset/content hash is rejected by the existing PAPER→League gate;
 * this layer never rewrites identity and never creates execution authority.
 */
export function replayResearchRunWithPaperEvidence(
  snapshot: ResearchRunReplaySnapshot,
  paperEvidenceByCandidate: Readonly<Record<string, ResearchRunPaperReplayEvidence | undefined>>,
): ResearchRunReplayResult {
  const payload = validateSnapshot(snapshot);
  const candidates = payload.candidates.map((candidate) => {
    const paperForwardEvidence = paperEvidenceByCandidate[candidate.id];
    return freeze({ ...candidate, ...(paperForwardEvidence == null ? {} : { paperForwardEvidence }) });
  });
  const run = buildResearchRunLeague(candidates, payload.options);
  return freeze({ run, qualification: qualifyResearchFactoryRun(run) });
}
