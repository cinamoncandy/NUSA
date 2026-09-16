import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import { validatePaperResearchLineage } from "./paperResearchLineage";

const SHA256 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const OUTCOMES = new Set(["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);

export interface ClosedLearningResearchReplayCandidateResult {
  readonly candidateId: string;
  readonly outcome: "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE";
  readonly reasons: readonly string[];
  readonly summary: string;
}

export interface ClosedLearningResearchNotDeployable {
  readonly schemaVersion: 1;
  readonly status: "NOT_DEPLOYABLE";
  readonly reasons: readonly string[];
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ClosedLearningResearchDeployable {
  readonly schemaVersion: 1;
  readonly status: "DEPLOYABLE";
  readonly reasons: readonly string[];
  readonly artifact: QualifiedPaperChallengerArtifact & { readonly researchLineage: NonNullable<QualifiedPaperChallengerArtifact["researchLineage"]> };
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export type ClosedLearningResearchPaperDeployment = ClosedLearningResearchNotDeployable | ClosedLearningResearchDeployable;

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
  readonly deployment: ClosedLearningResearchPaperDeployment;
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

export interface ClosedLearningResearchWorkerProcessInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: Readonly<Record<string, string>>;
  readonly maxBuffer: number;
}

export type ClosedLearningResearchWorkerProcess = (input: ClosedLearningResearchWorkerProcessInput) => ClosedLearningResearchWorkerProcessResult;
export type ClosedLearningResearchWorkerAsyncProcess = (input: ClosedLearningResearchWorkerProcessInput) => Promise<ClosedLearningResearchWorkerProcessResult>;

export interface ClosedLearningResearchWorkerClientOptions {
  readonly snapshotPath: string;
  readonly workerPath?: string;
  readonly executable?: string;
  readonly process?: ClosedLearningResearchWorkerProcess;
  readonly asyncProcess?: ClosedLearningResearchWorkerAsyncProcess;
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

function reasons(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((reason) => typeof reason !== "string" || !reason.trim())) throw new Error(`${field} is invalid`);
  return Object.freeze(value.map((reason) => String(reason).trim()));
}

function defaultProcess(input: ClosedLearningResearchWorkerProcessInput): ClosedLearningResearchWorkerProcessResult {
  const result = spawnSync(input.executable, [...input.args], {
    input: input.stdin,
    encoding: "utf8",
    env: { ...input.env },
    maxBuffer: input.maxBuffer,
    windowsHide: true,
  });
  return Object.freeze({ status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error });
}

function defaultAsyncProcess(input: ClosedLearningResearchWorkerProcessInput): Promise<ClosedLearningResearchWorkerProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(input.executable, [...input.args], {
      env: { ...input.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let overflow = false;

    const finish = (result: ClosedLearningResearchWorkerProcessResult): void => {
      if (settled) return;
      settled = true;
      resolve(Object.freeze(result));
    };
    const enforceBuffer = (): void => {
      if (overflow) return;
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") <= input.maxBuffer) return;
      overflow = true;
      child.kill("SIGTERM");
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; enforceBuffer(); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; enforceBuffer(); });
    child.once("error", (error) => finish({ status: null, stdout, stderr, error }));
    child.once("close", (status) => {
      if (overflow) {
        finish({ status: null, stdout, stderr, error: new Error("Research replay worker exceeded maxBuffer") });
        return;
      }
      finish({ status, stdout, stderr });
    });
    child.stdin.on("error", (error) => finish({ status: null, stdout, stderr, error }));
    child.stdin.end(input.stdin);
  });
}

function validateDeployment(
  value: unknown,
  originalRunFingerprintSha256: string,
  replayRunFingerprintSha256: string,
  candidates: readonly ClosedLearningResearchReplayCandidateResult[],
): ClosedLearningResearchPaperDeployment {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Research replay worker deployment is invalid");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || item.authority !== "PAPER_RESEARCH_ONLY" || item.liveAuthority !== "NONE" || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") throw new Error("Research replay worker deployment authority is invalid");
  const normalizedReasons = reasons(item.reasons, "Research replay worker deployment reasons");
  if (item.status === "NOT_DEPLOYABLE") {
    if (item.artifact != null) throw new Error("Research replay worker non-deployable result contains an artifact");
    return Object.freeze({ schemaVersion: 1, status: "NOT_DEPLOYABLE", reasons: normalizedReasons, authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
  }
  if (item.status !== "DEPLOYABLE" || item.artifact == null || typeof item.artifact !== "object" || Array.isArray(item.artifact)) throw new Error("Research replay worker deployment status is invalid");
  const artifact = item.artifact as Record<string, unknown>;
  if (artifact.schemaVersion !== 1 || artifact.liveAuthority !== "NONE" || artifact.productionMutationAllowed !== false || artifact.aiAuthority !== "ZERO_AUTHORITY") throw new Error("Research replay worker artifact authority is invalid");
  const candidateId = safeText(artifact.candidateId, "Research replay worker artifact candidateId", 240);
  const candidateVersion = safeText(artifact.candidateVersion, "Research replay worker artifact candidateVersion", 64).toLowerCase();
  if (!SHA256.test(candidateVersion)) throw new Error("Research replay worker artifact candidate version is invalid");
  const market = safeText(artifact.market, "Research replay worker artifact market", 32).toUpperCase();
  if (!MARKET.test(market)) throw new Error("Research replay worker artifact market is invalid");
  const decisionReference = safeText(artifact.researchDecisionReference, "Research replay worker artifact decision reference", 240);
  const candidateStrategy = artifact.candidateStrategy;
  if (candidateStrategy == null || typeof candidateStrategy !== "object" || Array.isArray(candidateStrategy)) throw new Error("Research replay worker artifact strategy specification is unavailable");
  const strategy = candidateStrategy as Record<string, unknown>;
  if (strategy.candidateId !== candidateId || typeof strategy.familyId !== "string" || typeof strategy.lineageId !== "string" || typeof strategy.specificationHash !== "string" || !SHA256.test(strategy.specificationHash.trim().toLowerCase()) || typeof strategy.codeSha !== "string" || !/^[a-f0-9]{40}$/.test(strategy.codeSha.trim().toLowerCase()) || typeof strategy.costModelVersion !== "string" || strategy.parameters == null || typeof strategy.parameters !== "object" || Array.isArray(strategy.parameters)) throw new Error("Research replay worker artifact strategy specification is invalid");
  const lineage = validatePaperResearchLineage(artifact.researchLineage as never);
  if (
    lineage.candidateId !== candidateId
    || lineage.candidateVersion !== candidateVersion
    || lineage.originalRunFingerprintSha256 !== originalRunFingerprintSha256
    || lineage.replayRunFingerprintSha256 !== replayRunFingerprintSha256
    || lineage.researchDecisionReference !== decisionReference
  ) throw new Error("Research replay worker artifact lineage provenance is invalid");
  const qualified = candidates.filter((candidate) => candidate.candidateId === candidateId && candidate.outcome === "QUALIFIED_FOR_LEAGUE");
  if (qualified.length !== 1) throw new Error("Research replay worker deployable candidate is not uniquely qualified");
  if (!Array.isArray(artifact.candidateProvenance) || artifact.candidateProvenance.length !== 1) throw new Error("Research replay worker artifact candidate provenance is invalid");
  const candidateProvenance = artifact.candidateProvenance[0] as Record<string, unknown>;
  const datasetId = safeText(candidateProvenance.candidateId === candidateId ? candidateProvenance.datasetId : undefined, "Research replay worker artifact datasetId", 240);
  const datasetContentSha256 = safeText(candidateProvenance.datasetContentSha256, "Research replay worker artifact dataset hash", 64).toLowerCase();
  if (!SHA256.test(datasetContentSha256)) throw new Error("Research replay worker artifact dataset hash is invalid");
  if (artifact.advisory == null || typeof artifact.advisory !== "object" || Array.isArray(artifact.advisory)) throw new Error("Research replay worker artifact advisory is invalid");
  const advisory = artifact.advisory as Record<string, unknown>;
  if (!Array.isArray(advisory.entries) || advisory.entries.length !== 1 || (advisory.entries[0] as Record<string, unknown> | undefined)?.id !== candidateId) throw new Error("Research replay worker artifact advisory candidate is invalid");
  return Object.freeze({
    schemaVersion: 1,
    status: "DEPLOYABLE",
    reasons: normalizedReasons,
    artifact: Object.freeze({
      ...(artifact as unknown as QualifiedPaperChallengerArtifact),
      candidateId,
      candidateVersion,
      market,
      researchDecisionReference: decisionReference,
      researchLineage: lineage,
      candidateProvenance: Object.freeze([{ candidateId, datasetId, datasetContentSha256 }]),
      candidateStrategy: Object.freeze({
        candidateId,
        familyId: strategy.familyId.trim(),
        lineageId: strategy.lineageId.trim(),
        specificationHash: strategy.specificationHash.trim().toLowerCase(),
        codeSha: strategy.codeSha.trim().toLowerCase(),
        costModelVersion: strategy.costModelVersion.trim(),
        parameters: Object.freeze({ ...(strategy.parameters as Record<string, string | number | boolean>) }),
      }),
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
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
  const deployment = validateDeployment(item.deployment, original, replay, candidates);
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: original,
    replayRunFingerprintSha256: replay,
    qualification: Object.freeze({ schemaVersion: 1, candidates: Object.freeze(candidates), coverage: normalizedCoverage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }),
    deployment,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function invocation(
  workerPath: string,
  executable: string,
  snapshotPath: string,
  originalRunFingerprintSha256: string,
  paperEvidenceByCandidate: Readonly<Record<string, unknown>>,
  requirePaperEvidence: boolean,
): { readonly fingerprint: string; readonly input: ClosedLearningResearchWorkerProcessInput } {
  const fingerprint = originalRunFingerprintSha256.trim().toLowerCase();
  if (!SHA256.test(fingerprint)) throw new Error("Research replay fingerprint is invalid");
  if (paperEvidenceByCandidate == null || typeof paperEvidenceByCandidate !== "object" || Array.isArray(paperEvidenceByCandidate)) throw new Error("Research replay PAPER evidence is invalid");
  if (requirePaperEvidence && Object.keys(paperEvidenceByCandidate).length === 0) throw new Error("Research replay PAPER evidence is empty");
  const request = JSON.stringify({ schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE", originalRunFingerprintSha256: fingerprint, paperEvidenceByCandidate });
  return Object.freeze({
    fingerprint,
    input: Object.freeze({ executable, args: Object.freeze([workerPath]), stdin: request, env: Object.freeze({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: snapshotPath }), maxBuffer: 8 * 1024 * 1024 }),
  });
}

function parseProcessResult(result: ClosedLearningResearchWorkerProcessResult, fingerprint: string): ClosedLearningResearchReplayResult {
  if (result.error != null) throw new Error(`Research replay worker failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Research replay worker failed closed${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 500)}` : ""}`);
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error("Research replay worker returned invalid JSON"); }
  return validateResult(parsed, fingerprint);
}

/** Cloud-side process boundary to the canonical desktop Research/League replay worker. */
export class ClosedLearningResearchWorkerClient {
  private readonly snapshotPath: string;
  private readonly workerPath: string;
  private readonly executable: string;
  private readonly runProcess: ClosedLearningResearchWorkerProcess;
  private readonly runAsyncProcess: ClosedLearningResearchWorkerAsyncProcess;

  public constructor(options: ClosedLearningResearchWorkerClientOptions) {
    this.snapshotPath = path.resolve(options.snapshotPath);
    if (!options.snapshotPath.trim() || options.snapshotPath === ":memory:" || !path.isAbsolute(options.snapshotPath)) throw new Error("Research replay snapshot path must be an absolute durable path");
    this.workerPath = options.workerPath ?? path.resolve(process.cwd(), "scripts", "closed-learning-research-worker.js");
    if (!path.isAbsolute(this.workerPath)) throw new Error("Research replay worker path must be absolute");
    this.executable = options.executable ?? process.execPath;
    this.runProcess = options.process ?? defaultProcess;
    this.runAsyncProcess = options.asyncProcess ?? defaultAsyncProcess;
  }

  private execute(originalRunFingerprintSha256: string, paperEvidenceByCandidate: Readonly<Record<string, unknown>>, requirePaperEvidence: boolean): ClosedLearningResearchReplayResult {
    const request = invocation(this.workerPath, this.executable, this.snapshotPath, originalRunFingerprintSha256, paperEvidenceByCandidate, requirePaperEvidence);
    return parseProcessResult(this.runProcess(request.input), request.fingerprint);
  }

  private async executeAsync(originalRunFingerprintSha256: string, paperEvidenceByCandidate: Readonly<Record<string, unknown>>, requirePaperEvidence: boolean): Promise<ClosedLearningResearchReplayResult> {
    const request = invocation(this.workerPath, this.executable, this.snapshotPath, originalRunFingerprintSha256, paperEvidenceByCandidate, requirePaperEvidence);
    return parseProcessResult(await this.runAsyncProcess(request.input), request.fingerprint);
  }

  public replay(originalRunFingerprintSha256: string, paperEvidenceByCandidate: Readonly<Record<string, unknown>>): ClosedLearningResearchReplayResult {
    return this.execute(originalRunFingerprintSha256, paperEvidenceByCandidate, true);
  }

  public replayAsync(originalRunFingerprintSha256: string, paperEvidenceByCandidate: Readonly<Record<string, unknown>>): Promise<ClosedLearningResearchReplayResult> {
    return this.executeAsync(originalRunFingerprintSha256, paperEvidenceByCandidate, true);
  }

  /** Initial PAPER bootstrap replays canonical Research/League without fabricating PAPER evidence. */
  public replayInitialResearch(originalRunFingerprintSha256: string): ClosedLearningResearchReplayResult {
    return this.execute(originalRunFingerprintSha256, Object.freeze({}), false);
  }

  /** Async production path keeps the Node HTTP event loop responsive while Research/League runs. */
  public replayInitialResearchAsync(originalRunFingerprintSha256: string): Promise<ClosedLearningResearchReplayResult> {
    return this.executeAsync(originalRunFingerprintSha256, Object.freeze({}), false);
  }
}
