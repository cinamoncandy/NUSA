import { aiSha256 } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceResourceController } from "../../../../packages/contracts/src/aiInferenceResources";
import type { AiProviderComparisonState, AiProviderStrategyProjection } from "../../../../packages/contracts/src/aiProviderDiversity";
import type {
  AiScenarioBaseline,
  AiScenarioDefinition,
  AiScenarioEvaluation,
  AiScenarioMaterialization,
  AiScenarioPolicy,
  AiScenarioReasoningResult,
  AiScenarioSensitivityMetrics
} from "../../../../packages/contracts/src/aiScenarioReasoning";
import { InferenceResourceLedger, aiInferenceBudgetIdentity, normalizeAiInferenceBudgetPolicy } from "./inferenceResourceLedger";

export interface AiScenarioRunOutput {
  readonly projection: AiProviderStrategyProjection;
  readonly providerComparisonState?: AiProviderComparisonState;
}

export interface AiScenarioRunner {
  runScenario(materialization: AiScenarioMaterialization, resources: AiInferenceResourceController): Promise<AiScenarioRunOutput>;
}

export interface ScenarioCounterfactualEvaluatorOptions {
  readonly now?: () => number;
}

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const boundedUnit = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be within [0,1]`);
  return value;
};

const positiveSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

export function normalizeAiScenarioPolicy(value: AiScenarioPolicy): AiScenarioPolicy {
  if (value.schemaVersion !== 1) throw new Error("AI scenario policy schemaVersion is unsupported");
  const allowedDimensions = Object.freeze([...new Set(value.allowedDimensions.map((item) => requiredText(item, "AI scenario dimension")))].sort());
  if (allowedDimensions.length === 0) throw new Error("AI scenario policy must allow at least one dimension");
  return Object.freeze({
    schemaVersion: 1,
    policyId: requiredText(value.policyId, "AI scenario policyId"),
    policyVersion: requiredText(value.policyVersion, "AI scenario policyVersion"),
    allowedDimensions,
    maxScenarioCount: positiveSafeInteger(value.maxScenarioCount, "AI scenario maxScenarioCount"),
    maxProbabilityDeltaForRobust: boundedUnit(value.maxProbabilityDeltaForRobust, "AI scenario maxProbabilityDeltaForRobust"),
    inferenceBudget: normalizeAiInferenceBudgetPolicy(value.inferenceBudget)
  });
}

export function aiScenarioPolicyIdentity(value: AiScenarioPolicy): string {
  const policy = normalizeAiScenarioPolicy(value);
  return aiSha256({
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    allowedDimensions: policy.allowedDimensions,
    maxScenarioCount: policy.maxScenarioCount,
    maxProbabilityDeltaForRobust: policy.maxProbabilityDeltaForRobust,
    inferenceBudget: aiInferenceBudgetIdentity(policy.inferenceBudget)
  });
}

function baselineIdentity(baseline: AiScenarioBaseline): string {
  const evidence = [...baseline.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const materializations = [...baseline.evidenceMaterializations].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  if (evidence.length !== materializations.length) throw new Error("baseline evidence/materialization cardinality mismatch");
  for (const item of evidence) {
    const materialized = materializations.find((candidate) => candidate.evidenceId === item.evidenceId);
    if (materialized == null) throw new Error("baseline materialization missing");
    if (materialized.contentDigest !== item.contentDigest || aiSha256(materialized.payload) !== item.contentDigest) throw new Error("baseline evidence digest mismatch");
  }
  return aiSha256({
    decisionId: requiredText(baseline.decisionId, "AI scenario decisionId"),
    evaluatedAt: baseline.evaluatedAt,
    evidence,
    evidenceMaterializations: materializations,
    derivedInputs: baseline.derivedInputs
  });
}

function canonicalDefinition(definition: AiScenarioDefinition, policy: AiScenarioPolicy, baselineId: string): AiScenarioMaterialization {
  const scenarioId = requiredText(definition.scenarioId, "AI scenarioId");
  if (definition.kind === "BASELINE" && definition.interventions.length !== 0) throw new Error("baseline scenario cannot contain interventions");
  if (definition.kind !== "BASELINE" && definition.kind !== "HYPOTHETICAL") throw new Error("AI scenario kind is invalid");
  const allowed = new Set(policy.allowedDimensions);
  const seen = new Set<string>();
  const interventions = definition.interventions.map((item) => {
    const dimension = requiredText(item.dimension, "AI scenario intervention dimension");
    if (!allowed.has(dimension)) throw new Error("AI scenario intervention dimension is not allowed");
    if (seen.has(dimension)) throw new Error("AI scenario intervention dimension must be unique");
    seen.add(dimension);
    positiveSafeInteger(item.horizonMs, "AI scenario horizonMs");
    if (!["string", "number", "boolean"].includes(typeof item.value) || (typeof item.value === "number" && !Number.isFinite(item.value))) throw new Error("AI scenario intervention value is invalid");
    return Object.freeze({ dimension, value: item.value, horizonMs: item.horizonMs });
  }).sort((a, b) => a.dimension.localeCompare(b.dimension));
  if (definition.kind === "HYPOTHETICAL" && interventions.length === 0) throw new Error("hypothetical scenario requires an intervention");
  const scenarioIdentity = aiSha256({ kind: definition.kind, baselineIdentity: baselineId, interventions });
  return Object.freeze({
    scenarioId,
    kind: definition.kind,
    baselineIdentity: baselineId,
    scenarioIdentity,
    derivedInputs: Object.freeze({}),
    interventions: Object.freeze(interventions),
    provenance: definition.kind === "BASELINE" ? "OBSERVED_BASELINE" : "HYPOTHETICAL"
  });
}

function applyDerivedInputs(materialization: AiScenarioMaterialization, baseline: AiScenarioBaseline): AiScenarioMaterialization {
  const derivedInputs: Record<string, string | number | boolean> = { ...baseline.derivedInputs };
  for (const intervention of materialization.interventions) derivedInputs[intervention.dimension] = intervention.value;
  return Object.freeze({ ...materialization, derivedInputs: Object.freeze(derivedInputs) });
}

function metrics(evaluations: readonly AiScenarioEvaluation[], duplicateScenarioCount: number): AiScenarioSensitivityMetrics {
  const completed = evaluations.filter((item) => item.status === "COMPLETED" && item.projection != null);
  const baseline = completed.find((item) => item.kind === "BASELINE")?.projection ?? null;
  let changedDecisionCount = 0;
  let changedUncertaintyCount = 0;
  let maxProbabilityDelta: number | null = null;
  const reasonCodes = new Set<string>();
  if (baseline != null) {
    for (const item of completed) {
      if (item.kind === "BASELINE" || item.projection == null) continue;
      if (item.projection.decision !== baseline.decision) changedDecisionCount += 1;
      if (item.projection.uncertainty.trim().toLowerCase() !== baseline.uncertainty.trim().toLowerCase()) changedUncertaintyCount += 1;
      const delta = Math.abs(item.projection.rawProbability - baseline.rawProbability);
      maxProbabilityDelta = maxProbabilityDelta == null ? delta : Math.max(maxProbabilityDelta, delta);
    }
  } else reasonCodes.add("BASELINE_NOT_COMPLETED");
  if (changedDecisionCount > 0) reasonCodes.add("DECISION_CHANGED");
  if (changedUncertaintyCount > 0) reasonCodes.add("UNCERTAINTY_CHANGED");
  if (duplicateScenarioCount > 0) reasonCodes.add("DUPLICATES_SUPPRESSED");
  if (evaluations.some((item) => item.status !== "COMPLETED")) reasonCodes.add("SCENARIO_INCOMPLETE");
  return Object.freeze({
    evaluatedScenarioCount: evaluations.length,
    completedScenarioCount: completed.length,
    duplicateScenarioCount,
    changedDecisionCount,
    maxProbabilityDelta,
    changedUncertaintyCount,
    reasonCodes: Object.freeze([...reasonCodes].sort())
  });
}

export class ScenarioCounterfactualEvaluator {
  private readonly policy: AiScenarioPolicy;
  private readonly now: () => number;
  private readonly cache = new Map<string, { inputHash: string; result: AiScenarioReasoningResult }>();

  public constructor(policy: AiScenarioPolicy, private readonly runner: AiScenarioRunner, options: ScenarioCounterfactualEvaluatorOptions = {}) {
    this.policy = normalizeAiScenarioPolicy(policy);
    this.now = options.now ?? Date.now;
  }

  public async run(experimentIdValue: string, baseline: AiScenarioBaseline, definitions: readonly AiScenarioDefinition[]): Promise<AiScenarioReasoningResult> {
    const experimentId = requiredText(experimentIdValue, "AI scenario experimentId");
    const startedAt = this.now();
    const resources = new InferenceResourceLedger(this.policy.inferenceBudget, startedAt);
    let baselineId: string;
    try { baselineId = baselineIdentity(baseline); }
    catch { return this.result(experimentId, "UNVERIFIED", "ABSTAIN", "INVALID_BASELINE", "", [], 0, resources, startedAt); }
    const policyIdentity = aiScenarioPolicyIdentity(this.policy);
    let materializations: AiScenarioMaterialization[];
    try {
      materializations = definitions.map((item) => applyDerivedInputs(canonicalDefinition(item, this.policy, baselineId), baseline));
    } catch {
      return this.result(experimentId, "UNVERIFIED", "ABSTAIN", "INVALID_SCENARIO", baselineId, [], 0, resources, startedAt, policyIdentity);
    }
    if (materializations.filter((item) => item.kind === "BASELINE").length !== 1) return this.result(experimentId, "UNVERIFIED", "ABSTAIN", "BASELINE_SCENARIO_REQUIRED", baselineId, [], 0, resources, startedAt, policyIdentity);
    const unique: AiScenarioMaterialization[] = [];
    const identities = new Set<string>();
    let duplicates = 0;
    for (const item of materializations) {
      if (identities.has(item.scenarioIdentity)) { duplicates += 1; continue; }
      identities.add(item.scenarioIdentity);
      unique.push(item);
    }
    if (unique.length > this.policy.maxScenarioCount) return this.result(experimentId, "UNVERIFIED", "ABSTAIN", "SCENARIO_COUNT_EXCEEDED", baselineId, [], duplicates, resources, startedAt, policyIdentity);
    unique.sort((a, b) => (a.kind === b.kind ? a.scenarioIdentity.localeCompare(b.scenarioIdentity) : a.kind === "BASELINE" ? -1 : 1));
    const inputHash = aiSha256({ policyIdentity, baselineId, scenarios: unique.map((item) => item.scenarioIdentity) });
    const prior = this.cache.get(experimentId);
    if (prior != null) {
      if (prior.inputHash === inputHash) return prior.result;
      return this.result(experimentId, "UNVERIFIED", "ABSTAIN", "REPLAY_CONFLICT", baselineId, [], duplicates, resources, startedAt, policyIdentity);
    }

    const evaluations: AiScenarioEvaluation[] = [];
    for (const item of unique) {
      if (resources.snapshot(this.now()).health !== "HEALTHY") {
        evaluations.push(Object.freeze({ scenarioId: item.scenarioId, scenarioIdentity: item.scenarioIdentity, kind: item.kind, status: "RESOURCE_BLOCKED", projection: null, failureCode: "RESOURCE_EXHAUSTED" }));
        continue;
      }
      try {
        const output = await this.runner.runScenario(item, resources);
        boundedUnit(output.projection.rawProbability, "AI scenario rawProbability");
        const contradiction = output.providerComparisonState === "DISAGREEMENT";
        evaluations.push(Object.freeze({ scenarioId: item.scenarioId, scenarioIdentity: item.scenarioIdentity, kind: item.kind, status: contradiction ? "UNVERIFIED" : "COMPLETED", projection: output.projection, failureCode: contradiction ? "PROVIDER_DISAGREEMENT" : null }));
      } catch {
        evaluations.push(Object.freeze({ scenarioId: item.scenarioId, scenarioIdentity: item.scenarioIdentity, kind: item.kind, status: "FAILED", projection: null, failureCode: "SCENARIO_RUN_FAILED" }));
      }
    }

    const m = metrics(evaluations, duplicates);
    let state: AiScenarioReasoningResult["robustnessState"];
    let trust: AiScenarioReasoningResult["trustDisposition"];
    if (evaluations.some((item) => item.failureCode === "PROVIDER_DISAGREEMENT")) { state = "CONTRADICTORY"; trust = "ABSTAIN"; }
    else if (evaluations.some((item) => item.status !== "COMPLETED") || m.completedScenarioCount !== unique.length) { state = "INCOMPLETE"; trust = "ABSTAIN"; }
    else if (m.changedDecisionCount > 0 || m.changedUncertaintyCount > 0 || (m.maxProbabilityDelta != null && m.maxProbabilityDelta > this.policy.maxProbabilityDeltaForRobust)) { state = "SENSITIVE"; trust = "REDUCE"; }
    else { state = "ROBUST"; trust = "NO_UPLIFT"; }
    const result = this.result(experimentId, state, trust, null, baselineId, evaluations, duplicates, resources, startedAt, policyIdentity);
    this.cache.set(experimentId, { inputHash, result });
    return result;
  }

  private result(experimentId: string, robustnessState: AiScenarioReasoningResult["robustnessState"], trustDisposition: AiScenarioReasoningResult["trustDisposition"], reasonCode: string | null, baselineId: string, evaluations: readonly AiScenarioEvaluation[], duplicateCount: number, resources: InferenceResourceLedger, startedAt: number, policyIdentity = aiScenarioPolicyIdentity(this.policy)): AiScenarioReasoningResult {
    const m = metrics(evaluations, duplicateCount);
    const reasonCodes = reasonCode == null ? m.reasonCodes : Object.freeze([...new Set([...m.reasonCodes, reasonCode])].sort());
    return Object.freeze({
      schemaVersion: 1,
      experimentId,
      policyIdentity,
      baselineIdentity: baselineId,
      robustnessState,
      trustDisposition,
      evaluations: Object.freeze([...evaluations]),
      metrics: Object.freeze({ ...m, reasonCodes }),
      inferenceResources: resources.snapshot(this.now() < startedAt ? startedAt : this.now()),
      liveAuthority: "NONE",
      realOrderAuthority: false,
      realTransferAuthority: false,
      productionMutationAllowed: false,
      calibrationCreditAllowed: false,
      realizedEvidenceAllowed: false,
      learningCreditAllowed: false
    });
  }
}
