import type { JevCodingAdmissionDecision } from "./jevBoundedCodingAdmission";
import type { JevRequiredModel } from "../../cloud/src/ai/jevShadowRouter";

export type JevCodingModelTier = Exclude<JevRequiredModel, "HUMAN">;

export interface JevCodingModelTierEnv {
  readonly NUSA_JEV_MODEL_TIERING_ENABLED?: string;
  readonly NUSA_AI_CODING_MODEL_LUNA?: string;
  readonly NUSA_AI_CODING_MODEL_TERRA?: string;
  readonly NUSA_AI_CODING_MODEL_SOL?: string;
  readonly NUSA_AI_CODING_MODEL_ASTRA?: string;
}

export interface JevCodingModelSelection {
  readonly tier: JevCodingModelTier;
  readonly model: string;
  readonly confidence: number;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";
const ACTIVE_ROOT_CAUSES = new Set(["CODE", "TEST"]);
const ACTIVE_TIERS = new Set<JevCodingModelTier>(["LUNA", "TERRA", "SOL", "ASTRA"]);
const MIN_TIER_CONFIDENCE = 0.9;

function configuredModel(tier: JevCodingModelTier, env: JevCodingModelTierEnv): string | null {
  const raw = tier === "LUNA" ? env.NUSA_AI_CODING_MODEL_LUNA
    : tier === "TERRA" ? env.NUSA_AI_CODING_MODEL_TERRA
      : tier === "SOL" ? env.NUSA_AI_CODING_MODEL_SOL
        : env.NUSA_AI_CODING_MODEL_ASTRA;
  const normalized = raw?.trim();
  return normalized ? normalized : null;
}

export function selectJevCodingModel(
  admission: JevCodingAdmissionDecision,
  env: JevCodingModelTierEnv,
): JevCodingModelSelection | null {
  if (!enabled(env.NUSA_JEV_MODEL_TIERING_ENABLED)) return null;
  if (admission.action !== "PROCEED_EXISTING"
    || admission.reasonCode !== "JEV_ADMITTED"
    || admission.provider !== "jev"
    || admission.safeToAutofix !== "YES"
    || admission.confidence < MIN_TIER_CONFIDENCE
    || !admission.rootCause
    || !ACTIVE_ROOT_CAUSES.has(admission.rootCause)
    || admission.requiredModel === null
    || admission.requiredModel === "HUMAN"
    || !ACTIVE_TIERS.has(admission.requiredModel)) {
    return null;
  }
  const tier = admission.requiredModel as JevCodingModelTier;
  const model = configuredModel(tier, env);
  if (!model) return null;
  return Object.freeze({
    tier,
    model,
    confidence: admission.confidence,
    aiAuthority: "ZERO_AUTHORITY",
    productionMutationAllowed: false,
    liveAuthority: "NONE",
  });
}
