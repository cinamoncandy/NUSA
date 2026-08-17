import { EvidenceQuality, type AgentEvidence } from "../../../../packages/contracts/src/multiAgentGovernance";
import { aiSha256, type AiEvidenceMaterialization, type ModelProvider, type ModelRequest, type StructuredAgentOutput } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceResourceController } from "../../../../packages/contracts/src/aiInferenceResources";
import type { AiProviderStrategyProjection } from "../../../../packages/contracts/src/aiProviderDiversity";
import type { AiScenarioMaterialization } from "../../../../packages/contracts/src/aiScenarioReasoning";
import { AgentExecutor } from "./agentExecutor";
import { buildEvidenceBundle } from "./evidenceBundleBuilder";
import { createDefaultPromptArtifactRegistry, type PromptArtifactRegistry } from "./promptArtifactRegistry";
import type { AiScenarioRunOutput, AiScenarioRunner } from "./scenarioCounterfactualEvaluator";

/**
 * Bridges WO-AI-008's ScenarioCounterfactualEvaluator (built, tested, never instantiated by
 * runtime.ts) to a real single-role STRATEGY_PROPOSER call, sharing the evaluator's own resource
 * ledger exactly as its "one enclosing resource budget" design requires -- this is why the runner
 * calls AgentExecutor directly instead of the 4-role MultiAgentOrchestrator, which owns its own
 * separate ledger and cannot share one externally.
 *
 * The only supported intervention dimension is a bounded percentage shock applied to the
 * baseline's real, already-verified market price -- never a fabricated market. Reconstructed
 * evidence always carries sourceReference "nusa-ai-scenario-market-projection" (never
 * "upbit-public-ticker"), so it can never be mistaken for a real calibration anchor by
 * verifiedMarketAnchor() in runtime.ts.
 */
export const CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION = "market.priceShockPercent";

const text = (value: unknown, field: string): string => { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); return value.trim(); };
const strings = (value: unknown, field: string): readonly string[] => { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field} must be a string array`); return Object.freeze([...new Set(value as string[])].map((item) => item.trim()).sort()); };
const boundedProbability = (value: unknown, field: string): number => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be finite and within [0,1]`); return value; };

function validateStrategyProposerOutput(value: unknown): StructuredAgentOutput {
  if (value == null || typeof value !== "object") throw new Error("structured output must be an object");
  const candidate = value as Partial<StructuredAgentOutput>;
  if (candidate.schemaVersion !== 1 || candidate.role !== "STRATEGY_PROPOSER" || !Array.isArray(candidate.evidenceReferences) || candidate.payload == null || typeof candidate.payload !== "object") throw new Error("structured output schema violation");
  const payload = candidate.payload as Record<string, unknown>;
  if (!["candidate", "no_action", "insufficient_evidence"].includes(String(payload.decision))) throw new Error("scenario strategy decision is invalid");
  text(payload.uncertainty, "uncertainty");
  strings(payload.rationaleClaims, "rationaleClaims");
  strings(payload.assumptions ?? [], "assumptions");
  boundedProbability(payload.rawProbability, "rawProbability");
  const evidenceReferences = strings(candidate.evidenceReferences, "evidenceReferences");
  return Object.freeze({ schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences, payload: Object.freeze({ ...payload }) });
}

function toProjection(output: StructuredAgentOutput): AiProviderStrategyProjection {
  const payload = output.payload;
  return Object.freeze({
    decision: payload.decision as AiProviderStrategyProjection["decision"],
    rawProbability: payload.rawProbability as number,
    uncertainty: text(payload.uncertainty, "uncertainty"),
    assumptions: strings(payload.assumptions ?? [], "assumptions"),
    rationaleClaims: strings(payload.rationaleClaims, "rationaleClaims"),
    evidenceReferences: output.evidenceReferences
  });
}

function shockedMarketEvidence(derivedInputs: Readonly<Record<string, string | number | boolean>>, observedAt: number): { readonly evidence: AgentEvidence; readonly materialization: AiEvidenceMaterialization } | null {
  const basePrice = derivedInputs["market.price"];
  const market = derivedInputs["market.market"];
  if (typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice <= 0 || typeof market !== "string" || !market.trim()) return null;
  const shock = derivedInputs[CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION];
  const shockPercent = typeof shock === "number" && Number.isFinite(shock) ? shock : 0;
  const price = basePrice * (1 + shockPercent);
  if (!Number.isFinite(price) || price <= 0) return null;
  const changeRate = derivedInputs["market.changeRate"];
  const volume = derivedInputs["market.volume"];
  const payload = Object.freeze({
    market: market.trim(),
    price,
    changeRate: typeof changeRate === "number" ? changeRate : null,
    volume: typeof volume === "number" ? volume : null,
    observedAt: new Date(observedAt).toISOString(),
    source: "UPBIT_PUBLIC_TICKER" as const,
    scenarioPriceShockPercent: shockPercent
  });
  const digest = aiSha256(payload);
  const evidenceId = `scenario-market:${market.trim()}:${observedAt}:${digest.slice(0, 16)}`;
  return {
    evidence: Object.freeze({ evidenceId, evidenceType: "market-data" as const, sourceReference: "nusa-ai-scenario-market-projection", observedAt, validUntil: observedAt + 120_000, quality: EvidenceQuality.VERIFIED, contentDigest: digest, lineageReferences: Object.freeze([]) }),
    materialization: Object.freeze({ evidenceId, contentDigest: digest, payload })
  };
}

export interface CloudAiScenarioRunnerOptions {
  readonly promptRegistry?: PromptArtifactRegistry;
  readonly now?: () => number;
  readonly maxRetries?: number;
}

export class CloudAiScenarioRunner implements AiScenarioRunner {
  private readonly registry: PromptArtifactRegistry;
  private readonly now: () => number;
  private readonly maxRetries: number;

  public constructor(private readonly provider: ModelProvider, options: CloudAiScenarioRunnerOptions = {}) {
    this.registry = options.promptRegistry ?? createDefaultPromptArtifactRegistry();
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 0;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 2) throw new Error("scenario retry policy is invalid");
  }

  public async runScenario(materialization: AiScenarioMaterialization, resources: AiInferenceResourceController): Promise<AiScenarioRunOutput> {
    const at = this.now();
    const built = shockedMarketEvidence(materialization.derivedInputs, at);
    if (built == null) throw new Error("scenario materialization is missing usable market derived inputs");
    const callId = `scenario:${materialization.scenarioIdentity}:call`;
    if (!resources.reserveCall(callId, at)) throw new Error("scenario resource call budget exhausted");
    const bundle = buildEvidenceBundle({
      contextSnapshotId: `scenario:${materialization.scenarioIdentity}:context`,
      agentId: "ai-scenario-strategy-proposer",
      evidence: [built.evidence],
      evidenceMaterializations: [built.materialization],
      allowedEvidenceClasses: ["market-data"],
      evaluatedAt: at,
      validUntil: at + 120_000,
      policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1", "NUSA_AI_SCENARIO_REASONING_V1"],
      certificationIds: [],
      controlPlaneStateId: `scenario:${materialization.kind}`
    });
    const artifact = this.registry.get("nusa.ai.strategy_proposer", "1.0.0");
    if (artifact == null) throw new Error("scenario strategy_proposer prompt artifact is unavailable");
    const modelInput = Object.freeze({
      role: "STRATEGY_PROPOSER" as const,
      contextHash: bundle.context.contextHash,
      evidenceBundleHash: bundle.evidenceBundleHash,
      evidence: bundle.materializedEvidence.map((item) => Object.freeze({ evidenceId: item.evidence.evidenceId, evidenceType: item.evidence.evidenceType, observedAt: item.evidence.observedAt, validUntil: item.evidence.validUntil, quality: item.evidence.quality, contentDigest: item.evidence.contentDigest, payload: item.payload }))
    });
    const request: ModelRequest = Object.freeze({
      requestId: `scenario:${materialization.scenarioIdentity}:request`,
      role: "STRATEGY_PROPOSER",
      providerId: this.provider.providerId,
      modelVersionId: this.provider.modelVersionId,
      promptArtifactId: artifact.promptArtifactId,
      promptArtifactVersion: artifact.version,
      promptArtifactDigest: artifact.digest,
      instructions: artifact.instructions,
      contextHash: bundle.context.contextHash,
      inputHash: aiSha256(modelInput),
      input: modelInput,
      maxOutputBytes: 32_768,
      maxTokens: 2_048,
      timeoutMs: 10_000,
      attempt: 0
    });
    const executor = new AgentExecutor(this.provider, this.maxRetries, resources, this.now);
    const execution = await executor.execute(request, validateStrategyProposerOutput);
    if (!execution.ok) throw new Error(`scenario strategy proposer failed: ${execution.failure.code}`);
    return Object.freeze({ projection: toProjection(execution.output) });
  }
}
