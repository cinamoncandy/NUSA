import { createHash } from "node:crypto";

export type ClosedLearningOutcome = "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE";

export interface ClosedLearningEvidenceIdentity {
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly championId: string;
  readonly championVersion: string;
  readonly sourceCommitSha: string;
  readonly costModelVersion: string;
  readonly riskConfigHash: string;
  readonly evidenceReferences: readonly string[];
}

export interface ClosedLearningResearchDecision {
  readonly decisionId: string;
  readonly outcome: ClosedLearningOutcome;
  readonly candidateId?: string;
  readonly candidateVersion?: string;
  readonly decisionReference: string;
  readonly reasons: readonly string[];
}

export interface ClosedLearningPaperDeploymentReceipt {
  readonly deploymentId: string;
  readonly candidateId: string;
  readonly candidateVersion: string;
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ClosedLearningCycleRecord {
  readonly cycleId: string;
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly decision: ClosedLearningResearchDecision;
  readonly paperDeployment?: ClosedLearningPaperDeploymentReceipt;
  readonly recordedAt: number;
}

export interface ClosedLearningCycleRepository {
  get(cycleId: string): ClosedLearningCycleRecord | undefined;
  append(record: ClosedLearningCycleRecord): ClosedLearningCycleRecord;
}

export interface ExistingResearchFactoryAdapter {
  evaluate(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): ClosedLearningResearchDecision;
}

export interface AsyncExistingResearchFactoryAdapter extends ExistingResearchFactoryAdapter {
  evaluateAsync(input: ClosedLearningEvidenceIdentity & { readonly cycleId: string }): Promise<ClosedLearningResearchDecision>;
}

export interface PaperChallengerDeploymentAdapter {
  deploy(input: {
    readonly cycleId: string;
    readonly decision: ClosedLearningResearchDecision & { readonly candidateId: string; readonly candidateVersion: string };
    readonly authority: "PAPER_RESEARCH_ONLY";
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  }): ClosedLearningPaperDeploymentReceipt;
}

export interface ClosedLearningCycleResult {
  readonly status: "EXECUTED" | "REPLAYED" | "RESUMED";
  readonly record: ClosedLearningCycleRecord;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REF = /^[A-Za-z0-9_.:/#@-]{1,240}$/;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("closed learning identity contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  throw new Error("closed learning identity contains an unsupported value");
}

function normalizeIdentity(input: ClosedLearningEvidenceIdentity): ClosedLearningEvidenceIdentity {
  const evidenceId = required(input.evidenceId, "evidenceId");
  const championId = required(input.championId, "championId");
  const championVersion = required(input.championVersion, "championVersion");
  const sourceCommitSha = required(input.sourceCommitSha, "sourceCommitSha").toLowerCase();
  const costModelVersion = required(input.costModelVersion, "costModelVersion");
  const evidenceFingerprintSha256 = required(input.evidenceFingerprintSha256, "evidenceFingerprintSha256").toLowerCase();
  const riskConfigHash = required(input.riskConfigHash, "riskConfigHash").toLowerCase();
  if (!SHA256.test(evidenceFingerprintSha256) || !SHA256.test(riskConfigHash)) throw new Error("closed learning evidence hashes are invalid");
  if (!/^[a-f0-9]{40}$/.test(sourceCommitSha)) throw new Error("sourceCommitSha must be a git SHA-1");
  const evidenceReferences = [...new Set(input.evidenceReferences.map((value) => required(value, "evidenceReference")))].sort();
  if (evidenceReferences.length === 0 || evidenceReferences.some((value) => !SAFE_REF.test(value))) throw new Error("closed learning evidence references are invalid");
  return Object.freeze({ evidenceId, evidenceFingerprintSha256, championId, championVersion, sourceCommitSha, costModelVersion, riskConfigHash, evidenceReferences: Object.freeze(evidenceReferences) });
}

function normalizeDecision(input: ClosedLearningResearchDecision): ClosedLearningResearchDecision {
  const decisionId = required(input.decisionId, "decisionId");
  const decisionReference = required(input.decisionReference, "decisionReference");
  const reasons = Object.freeze([...new Set(input.reasons.map((value) => required(value, "reason")))].sort());
  if (!new Set<ClosedLearningOutcome>(["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]).has(input.outcome)) throw new Error("closed learning outcome is invalid");
  const candidateId = input.candidateId?.trim();
  const candidateVersion = input.candidateVersion?.trim();
  if (input.outcome === "QUALIFIED_FOR_LEAGUE" && (!candidateId || !candidateVersion)) throw new Error("qualified decision requires immutable candidate identity");
  if (input.outcome !== "QUALIFIED_FOR_LEAGUE" && (candidateId || candidateVersion)) throw new Error("non-qualified decision cannot deploy a candidate");
  return Object.freeze({ decisionId, outcome: input.outcome, ...(candidateId ? { candidateId } : {}), ...(candidateVersion ? { candidateVersion } : {}), decisionReference, reasons });
}

function validateDeployment(input: ClosedLearningPaperDeploymentReceipt, decision: ClosedLearningResearchDecision): ClosedLearningPaperDeploymentReceipt {
  if (decision.outcome !== "QUALIFIED_FOR_LEAGUE" || decision.candidateId == null || decision.candidateVersion == null) throw new Error("PAPER deployment requires qualified candidate evidence");
  if (input.authority !== "PAPER_RESEARCH_ONLY" || input.liveAuthority !== "NONE" || input.productionMutationAllowed !== false || input.aiAuthority !== "ZERO_AUTHORITY") throw new Error("closed learning PAPER authority escaped its fail-closed boundary");
  if (input.candidateId !== decision.candidateId || input.candidateVersion !== decision.candidateVersion) throw new Error("PAPER deployment candidate identity conflicts with Research decision");
  return Object.freeze({ ...input, deploymentId: required(input.deploymentId, "deploymentId"), candidateId: decision.candidateId, candidateVersion: decision.candidateVersion });
}

export function closedLearningCycleId(input: ClosedLearningEvidenceIdentity): string {
  const identity = normalizeIdentity(input);
  return `closed-learning:${sha256(canonical(identity))}`;
}

/**
 * Thin orchestration over existing Research Factory / League and canonical PAPER deployment.
 * It owns no strategy metric, model training algorithm, League score, broker, LIVE route, or capital authority.
 * Every Research/League outcome is durably recorded before any PAPER action. A replay never reruns Research;
 * if a crash happened after qualification but before PAPER deployment, only that PAPER-only deployment resumes.
 */
export class ClosedLearningLoopCoordinator {
  public constructor(
    private readonly repository: ClosedLearningCycleRepository,
    private readonly researchFactory: ExistingResearchFactoryAdapter,
    private readonly paperDeployment: PaperChallengerDeploymentAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  private deployQualified(record: ClosedLearningCycleRecord): ClosedLearningCycleRecord {
    const decision = record.decision;
    if (decision.outcome !== "QUALIFIED_FOR_LEAGUE" || decision.candidateId == null || decision.candidateVersion == null) throw new Error("qualified candidate identity is unavailable");
    const receipt = validateDeployment(this.paperDeployment.deploy(Object.freeze({
      cycleId: record.cycleId,
      decision: decision as ClosedLearningResearchDecision & { readonly candidateId: string; readonly candidateVersion: string },
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    })), decision);
    return this.repository.append(Object.freeze({ ...record, paperDeployment: receipt }));
  }

  private existing(identity: ClosedLearningEvidenceIdentity, cycleId: string): ClosedLearningCycleResult | undefined {
    const previous = this.repository.get(cycleId);
    if (previous == null) return undefined;
    if (previous.evidenceId !== identity.evidenceId || previous.evidenceFingerprintSha256 !== identity.evidenceFingerprintSha256) throw new Error("closed learning replay identity conflict");
    if (previous.decision.outcome === "QUALIFIED_FOR_LEAGUE" && previous.paperDeployment == null) {
      return Object.freeze({ status: "RESUMED", record: this.deployQualified(previous) });
    }
    return Object.freeze({ status: "REPLAYED", record: previous });
  }

  private persistDecision(identity: ClosedLearningEvidenceIdentity, cycleId: string, decisionInput: ClosedLearningResearchDecision): ClosedLearningCycleResult {
    const decision = normalizeDecision(decisionInput);
    const recordedAt = this.now();
    if (!Number.isSafeInteger(recordedAt) || recordedAt < 0) throw new Error("closed learning clock is invalid");

    const decisionOnly = this.repository.append(Object.freeze({
      cycleId,
      evidenceId: identity.evidenceId,
      evidenceFingerprintSha256: identity.evidenceFingerprintSha256,
      decision,
      recordedAt,
    }));

    if (decision.outcome !== "QUALIFIED_FOR_LEAGUE") return Object.freeze({ status: "EXECUTED", record: decisionOnly });
    return Object.freeze({ status: "EXECUTED", record: this.deployQualified(decisionOnly) });
  }

  public run(input: ClosedLearningEvidenceIdentity): ClosedLearningCycleResult {
    const identity = normalizeIdentity(input);
    const cycleId = closedLearningCycleId(identity);
    const replay = this.existing(identity, cycleId);
    if (replay != null) return replay;
    return this.persistDecision(identity, cycleId, this.researchFactory.evaluate(Object.freeze({ ...identity, cycleId })));
  }

  /** Async production path prevents Research/League process execution from starving the HTTP loop. */
  public async runAsync(input: ClosedLearningEvidenceIdentity): Promise<ClosedLearningCycleResult> {
    const identity = normalizeIdentity(input);
    const cycleId = closedLearningCycleId(identity);
    const replay = this.existing(identity, cycleId);
    if (replay != null) return replay;
    const factory = this.researchFactory as ExistingResearchFactoryAdapter & Partial<Pick<AsyncExistingResearchFactoryAdapter, "evaluateAsync">>;
    const decision = factory.evaluateAsync == null
      ? factory.evaluate(Object.freeze({ ...identity, cycleId }))
      : await factory.evaluateAsync(Object.freeze({ ...identity, cycleId }));
    return this.persistDecision(identity, cycleId, decision);
  }
}
