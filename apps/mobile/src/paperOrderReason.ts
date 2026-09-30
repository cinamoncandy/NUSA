/**
 * Answers "why was no PAPER order placed?" from the coded outcome the cloud boundary publishes
 * (`STATUS:REASON`, see `paperDecisionOutcome.ts`). Presentation only: it never infers a reason the
 * cloud did not report, and an unrecognised code is shown verbatim instead of being guessed at.
 */
export type PaperOrderReasonCategory = "FILLED" | "WAITING" | "RISK_BLOCKED" | "EXECUTION_BLOCKED" | "INSUFFICIENT_EVIDENCE" | "UNKNOWN";

export interface PaperOrderReason {
  readonly category: PaperOrderReasonCategory;
  readonly text: string;
  readonly code: string;
}

const OUTCOME = /^([A-Z]{3,12}):([A-Z0-9_.:+-]{1,100})$/;

const KNOWN: Readonly<Record<string, Readonly<{ category: PaperOrderReasonCategory; text: string }>>> = Object.freeze({
  "WAIT:NO_ACTIONABLE_PAPER_DECISION": { category: "WAITING", text: "전략이 매수·매도 신호를 내지 않아 주문하지 않았습니다." },
  "BLOCKED:PAPER_INVESTMENT_ALLOCATION_EXCEEDED": { category: "EXECUTION_BLOCKED", text: "투자 비중 한도를 넘는 주문이라 실행하지 않았습니다." },
  "BLOCKED:PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_CASH": { category: "EXECUTION_BLOCKED", text: "업비트 최소 주문금액(₩5,000)을 맞출 가용 현금이 부족해 주문하지 않았습니다." },
  "BLOCKED:PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_EQUITY_CEILING": { category: "EXECUTION_BLOCKED", text: "최소 주문금액이 자산의 60% 한도를 넘어 주문하지 않았습니다." },
  "BLOCKED:PAPER_EXECUTION_INTENT_EXECUTABLE_QUOTE_BELOW_MINIMUM": { category: "EXECUTION_BLOCKED", text: "호가 기준 주문액이 최소 주문금액(₩5,000) 미만이라 주문하지 않았습니다." },
  "BLOCKED:PAPER_PORTFOLIO_EXECUTION_INTENT_REQUIRED": { category: "EXECUTION_BLOCKED", text: "포트폴리오 실행 계획이 없어 주문하지 않았습니다." },
  "BLOCKED:OPEN_P0_ALERT": { category: "RISK_BLOCKED", text: "열린 중대 경보가 있어 주문을 막았습니다." },
  "BLOCKED:P0_STATE_UNVERIFIABLE": { category: "RISK_BLOCKED", text: "경보 상태를 확인할 수 없어 주문을 막았습니다." },
  "BLOCKED:STRATEGY_APPROVAL_REJECTED": { category: "RISK_BLOCKED", text: "전략 승인 조건(신뢰도·위험 등급)을 충족하지 못해 주문하지 않았습니다." },
  "BLOCKED:PAPER_CANDIDATE_BINDING_REQUIRED": { category: "INSUFFICIENT_EVIDENCE", text: "검증된 후보 전략 근거가 없어 자동 주문을 하지 않았습니다." },
});

export function describePaperOrderReason(outcome: string | null | undefined): PaperOrderReason | null {
  if (typeof outcome !== "string") return null;
  const match = OUTCOME.exec(outcome);
  if (match == null) return null;
  const status = match[1]!;
  const known = KNOWN[outcome];
  if (known != null) return Object.freeze({ ...known, code: outcome });
  if (status === "FILLED") return Object.freeze({ category: "FILLED" as const, text: "직전 판단이 체결되었습니다.", code: outcome });
  if (status === "REJECTED") return Object.freeze({ category: "RISK_BLOCKED" as const, text: `위험 검사가 주문을 거부했습니다 (${match[2]}).`, code: outcome });
  return Object.freeze({ category: "UNKNOWN" as const, text: `직전 판단 결과: ${outcome}`, code: outcome });
}
