import { createHash } from "node:crypto";
import type { ClosedLearningCycleResult } from "../closedLearningLoopCoordinator";
import type { PaperPerformanceFromLedgerResult } from "../paperPerformanceFromLedger";
import { JevShadowProvider, type JevFetch } from "./jevShadowProvider";
import type { JevRequiredModel } from "./jevShadowRouter";

export const JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE =
  "PAPER_LEARNING_EVALUATION_SHADOW" as const;
export const JEV_PAPER_LEARNING_EVALUATION_SHADOW_CONTRACT_VERSION = 1 as const;
export const JEV_PAPER_LEARNING_EVALUATION_SHADOW_POLICY_VERSION =
  "paper-learning-evaluation-shadow-v1" as const;

export type JevPaperLearningReadiness =
  | "NO_EVIDENCE"
  | "INSUFFICIENT"
  | "READY"
  | "STALE"
  | "INVALID";

export interface JevPaperLearningModelOutput {
  readonly readiness: JevPaperLearningReadiness;
  readonly stalled: boolean;
  readonly requiredModel: JevRequiredModel;
  readonly reasonCode: string;
  readonly confidence: number;
}

export interface JevPaperLearningEvaluationContext {
  readonly periodId: string;
  readonly performance: PaperPerformanceFromLedgerResult | null;
  readonly cycle?: ClosedLearningCycleResult | null;
  readonly sourceFailureReason?: string | null;
}

export interface JevPaperLearningEvaluationShadowInput {
  readonly task: typeof JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE;
  readonly decisionType: typeof JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE;
  readonly policyVersion: string;
  readonly evidence: Readonly<{
    present: boolean;
    periodId: string;
    candidateId: string | null;
    strategyId: string | null;
    strategyVersion: string | null;
    familyId: string | null;
    periodStartAt: number | null;
    periodEndAt: number | null;
    observationCount: number | null;
    fillCount: number | null;
    sourceLedgerFingerprintSha256: string | null;
    evidenceFingerprintSha256: string | null;
    canonicalOutcomeReceiptFingerprint: string | null;
    calculationVersion: string | null;
    generatedAt: number | null;
    deterministicReadiness: JevPaperLearningReadiness;
  }>;
  readonly evaluation: Readonly<{
    evaluated: boolean;
    cycleStatus: ClosedLearningCycleResult["status"] | null;
    cycleOutcome: ClosedLearningCycleResult["record"]["decision"]["outcome"] | null;
    cycleRecordedAt: number | null;
    stalledByPolicy: boolean;
  }>;
  readonly evidenceRefs: readonly string[];
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly usableForRouting: false;
}

export interface JevPaperLearningEvaluationShadowReceipt {
  readonly decisionId: string;
  readonly decisionType: typeof JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE;
  readonly contractVersion: typeof JEV_PAPER_LEARNING_EVALUATION_SHADOW_CONTRACT_VERSION;
  readonly policyVersion: string;
  readonly periodId: string;
  readonly evidenceFingerprintSha256: string | null;
  readonly sourceLedgerFingerprintSha256: string | null;
  readonly deterministicReadiness: JevPaperLearningReadiness;
  readonly selectedReadiness: JevPaperLearningReadiness;
  readonly stalled: boolean;
  readonly requiredModel: JevRequiredModel;
  readonly confidence: number;
  readonly reasonCode: string;
  readonly model: string;
  readonly inputHash: string;
  readonly latencyMs: number;
  readonly costEvidence: "NOT_MEASURED";
  readonly timestamp: string;
  readonly shadow: true;
  readonly fallbackApplied: boolean;
  readonly failureReason?: string;
  readonly evidenceRefs: readonly string[];
  readonly canonicalMetricsCalculated: false;
  readonly canonicalEvidenceMutated: false;
  readonly usableForRouting: false;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface JevPaperLearningEvaluationShadowObserverOptions {
  readonly minConfidence?: number;
  readonly maxEvidenceAgeMs?: number;
  readonly stalledAfterMs?: number;
  readonly policyVersion?: string;
  readonly modelIdentity?: string;
  readonly nowMs?: () => number;
  readonly nowIso?: () => string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const REASON_CODE = /^[A-Za-z0-9_]{1,64}$/;
const READINESS = new Set<JevPaperLearningReadiness>([
  "NO_EVIDENCE",
  "INSUFFICIENT",
  "READY",
  "STALE",
  "INVALID",
]);
const MODELS = new Set<JevRequiredModel>(["LUNA", "TERRA", "SOL", "ASTRA", "HUMAN"]);
const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALLED_AFTER_MS = 6 * 60 * 60 * 1000;

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";
const bounded = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Jev PAPER learning input contains non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  throw new Error("Jev PAPER learning input contains unsupported value");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function safePeriodId(value: string): string {
  const normalized = bounded(value, 240);
  if (!normalized || !/^[A-Za-z0-9_.:/#@-]{1,240}$/.test(normalized)) {
    throw new Error("Jev PAPER learning period identity invalid");
  }
  return normalized;
}

function performanceIsStructurallyValid(result: PaperPerformanceFromLedgerResult): boolean {
  const evidence = result?.evidence;
  const ledger = result?.ledgerSource;
  return evidence != null
    && evidence.schemaVersion === 1
    && evidence.evidenceKind === "PAPER"
    && evidence.authority === "PAPER_ONLY"
    && evidence.liveAuthority === "NONE"
    && evidence.productionMutationAllowed === false
    && evidence.aiAuthority === "ZERO_AUTHORITY"
    && typeof result.familyId === "string"
    && result.familyId.trim().length > 0
    && SHA256.test(evidence.evidenceFingerprintSha256)
    && SHA256.test(evidence.sourceLedgerFingerprintSha256)
    && SHA256.test(result.canonicalOutcomeReceiptFingerprint)
    && ledger != null
    && SHA256.test(ledger.ledgerFingerprintSha256)
    && ledger.ledgerFingerprintSha256 === evidence.sourceLedgerFingerprintSha256
    && Number.isSafeInteger(evidence.periodStartAt)
    && Number.isSafeInteger(evidence.periodEndAt)
    && evidence.periodEndAt > evidence.periodStartAt
    && Number.isSafeInteger(evidence.generatedAt)
    && Number.isSafeInteger(evidence.observationCount)
    && Number.isSafeInteger(evidence.fillCount);
}

function deterministicReadiness(
  context: JevPaperLearningEvaluationContext,
  nowMs: number,
  maxEvidenceAgeMs: number,
): JevPaperLearningReadiness {
  if (context.sourceFailureReason?.trim()) return "INVALID";
  if (context.performance == null) return "NO_EVIDENCE";
  if (!performanceIsStructurallyValid(context.performance)) return "INVALID";
  const evidence = context.performance.evidence;
  if (evidence.observationCount < 2 || evidence.fillCount < 1) return "INSUFFICIENT";
  if (nowMs < evidence.generatedAt) return "INVALID";
  if (nowMs - evidence.generatedAt > maxEvidenceAgeMs) return "STALE";
  return "READY";
}

function stalledByPolicy(
  context: JevPaperLearningEvaluationContext,
  readiness: JevPaperLearningReadiness,
  nowMs: number,
  stalledAfterMs: number,
): boolean {
  if (readiness !== "READY" && readiness !== "INSUFFICIENT") return false;
  if (context.cycle != null) return false;
  const generatedAt = context.performance?.evidence.generatedAt;
  return Number.isSafeInteger(generatedAt) && nowMs >= generatedAt! && nowMs - generatedAt! >= stalledAfterMs;
}

export function validateJevPaperLearningModelOutput(value: unknown): JevPaperLearningModelOutput {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Jev PAPER learning response malformed");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(",") !== "confidence,readiness,reasonCode,requiredModel,stalled") {
    throw new Error("Jev PAPER learning response malformed");
  }
  if (!READINESS.has(source.readiness as JevPaperLearningReadiness)) {
    throw new Error("Jev PAPER learning readiness invalid");
  }
  if (typeof source.stalled !== "boolean") throw new Error("Jev PAPER learning stalled flag invalid");
  if (!MODELS.has(source.requiredModel as JevRequiredModel)) {
    throw new Error("Jev PAPER learning required model invalid");
  }
  if (typeof source.reasonCode !== "string" || !REASON_CODE.test(source.reasonCode)) {
    throw new Error("Jev PAPER learning reasonCode invalid");
  }
  if (
    typeof source.confidence !== "number"
    || !Number.isFinite(source.confidence)
    || source.confidence < 0
    || source.confidence > 1
  ) {
    throw new Error("Jev PAPER learning confidence invalid");
  }
  return Object.freeze({
    readiness: source.readiness as JevPaperLearningReadiness,
    stalled: source.stalled,
    requiredModel: source.requiredModel as JevRequiredModel,
    reasonCode: source.reasonCode,
    confidence: source.confidence,
  });
}

export function buildJevPaperLearningEvaluationShadowInput(
  context: JevPaperLearningEvaluationContext,
  options: Pick<JevPaperLearningEvaluationShadowObserverOptions, "maxEvidenceAgeMs" | "stalledAfterMs" | "policyVersion" | "nowMs"> = {},
): JevPaperLearningEvaluationShadowInput {
  const periodId = safePeriodId(context.periodId);
  const nowMs = (options.nowMs ?? Date.now)();
  const maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
  const stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Jev PAPER learning clock invalid");
  if (!Number.isSafeInteger(maxEvidenceAgeMs) || maxEvidenceAgeMs < 0) throw new Error("Jev PAPER learning max evidence age invalid");
  if (!Number.isSafeInteger(stalledAfterMs) || stalledAfterMs < 0) throw new Error("Jev PAPER learning stalled threshold invalid");

  const readiness = deterministicReadiness(context, nowMs, maxEvidenceAgeMs);
  const stalled = stalledByPolicy(context, readiness, nowMs, stalledAfterMs);
  const performance = context.performance;
  const evidence = performance?.evidence ?? null;
  const policyVersion =
    bounded(options.policyVersion ?? JEV_PAPER_LEARNING_EVALUATION_SHADOW_POLICY_VERSION, 128)
    || JEV_PAPER_LEARNING_EVALUATION_SHADOW_POLICY_VERSION;
  const refs = performance == null
    ? Object.freeze([periodId])
    : Object.freeze([
        periodId,
        performance.evidence.evidenceFingerprintSha256,
        performance.evidence.sourceLedgerFingerprintSha256,
        performance.canonicalOutcomeReceiptFingerprint,
      ]);

  return Object.freeze({
    task: JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE,
    decisionType: JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE,
    policyVersion,
    evidence: Object.freeze({
      present: performance != null,
      periodId,
      candidateId: evidence?.candidateId ?? null,
      strategyId: evidence?.strategyId ?? null,
      strategyVersion: evidence?.strategyVersion ?? null,
      familyId: performance?.familyId ?? null,
      periodStartAt: evidence?.periodStartAt ?? null,
      periodEndAt: evidence?.periodEndAt ?? null,
      observationCount: evidence?.observationCount ?? null,
      fillCount: evidence?.fillCount ?? null,
      sourceLedgerFingerprintSha256: evidence?.sourceLedgerFingerprintSha256 ?? null,
      evidenceFingerprintSha256: evidence?.evidenceFingerprintSha256 ?? null,
      canonicalOutcomeReceiptFingerprint: performance?.canonicalOutcomeReceiptFingerprint ?? null,
      calculationVersion: evidence?.calculationVersion ?? null,
      generatedAt: evidence?.generatedAt ?? null,
      deterministicReadiness: readiness,
    }),
    evaluation: Object.freeze({
      evaluated: context.cycle != null,
      cycleStatus: context.cycle?.status ?? null,
      cycleOutcome: context.cycle?.record.decision.outcome ?? null,
      cycleRecordedAt: context.cycle?.record.recordedAt ?? null,
      stalledByPolicy: stalled,
    }),
    evidenceRefs: refs,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
    usableForRouting: false as const,
  });
}

function fallbackReceipt(params: {
  input: JevPaperLearningEvaluationShadowInput;
  inputHash: string;
  latencyMs: number;
  model: string;
  timestamp: string;
  reasonCode: string;
  failureReason?: string;
}): JevPaperLearningEvaluationShadowReceipt {
  const evidence = params.input.evidence;
  return Object.freeze({
    decisionId: "jev-paper-learning:" + sha256({
      periodId: evidence.periodId,
      evidenceFingerprintSha256: evidence.evidenceFingerprintSha256,
      policyVersion: params.input.policyVersion,
    }).slice(0, 32),
    decisionType: JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE,
    contractVersion: JEV_PAPER_LEARNING_EVALUATION_SHADOW_CONTRACT_VERSION,
    policyVersion: params.input.policyVersion,
    periodId: evidence.periodId,
    evidenceFingerprintSha256: evidence.evidenceFingerprintSha256,
    sourceLedgerFingerprintSha256: evidence.sourceLedgerFingerprintSha256,
    deterministicReadiness: evidence.deterministicReadiness,
    selectedReadiness: evidence.deterministicReadiness,
    stalled: params.input.evaluation.stalledByPolicy,
    requiredModel: "HUMAN" as const,
    confidence: 0,
    reasonCode: params.reasonCode,
    model: params.model,
    inputHash: params.inputHash,
    latencyMs: params.latencyMs,
    costEvidence: "NOT_MEASURED" as const,
    timestamp: params.timestamp,
    shadow: true as const,
    fallbackApplied: true,
    ...(params.failureReason == null ? {} : { failureReason: bounded(params.failureReason, 160) }),
    evidenceRefs: params.input.evidenceRefs,
    canonicalMetricsCalculated: false as const,
    canonicalEvidenceMutated: false as const,
    usableForRouting: false as const,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

export class JevPaperLearningEvaluationShadowObserver {
  private readonly minConfidence: number;
  private readonly maxEvidenceAgeMs: number;
  private readonly stalledAfterMs: number;
  private readonly policyVersion: string;
  private readonly modelIdentity: string;
  private readonly nowMs: () => number;
  private readonly nowIso: () => string;

  public constructor(
    private readonly classify: (input: Readonly<Record<string, unknown>>) => Promise<unknown>,
    options: JevPaperLearningEvaluationShadowObserverOptions = {},
  ) {
    this.minConfidence = options.minConfidence ?? 0.5;
    this.maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
    this.stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
    this.policyVersion =
      bounded(options.policyVersion ?? JEV_PAPER_LEARNING_EVALUATION_SHADOW_POLICY_VERSION, 128)
      || JEV_PAPER_LEARNING_EVALUATION_SHADOW_POLICY_VERSION;
    this.modelIdentity = bounded(options.modelIdentity ?? "unknown", 128) || "unknown";
    this.nowMs = options.nowMs ?? Date.now;
    this.nowIso = options.nowIso ?? (() => new Date(this.nowMs()).toISOString());
    if (!Number.isFinite(this.minConfidence) || this.minConfidence < 0 || this.minConfidence > 1) {
      throw new Error("Jev PAPER learning confidence threshold invalid");
    }
    if (!Number.isSafeInteger(this.maxEvidenceAgeMs) || this.maxEvidenceAgeMs < 0) {
      throw new Error("Jev PAPER learning max evidence age invalid");
    }
    if (!Number.isSafeInteger(this.stalledAfterMs) || this.stalledAfterMs < 0) {
      throw new Error("Jev PAPER learning stalled threshold invalid");
    }
  }

  public async observe(
    context: JevPaperLearningEvaluationContext,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<JevPaperLearningEvaluationShadowReceipt> {
    const startedAt = this.nowMs();
    const input = buildJevPaperLearningEvaluationShadowInput(context, {
      maxEvidenceAgeMs: this.maxEvidenceAgeMs,
      stalledAfterMs: this.stalledAfterMs,
      policyVersion: this.policyVersion,
      nowMs: this.nowMs,
    });
    const inputHash = sha256(input);
    const latency = (): number => Math.max(0, this.nowMs() - startedAt);
    const fallback = (reasonCode: string, failureReason?: string) =>
      fallbackReceipt({
        input,
        inputHash,
        latencyMs: latency(),
        model: this.modelIdentity,
        timestamp: this.nowIso(),
        reasonCode,
        ...(failureReason == null ? {} : { failureReason }),
      });

    if (!enabled(env.NUSA_JEV_PAPER_LEARNING_SHADOW_ENABLED)) return fallback("DISABLED");
    if (input.evidence.deterministicReadiness === "NO_EVIDENCE") return fallback("NO_EVIDENCE");
    if (input.evidence.deterministicReadiness === "STALE") return fallback("STALE_EVIDENCE");
    if (input.evidence.deterministicReadiness === "INVALID") return fallback("INVALID_EVIDENCE");

    try {
      const validated = validateJevPaperLearningModelOutput(
        await this.classify(input as unknown as Readonly<Record<string, unknown>>),
      );
      if (validated.confidence < this.minConfidence) return fallback("LOW_CONFIDENCE_FALLBACK");
      return Object.freeze({
        decisionId: "jev-paper-learning:" + sha256({
          periodId: input.evidence.periodId,
          evidenceFingerprintSha256: input.evidence.evidenceFingerprintSha256,
          policyVersion: input.policyVersion,
        }).slice(0, 32),
        decisionType: JEV_PAPER_LEARNING_EVALUATION_SHADOW_DECISION_TYPE,
        contractVersion: JEV_PAPER_LEARNING_EVALUATION_SHADOW_CONTRACT_VERSION,
        policyVersion: input.policyVersion,
        periodId: input.evidence.periodId,
        evidenceFingerprintSha256: input.evidence.evidenceFingerprintSha256,
        sourceLedgerFingerprintSha256: input.evidence.sourceLedgerFingerprintSha256,
        deterministicReadiness: input.evidence.deterministicReadiness,
        selectedReadiness: validated.readiness,
        stalled: validated.stalled,
        requiredModel: validated.requiredModel,
        confidence: validated.confidence,
        reasonCode: validated.reasonCode,
        model: this.modelIdentity,
        inputHash,
        latencyMs: latency(),
        costEvidence: "NOT_MEASURED" as const,
        timestamp: this.nowIso(),
        shadow: true as const,
        fallbackApplied: false,
        evidenceRefs: input.evidenceRefs,
        canonicalMetricsCalculated: false as const,
        canonicalEvidenceMutated: false as const,
        usableForRouting: false as const,
        authority: "PAPER_ONLY" as const,
        liveAuthority: "NONE" as const,
        productionMutationAllowed: false as const,
        aiAuthority: "ZERO_AUTHORITY" as const,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      const reasonCode =
        name === "TimeoutError"
          ? "TIMEOUT"
          : name === "JevProviderUnavailableError"
            ? "PROVIDER_UNAVAILABLE"
            : name === "MalformedJevResponseError"
              ? "MALFORMED_RESPONSE"
              : "SHADOW_FAILURE";
      return fallback(reasonCode, name);
    }
  }
}

function positiveSafeInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createJevPaperLearningEvaluationShadowObserverFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: JevFetch,
): JevPaperLearningEvaluationShadowObserver | null {
  if (!enabled(env.NUSA_JEV_PAPER_LEARNING_SHADOW_ENABLED)) return null;
  const apiKey = env.NUSA_JEV_API_KEY?.trim();
  const endpoint = env.NUSA_JEV_ENDPOINT?.trim();
  if (!apiKey || !endpoint) return null;
  const rawTimeout = env.NUSA_JEV_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout == null || rawTimeout === "" ? 1500 : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) return null;
  const modelIdentity = bounded(env.NUSA_JEV_MODEL_IDENTITY ?? "unknown", 128) || "unknown";
  let provider: JevShadowProvider;
  try {
    provider = new JevShadowProvider({
      apiKey,
      endpoint,
      timeoutMs,
      ...(fetchImpl == null ? {} : { fetchImpl }),
    });
  } catch {
    return null;
  }
  return new JevPaperLearningEvaluationShadowObserver(
    (input: Readonly<Record<string, unknown>>): Promise<unknown> =>
      provider.classify(input) as Promise<unknown>,
    {
      modelIdentity,
      maxEvidenceAgeMs: positiveSafeInteger(
        env.NUSA_JEV_PAPER_LEARNING_MAX_EVIDENCE_AGE_MS,
        DEFAULT_MAX_EVIDENCE_AGE_MS,
      ),
      stalledAfterMs: positiveSafeInteger(
        env.NUSA_JEV_PAPER_LEARNING_STALLED_AFTER_MS,
        DEFAULT_STALLED_AFTER_MS,
      ),
    },
  );
}
