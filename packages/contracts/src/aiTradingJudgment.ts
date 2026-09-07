/**
 * Unified AI trading judgment object (NUSA governing charter section 9).
 *
 * "AI 판단은 단순 BUY/SELL이 아니다." Every judgment this type represents carries its thesis, its
 * supporting evidence AND counter-evidence, an explicit confidence/uncertainty pair (never
 * confidence alone), the market regime it was formed under, a scenario set, expected return and
 * downside, a risk budget, a time horizon, and an explicit invalidation condition -- so the "AI
 * screen" (thesis/evidence/counter-evidence/confidence/uncertainty/scenarios/invalidation/decision)
 * and "What Changed" panel described by the charter's UI sections have one authoritative object to
 * render, not several partial ones assembled ad hoc per screen.
 *
 * This module is intentionally a *summary/rendering* contract, not a new decision engine: the
 * existing multi-agent ballot process (decision.ts) still produces the actual DecisionResult;
 * AiTradingJudgment is what wraps a decision's action with the explanation a human approver or the
 * AI screen needs to see. Reuses MarketRegime and DecisionAction rather than reintroducing them.
 */
import type { MarketRegime } from "./marketRegime";
import { DecisionAction } from "./decision";

/**
 * Every evidence item is tagged with what kind of claim it actually is. This is the "AI는 항상
 * 구분한다: KNOWN/UNKNOWN/ESTIMATE/ASSUMPTION/RISK/INVALIDATION" requirement made structural: a
 * caller cannot render an ESTIMATE as if it were KNOWN because the type carries the distinction.
 */
export type AiEpistemicStatus = "KNOWN" | "UNKNOWN" | "ESTIMATE" | "ASSUMPTION" | "RISK" | "INVALIDATION";

export const AI_EPISTEMIC_STATUSES: readonly AiEpistemicStatus[] = Object.freeze([
  "KNOWN",
  "UNKNOWN",
  "ESTIMATE",
  "ASSUMPTION",
  "RISK",
  "INVALIDATION",
]);

export interface AiTradingEvidenceItem {
  readonly id: string;
  readonly statement: string;
  readonly status: AiEpistemicStatus;
  /** References into an existing evidence bundle (see evidenceBundleBuilder.ts); opaque here. */
  readonly evidenceRefs: readonly string[];
}

export interface AiTradingScenario {
  readonly id: string;
  readonly label: string;
  /** 0..1. All scenario probabilities for one judgment should sum to ~1, validated by the caller. */
  readonly probability: number;
  readonly expectedReturn: number;
  readonly narrative: string;
}

export interface AiTradingJudgment {
  readonly schemaVersion: 1;
  readonly judgmentId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly generatedAt: string;
  readonly thesis: string;
  readonly evidence: readonly AiTradingEvidenceItem[];
  readonly counterEvidence: readonly AiTradingEvidenceItem[];
  /** 0..1, calibrated probability the thesis is directionally correct. */
  readonly confidence: number;
  /** 0..1. Not "1 - confidence": a judgment can be both low-confidence AND low-uncertainty (a
   * calibrated coin flip) or high-confidence AND high-uncertainty (thin evidence pointing one way). */
  readonly uncertainty: number;
  readonly marketRegime: MarketRegime;
  readonly scenarios: readonly AiTradingScenario[];
  readonly expectedReturn: number;
  /** Worst-case return estimate; must be <= expectedReturn. */
  readonly downside: number;
  /** 0..1, fraction of allocatable capital this judgment is willing to risk. */
  readonly riskBudget: number;
  readonly timeHorizonMs: number;
  readonly invalidationCondition: string;
  readonly action: DecisionAction;
}

export interface AiTradingJudgmentValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const nonEmptyText = (value: unknown, maxLength = 2_000): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
const unitInterval = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validateEvidenceItem(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}:INVALID`);
    return;
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !ID.test(item.id)) errors.push(`${path}:ID_INVALID`);
  if (!nonEmptyText(item.statement)) errors.push(`${path}:STATEMENT_INVALID`);
  if (typeof item.status !== "string" || !AI_EPISTEMIC_STATUSES.includes(item.status as AiEpistemicStatus)) errors.push(`${path}:STATUS_INVALID`);
  if (!Array.isArray(item.evidenceRefs) || !item.evidenceRefs.every((ref) => typeof ref === "string" && ref.trim().length > 0)) {
    errors.push(`${path}:EVIDENCE_REFS_INVALID`);
  }
}

function validateScenario(value: unknown, path: string, errors: string[]): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}:INVALID`);
    return 0;
  }
  const scenario = value as Record<string, unknown>;
  if (typeof scenario.id !== "string" || !ID.test(scenario.id)) errors.push(`${path}:ID_INVALID`);
  if (!nonEmptyText(scenario.label, 64)) errors.push(`${path}:LABEL_INVALID`);
  if (!unitInterval(scenario.probability)) errors.push(`${path}:PROBABILITY_INVALID`);
  if (!finiteNumber(scenario.expectedReturn)) errors.push(`${path}:EXPECTED_RETURN_INVALID`);
  if (!nonEmptyText(scenario.narrative)) errors.push(`${path}:NARRATIVE_INVALID`);
  return typeof scenario.probability === "number" ? scenario.probability : 0;
}

const PROBABILITY_SUM_TOLERANCE = 0.02;

/**
 * Validates an AiTradingJudgment. Fails closed on any malformed, missing, or out-of-range field,
 * including cross-field checks a naive per-field validator would miss: downside above expected
 * return, or scenario probabilities that don't sum to ~1.
 */
export function validateAiTradingJudgment(value: unknown): AiTradingJudgmentValidation {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["JUDGMENT_INVALID"] };
  }
  const judgment = value as Record<string, unknown>;

  if (judgment.schemaVersion !== 1) errors.push("SCHEMA_VERSION_INVALID");
  if (typeof judgment.judgmentId !== "string" || !ID.test(judgment.judgmentId)) errors.push("JUDGMENT_ID_INVALID");
  if (typeof judgment.strategyId !== "string" || !ID.test(judgment.strategyId)) errors.push("STRATEGY_ID_INVALID");
  if (typeof judgment.market !== "string" || !ID.test(judgment.market)) errors.push("MARKET_INVALID");
  if (typeof judgment.generatedAt !== "string" || !Number.isFinite(Date.parse(judgment.generatedAt))) errors.push("GENERATED_AT_INVALID");
  if (!nonEmptyText(judgment.thesis)) errors.push("THESIS_INVALID");

  if (!Array.isArray(judgment.evidence) || judgment.evidence.length === 0) {
    errors.push("EVIDENCE_REQUIRED");
  } else {
    judgment.evidence.forEach((item, index) => validateEvidenceItem(item, `evidence[${index}]`, errors));
  }
  if (!Array.isArray(judgment.counterEvidence)) {
    errors.push("COUNTER_EVIDENCE_INVALID");
  } else {
    judgment.counterEvidence.forEach((item, index) => validateEvidenceItem(item, `counterEvidence[${index}]`, errors));
  }

  if (!unitInterval(judgment.confidence)) errors.push("CONFIDENCE_INVALID");
  if (!unitInterval(judgment.uncertainty)) errors.push("UNCERTAINTY_INVALID");
  if (typeof judgment.marketRegime !== "string" || judgment.marketRegime.trim().length === 0) errors.push("MARKET_REGIME_INVALID");

  let probabilitySum = 0;
  if (!Array.isArray(judgment.scenarios) || judgment.scenarios.length === 0) {
    errors.push("SCENARIOS_REQUIRED");
  } else {
    judgment.scenarios.forEach((scenario, index) => {
      probabilitySum += validateScenario(scenario, `scenarios[${index}]`, errors);
    });
    if (Math.abs(probabilitySum - 1) > PROBABILITY_SUM_TOLERANCE) errors.push("SCENARIO_PROBABILITIES_NOT_NORMALIZED");
  }

  if (!finiteNumber(judgment.expectedReturn)) errors.push("EXPECTED_RETURN_INVALID");
  if (!finiteNumber(judgment.downside)) errors.push("DOWNSIDE_INVALID");
  else if (finiteNumber(judgment.expectedReturn) && (judgment.downside as number) > (judgment.expectedReturn as number)) {
    errors.push("DOWNSIDE_EXCEEDS_EXPECTED_RETURN");
  }
  if (!unitInterval(judgment.riskBudget)) errors.push("RISK_BUDGET_INVALID");
  if (!Number.isSafeInteger(judgment.timeHorizonMs) || (judgment.timeHorizonMs as number) <= 0) errors.push("TIME_HORIZON_INVALID");
  if (!nonEmptyText(judgment.invalidationCondition)) errors.push("INVALIDATION_CONDITION_INVALID");
  if (typeof judgment.action !== "string" || !Object.values(DecisionAction).includes(judgment.action as DecisionAction)) {
    errors.push("ACTION_INVALID");
  }

  return { valid: errors.length === 0, errors: Object.freeze([...new Set(errors)]) };
}

export function isValidAiTradingJudgment(value: unknown): value is AiTradingJudgment {
  return validateAiTradingJudgment(value).valid;
}
