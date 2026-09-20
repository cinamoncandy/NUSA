export type AiModelTier = "JEV" | "LUNA" | "TERRA" | "SOL" | "ASTRA";
export type AiCapability = "classify" | "route" | "summarize" | "code" | "debug" | "research" | "architecture" | "high_reasoning";
export type AiRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AiComplexity = "TRIVIAL" | "SIMPLE" | "MODERATE" | "COMPLEX" | "EXTREME";
export type AiLatencySensitivity = "LOW" | "MEDIUM" | "HIGH";
export type AiCostSensitivity = "LOW" | "MEDIUM" | "HIGH";
export type AiAvailability = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "CIRCUIT_OPEN";
export type AiStability = "EXPERIMENTAL" | "STABLE";
export type AiCostClass = "ULTRA_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
export type AiLatencyClass = "ULTRA_LOW" | "LOW" | "MEDIUM" | "HIGH";
export type AiRouteReason =
  | "CAPABILITY_MATCH" | "RISK_ESCALATION" | "COMPLEXITY_ESCALATION" | "LOW_CONFIDENCE_ESCALATION"
  | "CONTEXT_ESCALATION" | "PROVIDER_UNAVAILABLE" | "FALLBACK" | "NO_SAFE_ROUTE";

export interface AiModelRegistryEntry {
  readonly modelId: AiModelTier;
  readonly providerId: string;
  readonly capabilities: readonly AiCapability[];
  readonly maxContextBytes: number;
  readonly costClass: AiCostClass;
  readonly latencyClass: AiLatencyClass;
  readonly availability: AiAvailability;
  readonly enabled: boolean;
  readonly stability: AiStability;
}
export interface AiRoutingInput {
  readonly taskType: AiCapability; readonly riskLevel: AiRiskLevel; readonly estimatedComplexity: AiComplexity;
  readonly contextSize: number; readonly requiredCapabilities: readonly AiCapability[];
  readonly latencySensitivity: AiLatencySensitivity; readonly costSensitivity: AiCostSensitivity;
  readonly previousFailures: readonly AiModelTier[]; readonly confidence: number;
}
export interface AiRoutingDecision {
  readonly selectedModel: AiModelTier | "HUMAN"; readonly selectedProvider: string | null; readonly confidence: number;
  readonly reasonCode: AiRouteReason; readonly fallbackModel: AiModelTier | "HUMAN"; readonly timeoutMs: number;
  readonly maxRetries: 0 | 1 | 2; readonly escalationRequired: boolean; readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE"; readonly productionMutationAllowed: false;
}
const RANK: Readonly<Record<AiModelTier, number>> = Object.freeze({ JEV: 0, LUNA: 1, TERRA: 2, SOL: 3, ASTRA: 4 });
const COST: Readonly<Record<AiCostClass, number>> = Object.freeze({ ULTRA_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 });
const LATENCY: Readonly<Record<AiLatencyClass, number>> = Object.freeze({ ULTRA_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });
const COMPLEXITY_FLOOR: Readonly<Record<AiComplexity, number>> = Object.freeze({ TRIVIAL: 0, SIMPLE: 1, MODERATE: 2, COMPLEX: 3, EXTREME: 4 });
const RISK_FLOOR: Readonly<Record<AiRiskLevel, number>> = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 3, CRITICAL: 4 });
function allCapabilities(entry: AiModelRegistryEntry, required: readonly AiCapability[]): boolean { return required.every((capability) => entry.capabilities.includes(capability)); }
function decision(model: AiModelRegistryEntry | null, confidence: number, reasonCode: AiRouteReason, fallback: AiModelTier | "HUMAN", escalationRequired: boolean): AiRoutingDecision {
  return Object.freeze({ selectedModel: model?.modelId ?? "HUMAN", selectedProvider: model?.providerId ?? null, confidence, reasonCode, fallbackModel: fallback,
    timeoutMs: model == null ? 0 : RANK[model.modelId] >= 3 ? 30_000 : RANK[model.modelId] >= 2 ? 15_000 : 5_000, maxRetries: model == null ? 0 : 1,
    escalationRequired, aiAuthority: "ZERO_AUTHORITY", liveAuthority: "NONE", productionMutationAllowed: false });
}
export function validateAiModelRegistry(entries: readonly AiModelRegistryEntry[]): readonly AiModelRegistryEntry[] {
  const identities = new Set<string>();
  for (const entry of entries) {
    if (!entry.providerId.trim()) throw new Error("AI providerId is required");
    if (!Number.isSafeInteger(entry.maxContextBytes) || entry.maxContextBytes < 1) throw new Error("AI model context limit invalid");
    if (entry.capabilities.length === 0 || new Set(entry.capabilities).size !== entry.capabilities.length) throw new Error("AI model capabilities invalid");
    const identity = `${entry.modelId}:${entry.providerId}`; if (identities.has(identity)) throw new Error("duplicate AI model registry entry"); identities.add(identity);
  }
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry, capabilities: Object.freeze([...entry.capabilities]) })));
}
export function routeAiModel(input: AiRoutingInput, registry: readonly AiModelRegistryEntry[]): AiRoutingDecision {
  if (!Number.isSafeInteger(input.contextSize) || input.contextSize < 0) throw new Error("AI routing context size invalid");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error("AI routing confidence invalid");
  const required = [...new Set<AiCapability>([input.taskType, ...input.requiredCapabilities])];
  const minimumRank = Math.max(COMPLEXITY_FLOOR[input.estimatedComplexity], RISK_FLOOR[input.riskLevel], input.confidence < 0.5 ? 3 : 0);
  const candidates = validateAiModelRegistry(registry).filter((entry) => entry.enabled && entry.stability === "STABLE" && entry.availability === "AVAILABLE")
    .filter((entry) => RANK[entry.modelId] >= minimumRank && entry.maxContextBytes >= input.contextSize && allCapabilities(entry, required))
    .filter((entry) => !input.previousFailures.includes(entry.modelId)).sort((a, b) => {
      const rank = RANK[a.modelId] - RANK[b.modelId]; if (rank !== 0) return rank;
      const cost = COST[a.costClass] - COST[b.costClass]; if (cost !== 0) return cost;
      const latency = LATENCY[a.latencyClass] - LATENCY[b.latencyClass]; if (latency !== 0) return latency;
      return a.providerId.localeCompare(b.providerId);
    });
  const selected = candidates[0] ?? null; if (selected == null) return decision(null, 0, "NO_SAFE_ROUTE", "HUMAN", true);
  const fallback = candidates.find((candidate) => candidate.modelId !== selected.modelId)?.modelId ?? "HUMAN";
  const reason: AiRouteReason = input.confidence < 0.5 ? "LOW_CONFIDENCE_ESCALATION" : RISK_FLOOR[input.riskLevel] > COMPLEXITY_FLOOR[input.estimatedComplexity] ? "RISK_ESCALATION" : minimumRank > 0 ? "COMPLEXITY_ESCALATION" : "CAPABILITY_MATCH";
  return decision(selected, input.confidence, reason, fallback, minimumRank >= 3);
}
