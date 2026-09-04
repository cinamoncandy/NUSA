import path from "node:path";
import { spawnSync } from "node:child_process";

const SHA256 = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set(["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);

export interface ClosedLearningResearchReplayCandidateResult {
  readonly candidateId: string;
  readonly outcome: "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE";
  readonly reasons: readonly string[];
  readonly summary: string;
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
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: original,
    replayRunFingerprintSha256: replay,
    qualification: Object.freeze({ schemaVersion: 1, candidates: Object.freeze(candidates), coverage: normalizedCoverage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }),
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

  public replay(originalRunFingerprintSha256: string, paperEvidenceByCandidate: Readonly<Record<string, unknown>>): ClosedLearningResearchReplayResult {
    const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
    if (!SHA256.test(fingerprint)) throw new Error("Research replay fingerprint is invalid");
    if (paperEvidenceByCandidate == null || typeof paperEvidenceByCandidate !== "object" || Array.isArray(paperEvidenceByCandidate) || Object.keys(paperEvidenceByCandidate).length === 0) throw new Error("Research replay PAPER evidence is empty");
    const request = JSON.stringify({ schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE", originalRunFingerprintSha256: fingerprint, paperEvidenceByCandidate });
    const result = this.runProcess({ executable: this.executable, args: [this.workerPath], stdin: request, env: { NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: this.snapshotPath }, maxBuffer: 8 * 1024 * 1024 });
    if (result.error != null) throw new Error(`Research replay worker failed to start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Research replay worker failed closed${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 500)}` : ""}`);
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { throw new Error("Research replay worker returned invalid JSON"); }
    return validateResult(parsed, fingerprint);
  }
}
