export type DriftSeverity = "NONE" | "WATCH" | "MATERIAL" | "CRITICAL";
export type DriftAction = "NO_CHANGE" | "COLLECT_MORE_EVIDENCE" | "REDUCE_ELIGIBILITY" | "SUSPEND_ELIGIBILITY";

export interface EvolutionDriftObservation {
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly observedAt: string;
  readonly evidenceStatus: "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";
  readonly source: "PAPER";
  readonly dataDrift: number;
  readonly calibrationDrift: number;
  readonly strategyDecay: number;
  readonly costSlippageDegradation: number;
  readonly turnoverInstability: number;
  readonly evidenceAgeMs: number;
  /** Optional canonical diagnostics; absent values remain UNKNOWN rather than zero. */
  readonly realizedEdgeDecay?: number;
  readonly drawdownDeterioration?: number;
  readonly successRateDegradation?: number;
  readonly confidenceMisalignment?: number;
  readonly provenanceDegradation?: number;
  readonly infrastructureDegradation?: number;
  readonly independentEvidenceReused?: boolean;
  readonly regimeMismatch?: boolean;
}

export interface EvolutionDriftInput {
  readonly evaluatedAt: string;
  readonly maximumEvidenceAgeMs: number;
  readonly watchThreshold: number;
  readonly materialThreshold: number;
  readonly criticalThreshold: number;
  readonly observation: EvolutionDriftObservation;
}

export interface EvolutionDriftResult {
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly severity: DriftSeverity;
  readonly action: DriftAction;
  readonly maximumObservedDrift: number | null;
  readonly reasons: readonly string[];
  readonly confidenceIncreaseAllowed: false;
  readonly lifecycleMutationAllowed: false;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const freeze = <T>(value: T): T => Object.freeze(value);
const finiteNonNegative = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
};

function validate(input: EvolutionDriftInput): void {
  const o = input.observation;
  if (!o.candidateId.trim() || !o.strategyFamilyId.trim() || !o.regime.trim()) throw new Error("drift identity is required");
  if (!Number.isFinite(Date.parse(input.evaluatedAt)) || !Number.isFinite(Date.parse(o.observedAt))) throw new Error("drift timestamps must be valid ISO timestamps");
  if (o.source !== "PAPER") throw new Error("only PAPER drift evidence may be evaluated");
  finiteNonNegative(input.maximumEvidenceAgeMs, "maximumEvidenceAgeMs");
  finiteNonNegative(input.watchThreshold, "watchThreshold");
  finiteNonNegative(input.materialThreshold, "materialThreshold");
  finiteNonNegative(input.criticalThreshold, "criticalThreshold");
  if (!(input.watchThreshold <= input.materialThreshold && input.materialThreshold <= input.criticalThreshold)) {
    throw new Error("drift thresholds must be monotonic");
  }
  finiteNonNegative(o.dataDrift, "dataDrift");
  finiteNonNegative(o.calibrationDrift, "calibrationDrift");
  finiteNonNegative(o.strategyDecay, "strategyDecay");
  finiteNonNegative(o.costSlippageDegradation, "costSlippageDegradation");
  finiteNonNegative(o.turnoverInstability, "turnoverInstability");
  finiteNonNegative(o.evidenceAgeMs, "evidenceAgeMs");
  for (const [label, value] of Object.entries({ realizedEdgeDecay: o.realizedEdgeDecay, drawdownDeterioration: o.drawdownDeterioration, successRateDegradation: o.successRateDegradation, confidenceMisalignment: o.confidenceMisalignment, provenanceDegradation: o.provenanceDegradation, infrastructureDegradation: o.infrastructureDegradation })) {
    if (value !== undefined) finiteNonNegative(value, label);
  }
}

export function detectEvolutionDrift(input: EvolutionDriftInput): EvolutionDriftResult {
  validate(input);
  const o = input.observation;
  const reasons: string[] = [];
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  const observedAtMs = Date.parse(o.observedAt);

  if (observedAtMs > evaluatedAtMs) reasons.push("FUTURE_EVIDENCE");
  if (o.evidenceAgeMs > input.maximumEvidenceAgeMs || evaluatedAtMs - observedAtMs > input.maximumEvidenceAgeMs) reasons.push("STALE_EVIDENCE");
  if (o.evidenceStatus !== "VERIFIED") reasons.push(`EVIDENCE_${o.evidenceStatus}`);
  if (o.independentEvidenceReused === true) reasons.push("NON_INDEPENDENT_EVIDENCE_REUSE");
  if (o.regimeMismatch === true) reasons.push("REGIME_MISMATCH");

  if (reasons.length > 0) {
    return freeze({
      candidateId: o.candidateId,
      strategyFamilyId: o.strategyFamilyId,
      regime: o.regime,
      severity: "CRITICAL",
      action: "SUSPEND_ELIGIBILITY",
      maximumObservedDrift: null,
      reasons: freeze([...new Set(reasons)].sort()),
      confidenceIncreaseAllowed: false,
      lifecycleMutationAllowed: false,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  }

  const metrics: readonly [string, number][] = [
    ["DATA_DRIFT", o.dataDrift],
    ["CALIBRATION_DRIFT", o.calibrationDrift],
    ["STRATEGY_DECAY", o.strategyDecay],
    ["COST_SLIPPAGE_DEGRADATION", o.costSlippageDegradation],
    ["TURNOVER_INSTABILITY", o.turnoverInstability],
    ["REALIZED_EDGE_DECAY", o.realizedEdgeDecay ?? 0],
    ["DRAWDOWN_DETERIORATION", o.drawdownDeterioration ?? 0],
    ["SUCCESS_RATE_DEGRADATION", o.successRateDegradation ?? 0],
    ["CONFIDENCE_MISALIGNMENT", o.confidenceMisalignment ?? 0],
    ["PROVENANCE_DEGRADATION", o.provenanceDegradation ?? 0],
    ["INFRASTRUCTURE_DEGRADATION", o.infrastructureDegradation ?? 0],
  ];
  const maximumObservedDrift = Math.max(...metrics.map(([, value]) => value));
  for (const [name, value] of metrics) {
    if (value >= input.materialThreshold) reasons.push(name);
  }

  let severity: DriftSeverity = "NONE";
  let action: DriftAction = "NO_CHANGE";
  if (maximumObservedDrift >= input.criticalThreshold) {
    severity = "CRITICAL";
    action = "SUSPEND_ELIGIBILITY";
  } else if (maximumObservedDrift >= input.materialThreshold) {
    severity = "MATERIAL";
    action = "REDUCE_ELIGIBILITY";
  } else if (maximumObservedDrift >= input.watchThreshold) {
    severity = "WATCH";
    action = "COLLECT_MORE_EVIDENCE";
  }
  if (reasons.length === 0) reasons.push(severity === "WATCH" ? "DRIFT_WATCH" : "NO_MATERIAL_DRIFT");

  return freeze({
    candidateId: o.candidateId,
    strategyFamilyId: o.strategyFamilyId,
    regime: o.regime,
    severity,
    action,
    maximumObservedDrift,
    reasons: freeze([...new Set(reasons)].sort()),
    confidenceIncreaseAllowed: false,
    lifecycleMutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
