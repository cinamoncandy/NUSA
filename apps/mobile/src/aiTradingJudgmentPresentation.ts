import type { AiTradingJudgment } from "../../../packages/contracts/src/aiTradingJudgment";

export interface AiTradingJudgmentPresentation {
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly market: string;
  readonly thesis: string;
  readonly actionLabel: string;
  readonly actionAuthorityLabel: "AI 판단 · 실행 권한 없음";
  readonly regimeLabel: string;
  readonly confidenceLabel: string;
  readonly uncertaintyLabel: string;
  readonly expectedReturnLabel: string;
  readonly downsideLabel: string;
  readonly riskBudgetLabel: string;
  readonly horizonLabel: string;
  readonly invalidationCondition: string;
  readonly scenarioCount: number;
  readonly evidenceCount: number;
  readonly counterEvidenceCount: number;
}

const unavailable = (): AiTradingJudgmentPresentation => Object.freeze({
  status: "UNAVAILABLE",
  market: "-",
  thesis: "검증된 통합 AI 판단이 없습니다.",
  actionLabel: "판단 없음",
  actionAuthorityLabel: "AI 판단 · 실행 권한 없음",
  regimeLabel: "-",
  confidenceLabel: "-",
  uncertaintyLabel: "-",
  expectedReturnLabel: "-",
  downsideLabel: "-",
  riskBudgetLabel: "-",
  horizonLabel: "-",
  invalidationCondition: "-",
  scenarioCount: 0,
  evidenceCount: 0,
  counterEvidenceCount: 0,
});

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function duration(ms: number): string {
  const day = 86_400_000;
  const hour = 3_600_000;
  if (ms % day === 0) return `${ms / day}일`;
  if (ms % hour === 0) return `${ms / hour}시간`;
  return `${Math.round(ms / 60_000)}분`;
}

const actionLabels: Readonly<Record<AiTradingJudgment["action"], string>> = Object.freeze({
  LONG: "LONG 관찰 판단",
  SHORT: "SHORT 관찰 판단",
  EXIT: "EXIT 관찰 판단",
  HOLD: "HOLD 관찰 판단",
  ABSTAIN: "판단 보류",
});

/**
 * Converts an already-validated AiTradingJudgment into display-only strings.
 * It never creates a recommendation from missing data and deliberately labels the
 * directional action as an AI observation with no execution authority.
 */
export function presentAiTradingJudgment(
  judgment: AiTradingJudgment | null | undefined,
): AiTradingJudgmentPresentation {
  if (judgment == null) return unavailable();
  return Object.freeze({
    status: "AVAILABLE",
    market: judgment.market,
    thesis: judgment.thesis,
    actionLabel: actionLabels[judgment.action],
    actionAuthorityLabel: "AI 판단 · 실행 권한 없음",
    regimeLabel: judgment.marketRegime,
    confidenceLabel: percentage(judgment.confidence),
    uncertaintyLabel: percentage(judgment.uncertainty),
    expectedReturnLabel: percentage(judgment.expectedReturn),
    downsideLabel: percentage(judgment.downside),
    riskBudgetLabel: percentage(judgment.riskBudget),
    horizonLabel: duration(judgment.timeHorizonMs),
    invalidationCondition: judgment.invalidationCondition,
    scenarioCount: judgment.scenarios.length,
    evidenceCount: judgment.evidence.length,
    counterEvidenceCount: judgment.counterEvidence.length,
  });
}
