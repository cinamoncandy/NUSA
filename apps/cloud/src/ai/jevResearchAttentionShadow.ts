import { createHash } from "node:crypto";
import type {
  ResearchIntelligenceRecord,
  ResearchIntelligenceRelevance,
} from "../../../../packages/contracts/src/researchIntelligence";
import { canonicalResearchJson } from "../../../../packages/contracts/src/researchRuntime";
import { JevShadowProvider, type JevFetch } from "./jevShadowProvider";

export const JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE =
  "RESEARCH_INTELLIGENCE_ATTENTION_SHADOW" as const;
export const JEV_RESEARCH_ATTENTION_SHADOW_CONTRACT_VERSION = 1 as const;
export const JEV_RESEARCH_ATTENTION_SHADOW_POLICY_VERSION = "ri-attention-shadow-v1" as const;

export type JevResearchAttentionDecision = "REVIEW_SOON" | "DEFER" | "ESCALATE_UNCERTAIN";

export type JevResearchAttentionAxiomOutcome =
  | "HANDOFF"
  | "NOT_HANDOFF"
  | "DUPLICATE_SUPPRESSED"
  | "HANDOFF_FAILED_CLOSED";

export interface JevResearchAttentionModelOutput {
  readonly decision: JevResearchAttentionDecision;
  readonly confidence: number;
  readonly reasonCode: string;
}

export interface JevResearchAttentionShadowInput {
  readonly task: typeof JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE;
  readonly decisionType: typeof JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE;
  readonly policyVersion: string;
  readonly candidate: Readonly<{
    recordId: string;
    sourceType: string;
    sourceVerification: string;
    topics: readonly string[];
    method: string;
    novelty: string;
    deterministicRelevance: ResearchIntelligenceRelevance;
    codeAvailable: string;
    datasetAvailable: string;
    evidenceQuality: string;
    reproducibilityStatus: string;
  }>;
  readonly untrustedExternalData: Readonly<{
    dataOnly: true;
    title: string;
    claimedContribution: string;
    testableHypothesis: string;
  }>;
  readonly evidenceRefs: readonly string[];
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly usableForRouting: false;
}

export interface JevResearchAttentionShadowReceipt {
  readonly decisionId: string;
  readonly decisionType: typeof JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE;
  readonly contractVersion: typeof JEV_RESEARCH_ATTENTION_SHADOW_CONTRACT_VERSION;
  readonly policyVersion: string;
  readonly sourceRecordId: string;
  readonly sourceContentFingerprint: string;
  readonly deterministicRelevance: ResearchIntelligenceRelevance;
  readonly axiomHandoffOutcome: JevResearchAttentionAxiomOutcome;
  readonly selectedDecision: JevResearchAttentionDecision;
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
  readonly axiomConsumed: "CONSUMED" | "NOT_CONSUMED" | "UNKNOWN";
  readonly linkedHypothesisId: string | null;
  readonly linkedOutcomeId: string | null;
  readonly usableForRouting: false;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const DECISIONS = new Set<JevResearchAttentionDecision>([
  "REVIEW_SOON",
  "DEFER",
  "ESCALATE_UNCERTAIN",
]);

const REASON_CODE = /^[A-Za-z0-9_]{1,64}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const bounded = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);
const truncateData = (value: string, maxLength = 2000): string => value.slice(0, maxLength);

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
}

export function buildJevResearchAttentionShadowInput(
  record: ResearchIntelligenceRecord,
  policyVersion: string = JEV_RESEARCH_ATTENTION_SHADOW_POLICY_VERSION,
): JevResearchAttentionShadowInput {
  const policy = bounded(policyVersion, 128) || JEV_RESEARCH_ATTENTION_SHADOW_POLICY_VERSION;
  return Object.freeze({
    task: JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE,
    decisionType: JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE,
    policyVersion: policy,
    candidate: Object.freeze({
      recordId: record.recordId,
      sourceType: record.sourceType,
      sourceVerification: record.sourceVerification,
      topics: Object.freeze([...record.topic]),
      method: record.method,
      novelty: record.novelty,
      deterministicRelevance: record.nusaRelevance,
      codeAvailable: record.codeAvailable,
      datasetAvailable: record.datasetAvailable,
      evidenceQuality: record.evidenceQuality,
      reproducibilityStatus: record.reproducibilityStatus,
    }),
    untrustedExternalData: Object.freeze({
      dataOnly: true as const,
      title: truncateData(record.title, 2000),
      claimedContribution: truncateData(record.claimedContribution, 4000),
      testableHypothesis: truncateData(record.testableHypothesis, 4000),
    }),
    evidenceRefs: Object.freeze([record.recordId, record.contentFingerprint]),
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
    usableForRouting: false as const,
  });
}

export function validateJevResearchAttentionShadowDecision(
  value: unknown,
): JevResearchAttentionModelOutput {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Jev attention shadow response malformed");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(",") !== "confidence,decision,reasonCode") {
    throw new Error("Jev attention shadow response malformed");
  }
  if (!DECISIONS.has(source.decision as JevResearchAttentionDecision)) {
    throw new Error("Jev attention shadow decision invalid");
  }
  if (
    typeof source.confidence !== "number" ||
    !Number.isFinite(source.confidence) ||
    source.confidence < 0 ||
    source.confidence > 1
  ) {
    throw new Error("Jev attention shadow confidence invalid");
  }
  if (typeof source.reasonCode !== "string" || !REASON_CODE.test(source.reasonCode)) {
    throw new Error("Jev attention shadow reasonCode invalid");
  }
  return Object.freeze({
    decision: source.decision as JevResearchAttentionDecision,
    confidence: source.confidence as number,
    reasonCode: source.reasonCode as string,
  });
}

export interface JevResearchAttentionShadowObserverOptions {
  readonly minConfidence?: number;
  readonly policyVersion?: string;
  readonly modelIdentity?: string;
  readonly now?: () => string;
}

const isEnabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

function fallbackReceipt(params: {
  record: ResearchIntelligenceRecord;
  axiomHandoffOutcome: JevResearchAttentionAxiomOutcome;
  inputHash: string;
  latencyMs: number;
  policyVersion: string;
  model: string;
  timestamp: string;
  reasonCode: string;
  failureReason?: string;
}): JevResearchAttentionShadowReceipt {
  const decisionId =
    "jev-ri-attention:" +
    sha256Hex({
      recordId: params.record.recordId,
      contentFingerprint: params.record.contentFingerprint,
    }).slice(0, 32);
  return Object.freeze({
    decisionId,
    decisionType: JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE,
    contractVersion: JEV_RESEARCH_ATTENTION_SHADOW_CONTRACT_VERSION,
    policyVersion: params.policyVersion,
    sourceRecordId: params.record.recordId,
    sourceContentFingerprint: params.record.contentFingerprint,
    deterministicRelevance: params.record.nusaRelevance,
    axiomHandoffOutcome: params.axiomHandoffOutcome,
    selectedDecision: "ESCALATE_UNCERTAIN" as const,
    confidence: 0,
    reasonCode: params.reasonCode,
    model: params.model,
    inputHash: params.inputHash,
    latencyMs: params.latencyMs,
    costEvidence: "NOT_MEASURED" as const,
    timestamp: params.timestamp,
    shadow: true as const,
    fallbackApplied: true,
    ...(params.failureReason == null
      ? {}
      : { failureReason: bounded(params.failureReason, 160) }),
    evidenceRefs: Object.freeze([params.record.recordId, params.record.contentFingerprint]),
    axiomConsumed: "UNKNOWN" as const,
    linkedHypothesisId: null,
    linkedOutcomeId: null,
    usableForRouting: false as const,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

export class JevResearchAttentionShadowObserver {
  private readonly minConfidence: number;
  private readonly policyVersion: string;
  private readonly modelIdentity: string;
  private readonly now: () => string;

  public constructor(
    private readonly classify: (input: Readonly<Record<string, unknown>>) => Promise<unknown>,
    options: JevResearchAttentionShadowObserverOptions = {},
  ) {
    const minConfidence = options.minConfidence ?? 0.5;
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
      throw new Error("Jev attention confidence threshold invalid");
    }
    this.minConfidence = minConfidence;
    this.policyVersion =
      bounded(options.policyVersion ?? JEV_RESEARCH_ATTENTION_SHADOW_POLICY_VERSION, 128) ||
      JEV_RESEARCH_ATTENTION_SHADOW_POLICY_VERSION;
    this.modelIdentity = bounded(options.modelIdentity ?? "unknown", 128) || "unknown";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async observe(
    record: ResearchIntelligenceRecord,
    axiomHandoffOutcome: JevResearchAttentionAxiomOutcome,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<JevResearchAttentionShadowReceipt> {
    const startedAt = Date.now();
    const input = buildJevResearchAttentionShadowInput(record, this.policyVersion);
    const inputHash = sha256Hex(input);
    const latency = (): number => Math.max(0, Date.now() - startedAt);

    if (!isEnabled(env.NUSA_JEV_RESEARCH_ATTENTION_SHADOW_ENABLED)) {
      return fallbackReceipt({
        record,
        axiomHandoffOutcome,
        inputHash,
        latencyMs: latency(),
        policyVersion: this.policyVersion,
        model: this.modelIdentity,
        timestamp: this.now(),
        reasonCode: "DISABLED",
      });
    }

    try {
      const raw = await this.classify(input as unknown as Readonly<Record<string, unknown>>);
      const validated = validateJevResearchAttentionShadowDecision(raw);
      if (validated.confidence < this.minConfidence) {
        return fallbackReceipt({
          record,
          axiomHandoffOutcome,
          inputHash,
          latencyMs: latency(),
          policyVersion: this.policyVersion,
          model: this.modelIdentity,
          timestamp: this.now(),
          reasonCode: "LOW_CONFIDENCE_FALLBACK",
        });
      }
      const decisionId =
        "jev-ri-attention:" +
        sha256Hex({
          recordId: record.recordId,
          contentFingerprint: record.contentFingerprint,
        }).slice(0, 32);
      return Object.freeze({
        decisionId,
        decisionType: JEV_RESEARCH_ATTENTION_SHADOW_DECISION_TYPE,
        contractVersion: JEV_RESEARCH_ATTENTION_SHADOW_CONTRACT_VERSION,
        policyVersion: this.policyVersion,
        sourceRecordId: record.recordId,
        sourceContentFingerprint: record.contentFingerprint,
        deterministicRelevance: record.nusaRelevance,
        axiomHandoffOutcome,
        selectedDecision: validated.decision,
        confidence: validated.confidence,
        reasonCode: validated.reasonCode,
        model: this.modelIdentity,
        inputHash,
        latencyMs: latency(),
        costEvidence: "NOT_MEASURED" as const,
        timestamp: this.now(),
        shadow: true as const,
        fallbackApplied: false,
        evidenceRefs: Object.freeze([record.recordId, record.contentFingerprint]),
        axiomConsumed: "UNKNOWN" as const,
        linkedHypothesisId: null,
        linkedOutcomeId: null,
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
      return fallbackReceipt({
        record,
        axiomHandoffOutcome,
        inputHash,
        latencyMs: latency(),
        policyVersion: this.policyVersion,
        model: this.modelIdentity,
        timestamp: this.now(),
        reasonCode,
        failureReason: bounded(name, 160),
      });
    }
  }
}

export function summarizeJevResearchAttentionShadows(
  receipts: readonly JevResearchAttentionShadowReceipt[],
): Readonly<{
  evaluated: number;
  reviewSoon: number;
  defer: number;
  escalateUncertain: number;
  fallbackApplied: number;
}> {
  let reviewSoon = 0;
  let defer = 0;
  let escalateUncertain = 0;
  let fallbackApplied = 0;
  for (const receipt of receipts) {
    if (receipt.selectedDecision === "REVIEW_SOON") reviewSoon += 1;
    else if (receipt.selectedDecision === "DEFER") defer += 1;
    else escalateUncertain += 1;
    if (receipt.fallbackApplied) fallbackApplied += 1;
  }
  return Object.freeze({
    evaluated: receipts.length,
    reviewSoon,
    defer,
    escalateUncertain,
    fallbackApplied,
  });
}

export function linkJevResearchAttentionOutcome(
  receipt: JevResearchAttentionShadowReceipt,
  outcome: Readonly<{
    axiomConsumed: "CONSUMED" | "NOT_CONSUMED" | "UNKNOWN";
    hypothesisId?: string | null;
    outcomeId?: string | null;
  }>,
): JevResearchAttentionShadowReceipt {
  if (outcome.axiomConsumed === "UNKNOWN") return receipt;
  const hypothesisId =
    outcome.hypothesisId == null ? null : bounded(String(outcome.hypothesisId), 256) || null;
  const outcomeId =
    outcome.outcomeId == null ? null : bounded(String(outcome.outcomeId), 256) || null;
  return Object.freeze({
    ...receipt,
    axiomConsumed: outcome.axiomConsumed,
    linkedHypothesisId: hypothesisId,
    linkedOutcomeId: outcomeId,
  });
}

export function assertJevResearchAttentionShadowInputHash(
  receipt: JevResearchAttentionShadowReceipt,
  record: ResearchIntelligenceRecord,
  policyVersion: string = receipt.policyVersion,
): void {
  const expected = sha256Hex(buildJevResearchAttentionShadowInput(record, policyVersion));
  if (!SHA256_HEX.test(receipt.inputHash) || receipt.inputHash !== expected) {
    throw new Error("Jev attention shadow input hash mismatch");
  }
}

export function createJevResearchAttentionShadowObserverFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: JevFetch,
): JevResearchAttentionShadowObserver | null {
  if (!isEnabled(env.NUSA_JEV_RESEARCH_ATTENTION_SHADOW_ENABLED)) return null;
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
  return new JevResearchAttentionShadowObserver(
    (input: Readonly<Record<string, unknown>>): Promise<unknown> =>
      provider.classify(input) as Promise<unknown>,
    { modelIdentity },
  );
}
