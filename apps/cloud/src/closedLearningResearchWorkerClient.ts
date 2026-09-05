import path from "node:path";
import { spawnSync } from "node:child_process";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PersistedPaperCandidateProvenance, PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { CanonicalPaperExecutionQualityPolicy } from "./canonicalPaperCandidatePerformance";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const SHA256 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const OUTCOMES = new Set(["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);
const BLOCK_REASONS = new Set(["CANONICAL_PAPER_PREPARATION_REQUIRED", "NO_QUALIFIED_CANDIDATE", "MULTIPLE_QUALIFIED_CANDIDATES", "CANONICAL_PAPER_PERFORMANCE_INSUFFICIENT", "QUALIFIED_CANDIDATE_HAS_NO_MATCHED_PAPER_EVIDENCE", "AMBIGUOUS_LEAGUE_ALLOCATION"]);

export interface ClosedLearningResearchReplayCandidateResult {
  readonly candidateId: string;
  readonly outcome: "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE";
  readonly reasons: readonly string[];
  readonly summary: string;
}

export interface ClosedLearningDeploymentCandidate {
  readonly candidateId: string;
  readonly candidateVersion: string;
  readonly market: string;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
  readonly decisionReference: string;
  readonly originalRunFingerprintSha256: string;
  readonly replayRunFingerprintSha256: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ClosedLearningCanonicalPreparation {
  readonly matchedCandidateIds: readonly string[];
  readonly awaitingPerformanceCandidateIds: readonly string[];
  readonly orderedRecordIds: readonly string[];
  readonly deploymentCandidate?: ClosedLearningDeploymentCandidate;
  readonly deploymentBlockedReason?: string;
}

export interface ClosedLearningResearchReplayResult {
  readonly schemaVersion: 1;
  readonly operation: "REPLAY_PAPER_EVIDENCE";
  readonly originalRunFingerprintSha256: string;
  readonly replayRunFingerprintSha256: string;
  readonly qualification: {
    readonly schemaVersion: 1;
    readonly candidates: readonly ClosedLearningResearchReplayCandidateResult[];
    readonly coverage: {
      readonly candidateCount: number;
      readonly qualifiedCount: number;
      readonly insufficientCount: number;
      readonly rejectedCount: number;
    };
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
  readonly canonicalPreparation?: ClosedLearningCanonicalPreparation;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ClosedLearningResearchWorkerProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export type ClosedLearningResearchWorkerProcess = (input: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: Readonly<Record<string, string>>;
  readonly maxBuffer: number;
}) => ClosedLearningResearchWorkerProcessResult;

export interface ClosedLearningResearchWorkerClientOptions {
  readonly snapshotPath: string;
  readonly workerPath?: string;
  readonly executable?: string;
  readonly process?: ClosedLearningResearchWorkerProcess;
}

function safeText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${field} is invalid`);
  return normalized;
}

function safeCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${field} is invalid`);
  return value as number;
}

function safeTextArray(value: unknown, field: string, max = 500): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field} is invalid`);
  const normalized = value.map((item, index) => safeText(item, `${field}[${index}]`, max));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} contains duplicates`);
  return Object.freeze(normalized);
}

function defaultProcess(input: Parameters<ClosedLearningResearchWorkerProcess>[0]): ClosedLearningResearchWorkerProcessResult {
  const result = spawnSync(input.executable, [...input.args], {
    input: input.stdin,
    encoding: "utf8",
    env: { ...input.env },
    maxBuffer: input.maxBuffer,
    windowsHide: true,
  });
  return Object.freeze({ status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error });
}

function validateDeploymentCandidate(value: unknown, original: string, replay: string): ClosedLearningDeploymentCandidate {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Research replay deployment candidate is invalid");
  const item = value as Record<string, unknown>;
  if (item.liveAuthority !== "NONE" || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") throw new Error("Research replay deployment candidate authority is invalid");
  const candidateId = safeText(item.candidateId, "deploymentCandidate.candidateId", 240);
  const candidateVersion = safeText(item.candidateVersion, "deploymentCandidate.candidateVersion", 64).toLowerCase();
  const market = safeText(item.market, "deploymentCandidate.market", 64).toUpperCase();
  const originalFingerprint = safeText(item.originalRunFingerprintSha256, "deploymentCandidate.originalRunFingerprintSha256", 64).toLowerCase();
  const replayFingerprint = safeText(item.replayRunFingerprintSha256, "deploymentCandidate.replayRunFingerprintSha256", 64).toLowerCase();
  if (!SHA256.test(candidateVersion) || !MARKET.test(market) || originalFingerprint !== original || replayFingerprint !== replay) throw new Error("Research replay deployment candidate provenance is invalid");
  if (item.advisory == null || typeof item.advisory !== "object" || Array.isArray(item.advisory)) throw new Error("Research replay deployment advisory is invalid");
  const advisory = item.advisory as LeagueCapitalAllocationAdvisory;
  if (advisory.schemaVersion !== 1 || !Array.isArray(advisory.entries) || advisory.entries.length !== 1 || advisory.entries[0]?.id !== candidateId) throw new Error("Research replay deployment advisory is ambiguous");
  if (!Array.isArray(item.candidateProvenance) || item.candidateProvenance.length !== 1) throw new Error("Research replay deployment candidate provenance is ambiguous");
  const provenance = item.candidateProvenance[0] as Record<string, unknown>;
  const datasetId = safeText(provenance.datasetId, "deploymentCandidate.datasetId", 240);
  const datasetContentSha256 = safeText(provenance.datasetContentSha256, "deploymentCandidate.datasetContentSha256", 64).toLowerCase();
  if (safeText(provenance.candidateId, "deploymentCandidate.provenanceCandidateId", 240) !== candidateId || !SHA256.test(datasetContentSha256)) throw new Error("Research replay deployment dataset provenance is invalid");
  return Object.freeze({
    candidateId,
    candidateVersion,
    market,
    advisory,
    candidateProvenance: Object.freeze([{ candidateId, datasetId, datasetContentSha256 }]),
    decisionReference: safeText(item.decisionReference, "deploymentCandidate.decisionReference", 240),
    originalRunFingerprintSha256: original,
    replayRunFingerprintSha256: replay,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function validateCanonicalPreparation(value: unknown, original: string, replay: string): ClosedLearningCanonicalPreparation | undefined {
  if (value === undefined) return undefined;
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Research replay canonical preparation is invalid");
  const item = value as Record<string, unknown>;
  const matchedCandidateIds = safeTextArray(item.matchedCandidateIds, "matchedCandidateIds", 240);
  const awaitingPerformanceCandidateIds = safeTextArray(item.awaitingPerformanceCandidateIds, "awaitingPerformanceCandidateIds", 240);
  const orderedRecordIds = safeTextArray(item.orderedRecordIds, "orderedRecordIds", 256);
  if (matchedCandidateIds.some((id) => awaitingPerformanceCandidateIds.includes(id))) throw new Error("Research replay canonical preparation candidate sets overlap");
  const deploymentCandidate = item.deploymentCandidate === undefined ? undefined : validateDeploymentCandidate(item.deploymentCandidate, original, replay);
  const deploymentBlockedReason = item.deploymentBlockedReason === undefined ? undefined : safeText(item.deploymentBlockedReason, "deploymentBlockedReason", 120);
  if (deploymentCandidate != null && deploymentBlockedReason != null) throw new Error("Research replay canonical preparation deployment state is ambiguous");
  if (deploymentCandidate == null && (deploymentBlockedReason == null || !BLOCK_REASONS.has(deploymentBlockedReason))) throw new Error("Research replay canonical preparation block reason is invalid");
  return Object.freeze({ matchedCandidateIds, awaitingPerformanceCandidateIds, orderedRecordIds, ...(deploymentCandidate == null ? {} : { deploymentCandidate }), ...(deploymentBlockedReason == null ? {} : { deploymentBlockedReason }) });
}

function validateResult(value: unknown, expectedFingerprint: string): ClosedLearningResearchReplayResult {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Research replay worker response is invalid");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || item.operation !== "REPLAY_PAPER_EVIDENCE") throw new Error("Research replay worker response schema is invalid");
  const original = safeText(item.originalRunFingerprintSha256, "originalRunFingerprintSha256", 64).toLowerCase();
  const replay = safeText(item.replayRunFingerprintSha256, "replayRunFingerprintSha256", 64).toLowerCase();
  if (!SHA256.test(original) || !SHA256.test(replay) || original !== expectedFingerprint) throw new Error("Research replay worker response provenance is invalid");
  if (item.liveAuthority !== "NONE" || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") throw new Error("Research replay worker response authority is invalid");
  if (item.qualification == null || typeof item.qualification !== "object" || Array.isArray(item.qualification)) throw new Error("Research replay worker qualification is invalid");
  const qualification = item.qualification as Record<string, unknown>;
  if (qualification.schemaVersion !== 1 || qualification.liveAuthority !== "NONE" || qualification.productionMutationAllowed !== false || qualification.aiAuthority !== "ZERO_AUTHORITY") throw new Error("Research replay worker qualification authority is invalid");
  if (!Array.isArray(qualification.candidates) || qualification.coverage == null || typeof qualification.coverage !== "object" || Array.isArray(qualification.coverage)) throw new Error("Research replay worker qualification payload is invalid");
  const candidates = qualification.candidates.map((candidate, index) => {
    if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`Research replay candidate ${index} is invalid`);
    const record = candidate as Record<string, unknown>;
    const candidateId = safeText(record.candidateId, `candidateId[${index}]`, 240);
    const outcome = safeText(record.outcome, `outcome[${index}]`, 64);
    if (!OUTCOMES.has(outcome)) throw new Error(`Research replay candidate ${candidateId} outcome is invalid`);
    if (!Array.isArray(record.reasons) || record.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) throw new Error(`Research replay candidate ${candidateId} reasons are invalid`);
    return Object.freeze({ candidateId, outcome: outcome as ClosedLearningResearchReplayCandidateResult["outcome"], reasons: Object.freeze(record.reasons.map((reason) => String(reason).trim())), summary: safeText(record.summary, `summary[${index}]`, 2000) });
  });
  const identities = new Set(candidates.map((candidate) => candidate.candidateId));
  if (identities.size !== candidates.length) throw new Error("Research replay worker candidate identity is duplicated");
  const coverage = qualification.coverage as Record<string, unknown>;
  const normalizedCoverage = Object.freeze({
    candidateCount: safeCount(coverage.candidateCount, "candidateCount"),
    qualifiedCount: safeCount(coverage.qualifiedCount, "qualifiedCount"),
    insufficientCount: safeCount(coverage.insufficientCount, "insufficientCount"),
    rejectedCount: safeCount(coverage.rejectedCount, "rejectedCount"),
  });
  const counted = candidates.reduce((acc, candidate) => { acc[candidate.outcome] += 1; return acc; }, { REJECTED: 0, INSUFFICIENT: 0, QUALIFIED_FOR_LEAGUE: 0 });
  if (normalizedCoverage.candidateCount !== candidates.length || normalizedCoverage.rejectedCount !== counted.REJECTED || normalizedCoverage.insufficientCount !== counted.INSUFFICIENT || normalizedCoverage.qualifiedCount !== counted.QUALIFIED_FOR_LEAGUE) throw new Error("Research replay worker coverage reconciliation failed");
  const canonicalPreparation = validateCanonicalPreparation(item.canonicalPreparation, original, replay);
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: original,
    replayRunFingerprintSha256: replay,
    qualification: Object.freeze({ schemaVersion: 1, candidates: Object.freeze(candidates), coverage: normalizedCoverage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }),
    ...(canonicalPreparation == null ? {} : { canonicalPreparation }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

/** Cloud-side process boundary to the canonical desktop Research/League replay worker. */
export class ClosedLearningResearchWorkerClient {
  private readonly snapshotPath: string;
  private readonly workerPath: string;
  private readonly executable: string;
  private readonly runProcess: ClosedLearningResearchWorkerProcess;

  public constructor(options: ClosedLearningResearchWorkerClientOptions) {
    this.snapshotPath = path.resolve(options.snapshotPath);
    if (!options.snapshotPath.trim() || options.snapshotPath === ":memory:" || !path.isAbsolute(options.snapshotPath)) throw new Error("Research replay snapshot path must be an absolute durable path");
    this.workerPath = options.workerPath ?? path.resolve(process.cwd(), "scripts", "closed-learning-research-worker.js");
    if (!path.isAbsolute(this.workerPath)) throw new Error("Research replay worker path must be absolute");
    this.executable = options.executable ?? process.execPath;
    this.runProcess = options.process ?? defaultProcess;
  }

  private execute(request: Readonly<Record<string, unknown>>, fingerprint: string): ClosedLearningResearchReplayResult {
    const result = this.runProcess({ executable: this.executable, args: [this.workerPath], stdin: JSON.stringify(request), env: { NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: this.snapshotPath }, maxBuffer: 8 * 1024 * 1024 });
    if (result.error != null) throw new Error(`Research replay worker failed to start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Research replay worker failed closed${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 500)}` : ""}`);
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { throw new Error("Research replay worker returned invalid JSON"); }
    return validateResult(parsed, fingerprint);
  }

  public replay(originalRunFingerprintSha256: string, paperEvidenceByCandidate: Readonly<Record<string, unknown>>): ClosedLearningResearchReplayResult {
    const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA256.test(fingerprint)) throw new Error("Research replay fingerprint is invalid");
    if (paperEvidenceByCandidate == null || typeof paperEvidenceByCandidate !== "object" || Array.isArray(paperEvidenceByCandidate) || Object.keys(paperEvidenceByCandidate).length === 0) throw new Error("Research replay PAPER evidence is empty");
    return this.execute({ schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE", originalRunFingerprintSha256: fingerprint, paperEvidenceByCandidate }, fingerprint);
  }

  public replayCanonicalPaperEvidence(input: {
    readonly originalRunFingerprintSha256: string;
    readonly persistedPaperPeriods: readonly PersistedPaperPeriodEnvelope[];
    readonly paperAccount: PaperAccountState;
    readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
  }): ClosedLearningResearchReplayResult {
    const fingerprint = input.originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA256.test(fingerprint)) throw new Error("Research replay fingerprint is invalid");
    if (!Array.isArray(input.persistedPaperPeriods) || input.persistedPaperPeriods.length === 0) throw new Error("Research replay canonical PAPER periods are empty");
    if (input.paperAccount == null || input.paperAccount.version !== 1) throw new Error("Research replay canonical PAPER account is unavailable");
    const result = this.execute({
      schemaVersion: 1,
      operation: "REPLAY_CANONICAL_PAPER_EVIDENCE",
      originalRunFingerprintSha256: fingerprint,
      persistedPaperPeriods: input.persistedPaperPeriods,
      paperAccount: input.paperAccount,
      executionQualityPolicy: input.executionQualityPolicy,
    }, fingerprint);
    if (result.canonicalPreparation == null) throw new Error("Research replay canonical preparation is unavailable");
    return result;
  }
}
