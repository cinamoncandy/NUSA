import { createHash } from "node:crypto";
import {
  evaluateScenarioPaperEvidence,
  type RequiredPaperFaultScenario,
  type ScenarioPaperEvidenceInput,
  type ScenarioPaperValidationResult
} from "./scenarioPaperValidation";

export interface ScenarioPaperObservation {
  readonly recordId: string;
  readonly observedAt: number;
  readonly completedOrders: number;
  readonly marketRegime: string;
  readonly restartRecoveryPassed: boolean;
  readonly duplicateOrderChecks: number;
  readonly passedFaultScenarios: readonly RequiredPaperFaultScenario[];
}

export interface ScenarioResearchEvidence {
  readonly walkForwardEvidenceId: string;
  readonly costStressEvidenceId: string;
  readonly integrityEvidenceId: string;
  readonly walkForwardPassed: boolean;
  readonly costStressPassed: boolean;
  readonly integrityChecksPassed: boolean;
}

export interface ScenarioPaperEvidenceBundle {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly contentSha256: string;
  readonly observations: readonly ScenarioPaperObservation[];
  readonly researchEvidence: ScenarioResearchEvidence;
  readonly derivedInput: ScenarioPaperEvidenceInput;
  readonly validation: ScenarioPaperValidationResult;
}

const count = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be blank`);
  return normalized;
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

export function buildScenarioPaperEvidenceBundle(
  observationsInput: readonly ScenarioPaperObservation[],
  researchInput: ScenarioResearchEvidence,
  generatedAt: number
): ScenarioPaperEvidenceBundle {
  count(generatedAt, "generatedAt");
  if (observationsInput.length === 0) throw new Error("at least one Paper observation is required");

  const observations = observationsInput.map((record) => {
    const recordId = text(record.recordId, "recordId");
    count(record.observedAt, `${recordId}.observedAt`);
    count(record.completedOrders, `${recordId}.completedOrders`);
    count(record.duplicateOrderChecks, `${recordId}.duplicateOrderChecks`);
    if (record.observedAt > generatedAt) throw new Error(`${recordId}.observedAt cannot be in the future`);
    if (new Set(record.passedFaultScenarios).size !== record.passedFaultScenarios.length) throw new Error(`${recordId} fault scenarios must be unique`);
    return {
      recordId,
      observedAt: record.observedAt,
      completedOrders: record.completedOrders,
      marketRegime: text(record.marketRegime, `${recordId}.marketRegime`).toUpperCase(),
      restartRecoveryPassed: record.restartRecoveryPassed,
      duplicateOrderChecks: record.duplicateOrderChecks,
      passedFaultScenarios: [...record.passedFaultScenarios].sort()
    };
  }).sort((a, b) => a.observedAt - b.observedAt || a.recordId.localeCompare(b.recordId));

  if (new Set(observations.map((record) => record.recordId)).size !== observations.length) throw new Error("Paper observation recordIds must be unique");

  const researchEvidence = {
    walkForwardEvidenceId: text(researchInput.walkForwardEvidenceId, "walkForwardEvidenceId"),
    costStressEvidenceId: text(researchInput.costStressEvidenceId, "costStressEvidenceId"),
    integrityEvidenceId: text(researchInput.integrityEvidenceId, "integrityEvidenceId"),
    walkForwardPassed: researchInput.walkForwardPassed,
    costStressPassed: researchInput.costStressPassed,
    integrityChecksPassed: researchInput.integrityChecksPassed
  };

  const faultScenarios = [...new Set(observations.flatMap((record) => record.passedFaultScenarios))].sort() as RequiredPaperFaultScenario[];
  const derivedInput: ScenarioPaperEvidenceInput = {
    generatedAt,
    observedSessions: observations.length,
    completedOrders: observations.reduce((sum, record) => sum + record.completedOrders, 0),
    marketRegimes: new Set(observations.map((record) => record.marketRegime)).size,
    restartRecoveryPasses: observations.filter((record) => record.restartRecoveryPassed).length,
    duplicateOrderChecks: observations.reduce((sum, record) => sum + record.duplicateOrderChecks, 0),
    passedFaultScenarios: faultScenarios,
    walkForwardPassed: researchEvidence.walkForwardPassed,
    costStressPassed: researchEvidence.costStressPassed,
    integrityChecksPassed: researchEvidence.integrityChecksPassed
  };

  const canonical = JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    observations,
    researchEvidence
  });
  const contentSha256 = createHash("sha256").update(canonical, "utf8").digest("hex");

  return deepFreeze({
    schemaVersion: 1 as const,
    generatedAt,
    contentSha256,
    observations,
    researchEvidence,
    derivedInput,
    validation: evaluateScenarioPaperEvidence(derivedInput)
  });
}


export function verifyScenarioPaperEvidenceBundle(bundle: ScenarioPaperEvidenceBundle): ScenarioPaperEvidenceBundle {
  if (bundle.schemaVersion !== 1) throw new Error("unsupported scenario evidence bundle schema");
  if (!/^[0-9a-f]{64}$/.test(bundle.contentSha256)) throw new Error("invalid scenario evidence bundle SHA-256");
  const rebuilt = buildScenarioPaperEvidenceBundle(bundle.observations, bundle.researchEvidence, bundle.generatedAt);
  if (rebuilt.contentSha256 !== bundle.contentSha256) throw new Error("scenario evidence bundle checksum mismatch");
  if (JSON.stringify(rebuilt.derivedInput) !== JSON.stringify(bundle.derivedInput)) throw new Error("scenario evidence derived counters mismatch");
  if (JSON.stringify(rebuilt.validation) !== JSON.stringify(bundle.validation)) throw new Error("scenario evidence validation mismatch");
  return rebuilt;
}
