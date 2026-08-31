import {
  validateAiTradingJudgment,
  type AiTradingEvidenceItem,
  type AiTradingJudgment,
  type AiTradingScenario,
} from "../../../../packages/contracts/src/aiTradingJudgment";
import type { DecisionResult } from "../../../../packages/contracts/src/decision";
import type { MarketRegime } from "../../../../packages/contracts/src/marketRegime";
import type { EvidenceBundle } from "./evidenceBundleBuilder";

export interface AiTradingJudgmentBridgeInput {
  readonly judgmentId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly generatedAt: string;
  readonly thesis: string;
  readonly evidence: readonly AiTradingEvidenceItem[];
  readonly counterEvidence: readonly AiTradingEvidenceItem[];
  readonly confidence: number;
  readonly uncertainty: number;
  readonly marketRegime: MarketRegime;
  readonly scenarios: readonly AiTradingScenario[];
  readonly expectedReturn: number;
  readonly downside: number;
  readonly riskBudget: number;
  readonly timeHorizonMs: number;
  readonly invalidationCondition: string;
  readonly decision: DecisionResult;
  readonly evidenceBundle: EvidenceBundle;
}

function assertEvidenceBound(
  items: readonly AiTradingEvidenceItem[],
  availableEvidenceIds: ReadonlySet<string>,
  path: string,
): void {
  for (const [index, item] of items.entries()) {
    if (item.evidenceRefs.length === 0) {
      throw new Error(`AI_TRADING_JUDGMENT_${path}_${index}_EVIDENCE_REQUIRED`);
    }
    for (const evidenceRef of item.evidenceRefs) {
      if (!availableEvidenceIds.has(evidenceRef)) {
        throw new Error(`AI_TRADING_JUDGMENT_${path}_${index}_EVIDENCE_UNBOUND:${evidenceRef}`);
      }
    }
  }
}

/**
 * Builds the canonical human-facing trading judgment from already-produced analytical truth.
 *
 * This bridge deliberately does not infer a thesis, manufacture evidence, recalibrate confidence,
 * choose a market regime, create scenarios, size risk, or choose an action. Those values must come
 * from their existing authoritative producers. The action is copied from DecisionResult and every
 * displayed evidence reference must be present in the verified EvidenceBundle.
 */
export function buildAiTradingJudgment(input: AiTradingJudgmentBridgeInput): AiTradingJudgment {
  const availableEvidenceIds = new Set(input.evidenceBundle.evidence.map((item) => item.evidenceId));
  if (availableEvidenceIds.size === 0) throw new Error("AI_TRADING_JUDGMENT_EVIDENCE_BUNDLE_EMPTY");

  assertEvidenceBound(input.evidence, availableEvidenceIds, "EVIDENCE");
  assertEvidenceBound(input.counterEvidence, availableEvidenceIds, "COUNTER_EVIDENCE");

  const judgment: AiTradingJudgment = {
    schemaVersion: 1,
    judgmentId: input.judgmentId,
    strategyId: input.strategyId,
    market: input.market,
    generatedAt: input.generatedAt,
    thesis: input.thesis,
    evidence: Object.freeze(input.evidence.map((item) => Object.freeze({ ...item, evidenceRefs: Object.freeze([...item.evidenceRefs]) }))),
    counterEvidence: Object.freeze(input.counterEvidence.map((item) => Object.freeze({ ...item, evidenceRefs: Object.freeze([...item.evidenceRefs]) }))),
    confidence: input.confidence,
    uncertainty: input.uncertainty,
    marketRegime: input.marketRegime,
    scenarios: Object.freeze(input.scenarios.map((scenario) => Object.freeze({ ...scenario }))),
    expectedReturn: input.expectedReturn,
    downside: input.downside,
    riskBudget: input.riskBudget,
    timeHorizonMs: input.timeHorizonMs,
    invalidationCondition: input.invalidationCondition,
    action: input.decision.action,
  };

  const validation = validateAiTradingJudgment(judgment);
  if (!validation.valid) {
    throw new Error(`AI_TRADING_JUDGMENT_INVALID:${validation.errors.join(",")}`);
  }

  return Object.freeze(judgment);
}
