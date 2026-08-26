import type { GhostExecutionResult } from "./ghostExecution";

export interface CounterfactualOutcome {
  readonly label: string;
  readonly netReturn: number;
  readonly sourceDatasetIds: readonly string[];
}

export interface CounterfactualAssessment {
  readonly schemaVersion: 1;
  readonly actualLabel: string;
  readonly actualNetReturn: number;
  readonly bestAlternativeLabel?: string;
  readonly bestAlternativeNetReturn?: number;
  readonly regret: number;
  readonly relativeRank: number;
  readonly evaluatedOutcomeCount: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export class CounterfactualError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CounterfactualError";
  }
}

function validateOutcome(outcome: CounterfactualOutcome): void {
  if (!outcome.label.trim()) throw new CounterfactualError("INVALID_LABEL", "counterfactual outcome label is required");
  if (!Number.isFinite(outcome.netReturn)) throw new CounterfactualError("NON_FINITE_RETURN", "counterfactual netReturn must be finite");
  if (outcome.sourceDatasetIds.length === 0) throw new CounterfactualError("MISSING_PROVENANCE", "counterfactual outcome requires source dataset provenance");
}

export function assessCounterfactual(
  actual: GhostExecutionResult,
  alternatives: readonly CounterfactualOutcome[],
  actualLabel = "ACTUAL_DECISION",
): CounterfactualAssessment {
  if (actual.schemaVersion !== 1) throw new CounterfactualError("UNSUPPORTED_GHOST_SCHEMA", "ghost execution schema is unsupported");
  if (actual.status !== "SIMULATED" || actual.netReturn === undefined) {
    throw new CounterfactualError("ACTUAL_NOT_SIMULATED", "counterfactual analysis requires a simulated actual outcome");
  }
  if (!Number.isFinite(actual.netReturn)) throw new CounterfactualError("NON_FINITE_ACTUAL_RETURN", "actual netReturn must be finite");
  if (!actualLabel.trim()) throw new CounterfactualError("INVALID_LABEL", "actual label is required");
  if (actual.sourceDatasetIds.length === 0) throw new CounterfactualError("MISSING_PROVENANCE", "actual outcome requires source dataset provenance");

  const seen = new Set<string>([actualLabel]);
  for (const outcome of alternatives) {
    validateOutcome(outcome);
    if (seen.has(outcome.label)) throw new CounterfactualError("DUPLICATE_LABEL", `duplicate outcome label: ${outcome.label}`);
    seen.add(outcome.label);
  }

  const ordered = [...alternatives].sort((a, b) => b.netReturn - a.netReturn || a.label.localeCompare(b.label));
  const bestAlternative = ordered[0];
  const regret = bestAlternative ? Math.max(0, bestAlternative.netReturn - actual.netReturn) : 0;
  const allReturns = [actual.netReturn, ...alternatives.map((outcome) => outcome.netReturn)].sort((a, b) => b - a);
  const relativeRank = allReturns.findIndex((value) => value === actual.netReturn) + 1;
  const provenance = new Set<string>(actual.sourceDatasetIds);
  for (const outcome of alternatives) for (const id of outcome.sourceDatasetIds) provenance.add(id);

  const reasons: string[] = [];
  if (alternatives.length === 0) reasons.push("NO_ALTERNATIVES");
  else if (regret > 0) reasons.push("BETTER_ALTERNATIVE_OBSERVED");
  else reasons.push("ACTUAL_WAS_BEST_OR_TIED");

  return Object.freeze({
    schemaVersion: 1,
    actualLabel,
    actualNetReturn: actual.netReturn,
    bestAlternativeLabel: bestAlternative?.label,
    bestAlternativeNetReturn: bestAlternative?.netReturn,
    regret,
    relativeRank,
    evaluatedOutcomeCount: 1 + alternatives.length,
    reasons: Object.freeze(reasons),
    sourceDatasetIds: Object.freeze([...provenance].sort()),
  });
}
