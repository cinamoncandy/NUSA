/**
 * Plain-Korean labels for the monitor screens (PAPER learning, markets, LIVE readiness). A label with no entry is
 * shown as given, so an unknown or server-supplied term is never altered or hidden. Safety wording such as
 * "PAPER ONLY", "LIVE NONE" and "ZERO AUTHORITY" is values, not labels, and is deliberately not translated.
 */
const LABELS: Readonly<Record<string, string>> = Object.freeze({
  MARKET: "시장", CYCLE: "주기", DATA: "데이터", SIGNAL: "신호", DECISION: "판단", MODE: "모드", LIVE: "라이브", RISK: "위험",
  "PERMISSION GATES": "권한 관문", ORDER: "주문", FILL: "체결", CASH: "현금", EQUITY: "자산",
  "REALIZED PNL": "실현 손익", "UNREALIZED PNL": "평가 손익", "FEE / SLIPPAGE": "수수료 · 슬리피지",
  OUTCOME: "결과", SCORE: "점수", EVIDENCE: "근거", "INPUT HASH": "입력 해시",
  REALIZED: "실현", UNREALIZED: "평가", "WIN RATE": "승률", "MAX DD": "최대 낙폭",
  "CYCLES / FILLED": "주기 · 체결", FEES: "수수료", TURNOVER: "회전율", EXPECTANCY: "기대값",
  "EVIDENCE DETAIL": "근거 상세", "NO COMPLETED CYCLE": "완료된 주기 없음", "NO EVENTS": "이벤트 없음",
  "LOCAL FALLBACK": "기기 기록 대체", "STALE DATA": "오래된 시세", "PUBLIC FEED ERROR": "공개 시세 오류",
  "PAPER CONTEXT": "PAPER 참고", STRATEGY: "전략",
});

export const monitorLabel = (label: string): string => LABELS[label] ?? label;
export const MONITOR_LABEL_KEYS: readonly string[] = Object.freeze(Object.keys(LABELS));
