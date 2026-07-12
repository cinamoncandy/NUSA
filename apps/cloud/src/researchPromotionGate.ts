export interface ResearchEvidence {
  readonly strategyId: string;
  readonly dataFingerprint: string;
  readonly currentDataFingerprint: string;
  readonly deflatedSharpeRatio: number;
  readonly oosIsRatio: number;
  readonly oosTrades: number;
  readonly oosProfitFactor: number;
  readonly positiveWalkForwardShare: number;
  readonly monteCarloRuinProbability: number;
  readonly worstCostStressReturn: number;
  readonly paperTradingDays: number;
}

export interface PromotionGateResult {
  readonly verdict: "PROMOTE_TO_PAPER" | "KEEP_IN_RESEARCH" | "REJECT_STALE_DATA";
  readonly checks: readonly { readonly id: string; readonly passed: boolean; readonly value: number | string; readonly threshold: number | string }[];
  readonly failedChecks: readonly string[];
}

const finite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

export function evaluateResearchPromotion(evidence: ResearchEvidence): PromotionGateResult {
  if (!evidence.strategyId.trim()) throw new Error("strategyId is required");
  if (!evidence.dataFingerprint.trim() || !evidence.currentDataFingerprint.trim()) throw new Error("data fingerprints are required");
  for (const [field, value] of Object.entries(evidence)) {
    if (typeof value === "number") finite(value, field);
  }

  if (evidence.dataFingerprint !== evidence.currentDataFingerprint) {
    return Object.freeze({
      verdict: "REJECT_STALE_DATA",
      checks: Object.freeze([{ id: "data_fingerprint", passed: false, value: evidence.dataFingerprint, threshold: evidence.currentDataFingerprint }]),
      failedChecks: Object.freeze(["data_fingerprint"])
    });
  }

  const checks = [
    { id: "dsr", passed: evidence.deflatedSharpeRatio >= 0.9, value: evidence.deflatedSharpeRatio, threshold: 0.9 },
    { id: "oos_is", passed: evidence.oosIsRatio >= 0.8, value: evidence.oosIsRatio, threshold: 0.8 },
    { id: "oos_trades", passed: evidence.oosTrades >= 30, value: evidence.oosTrades, threshold: 30 },
    { id: "profit_factor", passed: evidence.oosProfitFactor >= 1.2, value: evidence.oosProfitFactor, threshold: 1.2 },
    { id: "walk_forward", passed: evidence.positiveWalkForwardShare >= 0.6, value: evidence.positiveWalkForwardShare, threshold: 0.6 },
    { id: "ruin_probability", passed: evidence.monteCarloRuinProbability <= 0.02, value: evidence.monteCarloRuinProbability, threshold: 0.02 },
    { id: "cost_stress", passed: evidence.worstCostStressReturn >= 0, value: evidence.worstCostStressReturn, threshold: 0 },
    { id: "paper_days", passed: evidence.paperTradingDays >= 0, value: evidence.paperTradingDays, threshold: 0 }
  ] as const;
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.id);

  return Object.freeze({
    verdict: failedChecks.length === 0 ? "PROMOTE_TO_PAPER" : "KEEP_IN_RESEARCH",
    checks: Object.freeze(checks.map((check) => Object.freeze({ ...check }))),
    failedChecks: Object.freeze(failedChecks)
  });
}
