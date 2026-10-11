import { createHash } from "node:crypto";
import {
  validatePaperObservedExecutionDepth,
  validatePaperObservedExecutionQuote,
  type PaperObservedExecutionQuote,
} from "../paperRuntimeExecutionCostEvidence";
import { JevShadowProvider, type JevFetch } from "./jevShadowProvider";

export const JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE = "MARKET_MICROSTRUCTURE_ADVISORY_SHADOW" as const;
export const JEV_MARKET_MICROSTRUCTURE_CONTRACT_VERSION = 1 as const;
export const JEV_MARKET_MICROSTRUCTURE_POLICY_VERSION = "market-microstructure-shadow-v1" as const;

export type JevMarketMicrostructureState =
  | "NORMAL"
  | "THIN_LIQUIDITY"
  | "WIDE_SPREAD"
  | "IMBALANCED_BOOK"
  | "ADVERSE_SELECTION_RISK"
  | "INSUFFICIENT_EVIDENCE";

export type JevMarketMicrostructureAction =
  | "OBSERVE"
  | "REDUCE_RISK"
  | "HOLD"
  | "ESCALATE";

export interface JevMarketMicrostructureModelOutput {
  readonly state: JevMarketMicrostructureState;
  readonly action: JevMarketMicrostructureAction;
  readonly confidence: number;
  readonly reasonCode: string;
}

export interface JevMarketMicrostructureFeatures {
  readonly market: string;
  readonly observedAt: number;
  readonly midPrice: number;
  readonly spreadBps: number;
  readonly topBookImbalance: number;
  readonly depthLevelCount: number;
  readonly depthBidSize: number | null;
  readonly depthAskSize: number | null;
  readonly depthImbalance: number | null;
  readonly quoteFingerprintSha256: string;
  readonly depthFingerprintSha256: string | null;
}

export interface JevMarketMicrostructureShadowInput {
  readonly task: typeof JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE;
  readonly decisionType: typeof JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE;
  readonly policyVersion: string;
  readonly features: JevMarketMicrostructureFeatures;
  readonly evidenceRefs: readonly string[];
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly usableForRouting: false;
}

export interface JevMarketMicrostructureShadowReceipt {
  readonly decisionId: string;
  readonly decisionType: typeof JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE;
  readonly contractVersion: typeof JEV_MARKET_MICROSTRUCTURE_CONTRACT_VERSION;
  readonly policyVersion: string;
  readonly market: string;
  readonly observedAt: number;
  readonly selectedState: JevMarketMicrostructureState;
  readonly selectedAction: JevMarketMicrostructureAction;
  readonly confidence: number;
  readonly reasonCode: string;
  readonly inputHash: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly timestamp: string;
  readonly shadow: true;
  readonly fallbackApplied: boolean;
  readonly failureReason?: string;
  readonly evidenceRefs: readonly string[];
  readonly usableForRouting: false;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const STATES = new Set<JevMarketMicrostructureState>([
  "NORMAL",
  "THIN_LIQUIDITY",
  "WIDE_SPREAD",
  "IMBALANCED_BOOK",
  "ADVERSE_SELECTION_RISK",
  "INSUFFICIENT_EVIDENCE",
]);
const ACTIONS = new Set<JevMarketMicrostructureAction>([
  "OBSERVE",
  "REDUCE_RISK",
  "HOLD",
  "ESCALATE",
]);
const REASON_CODE = /^[A-Z0-9_]{1,64}$/;
const round8 = (value: number): number => Number(value.toFixed(8));
const bounded = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildJevMarketMicrostructureFeatures(
  quoteInput: PaperObservedExecutionQuote,
  now: number = quoteInput.observedAt,
): JevMarketMicrostructureFeatures {
  const quote = validatePaperObservedExecutionQuote(quoteInput, quoteInput.market, now);
  const midPrice = (quote.bidPrice + quote.askPrice) / 2;
  if (!Number.isFinite(midPrice) || midPrice <= 0) throw new Error("JEV_MICROSTRUCTURE_MID_PRICE_INVALID");
  const spreadBps = round8(((quote.askPrice - quote.bidPrice) / midPrice) * 10_000);
  const bestBidSize = quote.receipt.bestBidSize;
  const bestAskSize = quote.receipt.bestAskSize;
  const topTotal = bestBidSize + bestAskSize;
  const topBookImbalance = topTotal <= 0 ? 0 : round8((bestBidSize - bestAskSize) / topTotal);

  let depthLevelCount = 0;
  let depthBidSize: number | null = null;
  let depthAskSize: number | null = null;
  let depthImbalance: number | null = null;
  if (quote.depth != null && quote.depthFingerprintSha256 != null) {
    const depth = validatePaperObservedExecutionDepth(quote, quote.market, now);
    depthLevelCount = depth.length;
    depthBidSize = round8(depth.reduce((sum, level) => sum + level.bidSize, 0));
    depthAskSize = round8(depth.reduce((sum, level) => sum + level.askSize, 0));
    const total = depthBidSize + depthAskSize;
    depthImbalance = total <= 0 ? 0 : round8((depthBidSize - depthAskSize) / total);
  }

  return Object.freeze({
    market: quote.market,
    observedAt: quote.observedAt,
    midPrice: round8(midPrice),
    spreadBps,
    topBookImbalance,
    depthLevelCount,
    depthBidSize,
    depthAskSize,
    depthImbalance,
    quoteFingerprintSha256: quote.evidenceFingerprintSha256,
    depthFingerprintSha256: quote.depthFingerprintSha256 ?? null,
  });
}

export function buildJevMarketMicrostructureShadowInput(
  quote: PaperObservedExecutionQuote,
  policyVersion: string = JEV_MARKET_MICROSTRUCTURE_POLICY_VERSION,
): JevMarketMicrostructureShadowInput {
  const features = buildJevMarketMicrostructureFeatures(quote);
  const evidenceRefs = Object.freeze([
    quote.evidenceId,
    quote.evidenceFingerprintSha256,
    ...(quote.depthFingerprintSha256 == null ? [] : [quote.depthFingerprintSha256]),
  ]);
  return Object.freeze({
    task: JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE,
    decisionType: JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE,
    policyVersion: bounded(policyVersion, 128) || JEV_MARKET_MICROSTRUCTURE_POLICY_VERSION,
    features,
    evidenceRefs,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
    usableForRouting: false,
  });
}

export function validateJevMarketMicrostructureDecision(value: unknown): JevMarketMicrostructureModelOutput {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("JEV_MICROSTRUCTURE_RESPONSE_MALFORMED");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).sort().join(",") !== "action,confidence,reasonCode,state") throw new Error("JEV_MICROSTRUCTURE_RESPONSE_MALFORMED");
  if (!STATES.has(source.state as JevMarketMicrostructureState)) throw new Error("JEV_MICROSTRUCTURE_STATE_INVALID");
  if (!ACTIONS.has(source.action as JevMarketMicrostructureAction)) throw new Error("JEV_MICROSTRUCTURE_ACTION_INVALID");
  if (typeof source.confidence !== "number" || !Number.isFinite(source.confidence) || source.confidence < 0 || source.confidence > 1) {
    throw new Error("JEV_MICROSTRUCTURE_CONFIDENCE_INVALID");
  }
  if (typeof source.reasonCode !== "string" || !REASON_CODE.test(source.reasonCode)) throw new Error("JEV_MICROSTRUCTURE_REASON_CODE_INVALID");
  return Object.freeze({
    state: source.state as JevMarketMicrostructureState,
    action: source.action as JevMarketMicrostructureAction,
    confidence: source.confidence,
    reasonCode: source.reasonCode,
  });
}

export interface JevMarketMicrostructureShadowObserverOptions {
  readonly minConfidence?: number;
  readonly modelIdentity?: string;
  readonly policyVersion?: string;
  readonly now?: () => string;
}

function fallbackReceipt(
  quote: PaperObservedExecutionQuote,
  input: JevMarketMicrostructureShadowInput,
  params: Readonly<{ model: string; latencyMs: number; timestamp: string; reasonCode: string; failureReason?: string }>,
): JevMarketMicrostructureShadowReceipt {
  return Object.freeze({
    decisionId: `jev-market-microstructure:${hash({ market: quote.market, observedAt: quote.observedAt, fingerprint: quote.evidenceFingerprintSha256 }).slice(0, 32)}`,
    decisionType: JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE,
    contractVersion: JEV_MARKET_MICROSTRUCTURE_CONTRACT_VERSION,
    policyVersion: input.policyVersion,
    market: quote.market,
    observedAt: quote.observedAt,
    selectedState: "INSUFFICIENT_EVIDENCE",
    selectedAction: "ESCALATE",
    confidence: 0,
    reasonCode: params.reasonCode,
    inputHash: hash(input),
    model: params.model,
    latencyMs: params.latencyMs,
    timestamp: params.timestamp,
    shadow: true,
    fallbackApplied: true,
    ...(params.failureReason == null ? {} : { failureReason: bounded(params.failureReason, 160) }),
    evidenceRefs: input.evidenceRefs,
    usableForRouting: false,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

export class JevMarketMicrostructureShadowObserver {
  private readonly minConfidence: number;
  private readonly modelIdentity: string;
  private readonly policyVersion: string;
  private readonly now: () => string;

  public constructor(
    private readonly classify: (input: Readonly<Record<string, unknown>>) => Promise<unknown>,
    options: JevMarketMicrostructureShadowObserverOptions = {},
  ) {
    this.minConfidence = options.minConfidence ?? 0.5;
    if (!Number.isFinite(this.minConfidence) || this.minConfidence < 0 || this.minConfidence > 1) throw new Error("JEV_MICROSTRUCTURE_MIN_CONFIDENCE_INVALID");
    this.modelIdentity = bounded(options.modelIdentity ?? "unknown", 128) || "unknown";
    this.policyVersion = bounded(options.policyVersion ?? JEV_MARKET_MICROSTRUCTURE_POLICY_VERSION, 128) || JEV_MARKET_MICROSTRUCTURE_POLICY_VERSION;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async observe(
    quote: PaperObservedExecutionQuote,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<JevMarketMicrostructureShadowReceipt> {
    const startedAt = Date.now();
    const input = buildJevMarketMicrostructureShadowInput(quote, this.policyVersion);
    const latency = (): number => Math.max(0, Date.now() - startedAt);
    if (env.NUSA_JEV_MARKET_MICROSTRUCTURE_SHADOW_ENABLED?.trim().toLowerCase() !== "true") {
      return fallbackReceipt(quote, input, { model: this.modelIdentity, latencyMs: latency(), timestamp: this.now(), reasonCode: "DISABLED" });
    }
    try {
      const decision = validateJevMarketMicrostructureDecision(await this.classify(input as unknown as Readonly<Record<string, unknown>>));
      if (decision.confidence < this.minConfidence) {
        return fallbackReceipt(quote, input, { model: this.modelIdentity, latencyMs: latency(), timestamp: this.now(), reasonCode: "LOW_CONFIDENCE_FALLBACK" });
      }
      return Object.freeze({
        decisionId: `jev-market-microstructure:${hash({ market: quote.market, observedAt: quote.observedAt, fingerprint: quote.evidenceFingerprintSha256 }).slice(0, 32)}`,
        decisionType: JEV_MARKET_MICROSTRUCTURE_DECISION_TYPE,
        contractVersion: JEV_MARKET_MICROSTRUCTURE_CONTRACT_VERSION,
        policyVersion: input.policyVersion,
        market: quote.market,
        observedAt: quote.observedAt,
        selectedState: decision.state,
        selectedAction: decision.action,
        confidence: decision.confidence,
        reasonCode: decision.reasonCode,
        inputHash: hash(input),
        model: this.modelIdentity,
        latencyMs: latency(),
        timestamp: this.now(),
        shadow: true,
        fallbackApplied: false,
        evidenceRefs: input.evidenceRefs,
        usableForRouting: false,
        authority: "PAPER_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      return fallbackReceipt(quote, input, {
        model: this.modelIdentity,
        latencyMs: latency(),
        timestamp: this.now(),
        reasonCode: name === "TimeoutError" ? "TIMEOUT" : name === "JevProviderUnavailableError" ? "PROVIDER_UNAVAILABLE" : "SHADOW_FAILURE",
        failureReason: name,
      });
    }
  }
}

export function createJevMarketMicrostructureShadowObserverFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: JevFetch,
): JevMarketMicrostructureShadowObserver | null {
  if (env.NUSA_JEV_MARKET_MICROSTRUCTURE_SHADOW_ENABLED?.trim().toLowerCase() !== "true") return null;
  const apiKey = env.NUSA_JEV_API_KEY?.trim();
  const endpoint = env.NUSA_JEV_ENDPOINT?.trim();
  if (!apiKey || !endpoint) return null;
  const rawTimeout = env.NUSA_JEV_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout == null || rawTimeout === "" ? 1500 : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) return null;
  try {
    const provider = new JevShadowProvider({ apiKey, endpoint, timeoutMs, ...(fetchImpl == null ? {} : { fetchImpl }) });
    return new JevMarketMicrostructureShadowObserver(
      (input) => provider.classify(input) as Promise<unknown>,
      { modelIdentity: bounded(env.NUSA_JEV_MODEL_IDENTITY ?? "unknown", 128) || "unknown" },
    );
  } catch {
    return null;
  }
}
