import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../../packages/contracts/src/researchRuntime";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import { qualifyResearchFactoryRun, type ResearchFactoryQualificationResult } from "./researchFactoryQualification";
import {
  buildResearchRunLeague,
  type ResearchRunCandidate,
  type ResearchRunLeagueResult,
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

/**
 * Captures the exact serializable research candidates/options that produced a canonical League
 * run. This is the immutable bridge needed for later PAPER feedback: the later replay uses the
 * original candidate dataset/specification instead of silently pairing PAPER results with a fresh
 * daily dataset that only happens to share a strategy label.
 */
export function createResearchRunReplaySnapshot(
  candidates: readonly ResearchRunCandidate[],
  options: ResearchRunReplayOptions,
  originalRun: ResearchRunLeagueResult,
): ResearchRunReplaySnapshot {
  const payload: ResearchRunReplaySnapshotPayload = freeze({
    schemaVersion: 1,
    sourceCommitSha: originalRun.provenance.sourceCommitSha,
    originalRunFingerprintSha256: originalRun.provenance.runFingerprintSha256,
    candidates: freeze(candidates.map((candidate) => freeze({ ...candidate }))),
    options: freeze({ ...options }),
  });
  validatePayload(payload);
  const reproduced = buildResearchRunLeague(payload.candidates, payload.options);
  if (reproduced.provenance.runFingerprintSha256 !== payload.originalRunFingerprintSha256) {
    throw new Error("research replay snapshot does not reproduce original run provenance");
  }
  return freeze({ ...payload, snapshotSha256: hash(payload) });
}

function validateSnapshot(snapshot: ResearchRunReplaySnapshot): ResearchRunReplaySnapshotPayload {
  const { snapshotSha256, ...payload } = snapshot;
  validatePayload(payload);
  if (!SHA64.test(snapshotSha256) || hash(payload) !== snapshotSha256) throw new Error("research replay snapshot checksum mismatch");
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
