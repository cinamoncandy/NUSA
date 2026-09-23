export type JevRootCause = "CODE" | "TEST" | "INFRA" | "AUTH" | "RUNNER" | "FLAKY" | "UNKNOWN";
export type JevRequiredModel = "LUNA" | "TERRA" | "SOL" | "ASTRA" | "HUMAN";

export interface JevShadowDecision {
  readonly rootCause: JevRootCause;
  readonly safeToAutofix: "YES" | "NO";
  readonly severity: 1 | 2 | 3 | 4 | 5;
  readonly requiredModel: JevRequiredModel;
  readonly confidence: number;
}

export interface JevShadowProjection {
  readonly mode: "DISABLED" | "SHADOW";
  readonly decision: JevShadowDecision;
  readonly usableForRouting: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
  readonly fallbackApplied: boolean;
}

export const JEV_DETERMINISTIC_FALLBACK: JevShadowDecision = Object.freeze({
  rootCause: "UNKNOWN",
  safeToAutofix: "NO",
  severity: 5,
  requiredModel: "HUMAN",
  confidence: 0
});

const ROOT_CAUSES = new Set<JevRootCause>(["CODE", "TEST", "INFRA", "AUTH", "RUNNER", "FLAKY", "UNKNOWN"]);
const MODELS = new Set<JevRequiredModel>(["LUNA", "TERRA", "SOL", "ASTRA", "HUMAN"]);

export function validateJevShadowDecision(value: unknown): JevShadowDecision {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Jev shadow response malformed");
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(",") !== "confidence,requiredModel,rootCause,safeToAutofix,severity") throw new Error("Jev shadow response malformed");
  if (!ROOT_CAUSES.has(source.rootCause as JevRootCause)) throw new Error("Jev shadow root cause invalid");
  if (source.safeToAutofix !== "YES" && source.safeToAutofix !== "NO") throw new Error("Jev shadow autofix decision invalid");
  if (!Number.isInteger(source.severity) || (source.severity as number) < 1 || (source.severity as number) > 5) throw new Error("Jev shadow severity invalid");
  if (!MODELS.has(source.requiredModel as JevRequiredModel)) throw new Error("Jev shadow required model invalid");
  if (typeof source.confidence !== "number" || !Number.isFinite(source.confidence) || source.confidence < 0 || source.confidence > 1) throw new Error("Jev shadow confidence invalid");
  return Object.freeze({
    rootCause: source.rootCause as JevRootCause,
    safeToAutofix: source.safeToAutofix,
    severity: source.severity as 1 | 2 | 3 | 4 | 5,
    requiredModel: source.requiredModel as JevRequiredModel,
    confidence: source.confidence
  });
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

export class JevShadowRouter {
  public constructor(
    private readonly classify: (input: Readonly<Record<string, unknown>>) => Promise<unknown>,
    private readonly minConfidence = 0.8
  ) {
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new Error("Jev confidence threshold invalid");
  }

  public async observe(input: Readonly<Record<string, unknown>>, env: NodeJS.ProcessEnv = process.env): Promise<JevShadowProjection> {
    if (!enabled(env.NUSA_JEV_SHADOW_ENABLED)) return this.project("DISABLED", JEV_DETERMINISTIC_FALLBACK, true);
    try {
      const decision = validateJevShadowDecision(await this.classify(input));
      if (decision.confidence < this.minConfidence) return this.project("SHADOW", JEV_DETERMINISTIC_FALLBACK, true);
      return this.project("SHADOW", decision, false);
    } catch {
      return this.project("SHADOW", JEV_DETERMINISTIC_FALLBACK, true);
    }
  }

  private project(mode: "DISABLED" | "SHADOW", decision: JevShadowDecision, fallbackApplied: boolean): JevShadowProjection {
    return Object.freeze({
      mode,
      decision,
      usableForRouting: false,
      aiAuthority: "ZERO_AUTHORITY",
      productionMutationAllowed: false,
      liveAuthority: "NONE",
      fallbackApplied
    });
  }
}
