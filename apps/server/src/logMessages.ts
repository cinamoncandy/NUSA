/**
 * Translates the English event-log messages recorded by ControlPlane.record() (both this
 * server's own paperRuntime.ts/pipeline/*.ts calls, and the reused apps/desktop ControlPlane/
 * RuntimeCommandService/StrategyEngine calls, imported as-is -- see errorMessages.ts's own doc
 * comment for why those aren't modified directly) into Korean for the 감사 tab's 이벤트 로그
 * table, the same "every user-visible surface is fixed to Korean" goal as errorMessages.ts.
 *
 * Applied only where /api/control is served (apiRouter.ts) -- the underlying ControlEvent
 * objects (and any test that asserts on their exact English text) are untouched.
 */

const EVENT_TYPE_KO: Readonly<Record<string, string>> = Object.freeze({
  SIGNAL: "신호", STATUS: "상태", SYSTEM: "시스템", ORDER: "주문", RISK: "리스크"
});

export function translateEventType(type: string): string {
  return EVENT_TYPE_KO[type] ?? type;
}

// StrategyEngine/emaCrossoverStrategy.ts's TradingSignal.reason values (see strategyEngine.ts,
// emaCrossoverStrategy.ts) -- a fixed, fully enumerated set.
const SIGNAL_REASON_KO: Readonly<Record<string, string>> = Object.freeze({
  "warming-up": "워밍업 중",
  "baseline-established": "기준선 설정됨",
  "no-cross": "교차 없음",
  "strategy-stopped": "전략 중지됨",
  "short-SMA crossed above long-SMA": "단기 SMA가 장기 SMA를 상향 돌파",
  "short-SMA crossed below long-SMA": "단기 SMA가 장기 SMA를 하향 돌파",
  "short-EMA crossed above long-EMA": "단기 EMA가 장기 EMA를 상향 돌파",
  "short-EMA crossed below long-EMA": "단기 EMA가 장기 EMA를 하향 돌파"
});

const SIGNAL_TYPE_KO: Readonly<Record<string, string>> = Object.freeze({ BUY: "매수", SELL: "매도", HOLD: "보류" });

// packages/core/src/risk/riskEngine.ts's RiskRejectionCode / packages/core/src/order/orderPlanner.ts's
// PlannerFailureCode -- the value-based audit-only estimate's own codes (see paperRuntime.ts's
// constructor comment: "audit-only for the pricing estimate, but risk-blocking for real").
const VALUE_CHECK_CODE_KO: Readonly<Record<string, string>> = Object.freeze({
  INVALID_QUANTITY: "수량이 올바르지 않음",
  INVALID_MARKET_PRICE: "시장가가 올바르지 않음",
  INVALID_POLICY: "정책 설정이 올바르지 않음",
  BELOW_MINIMUM_ORDER_VALUE: "최소 주문 금액 미만",
  INSUFFICIENT_BALANCE: "잔고 부족",
  MAXIMUM_POSITION_EXCEEDED: "최대 보유 한도 초과",
  RISK_BLOCKED: "리스크 검사에서 차단됨",
  INVALID_EXECUTION_PRICE: "체결가가 올바르지 않음",
  INVALID_ORDER_VALUE: "주문 금액이 올바르지 않음"
});

const PROTECTION_LABEL_KO: Readonly<Record<string, string>> = Object.freeze({
  "stop-loss": "스탑로스", "take-profit": "익절", "trailing-stop": "트레일링 스탑"
});

const EXACT_LOG_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "strategy started": "전략이 시작됨",
  "strategy stopped": "전략이 중지됨",
  "strategy paused": "전략이 일시정지됨",
  "paper auto trading enabled": "Paper 자동매매가 활성화됨",
  "paper auto trading disabled": "Paper 자동매매가 비활성화됨",
  "control state restored; paper auto trading remains disabled": "제어 상태가 복원됨 (Paper 자동매매는 비활성 상태 유지)",
  "insufficient paper position": "보유 수량이 부족함",
  "automatic trading is not enabled": "자동매매가 활성화되어 있지 않음",
  "planned order computed": "주문 계획이 계산됨",
  "execution report (manual)": "체결 보고서 (수동)",
  "execution report": "체결 보고서",
  "reference portfolio": "참조 포트폴리오"
});

const LOG_PATTERN_TRANSLATORS: readonly { readonly pattern: RegExp; readonly translate: (m: RegExpMatchArray) => string }[] = [
  { pattern: /^order quantity set to (.+)$/, translate: (m) => `주문 수량이 ${m[1]}(으)로 설정됨` },
  { pattern: /^manual (BUY|SELL) filled$/, translate: (m) => `수동 ${SIGNAL_TYPE_KO[m[1]!]} 체결됨` },
  { pattern: /^automatic (BUY|SELL|HOLD) filled$/, translate: (m) => `자동 ${SIGNAL_TYPE_KO[m[1]!]} 체결됨` },
  {
    pattern: /^(BUY|SELL|HOLD): (.+)$/,
    translate: (m) => `${SIGNAL_TYPE_KO[m[1]!]}: ${SIGNAL_REASON_KO[m[2]!] ?? m[2]}`
  },
  {
    pattern: /^(stop-loss|take-profit|trailing-stop) triggered at (.+): closed (.+) (.+)$/,
    translate: (m) => `${PROTECTION_LABEL_KO[m[1]!]} 발동 (가격 ${m[2]}): ${m[3]} ${m[4]} 청산`
  },
  {
    pattern: /^(stop-loss|take-profit|trailing-stop) trigger failed, protection disabled: (.+)$/,
    translate: (m) => `${PROTECTION_LABEL_KO[m[1]!]} 발동 실패, 보호 설정 해제됨: ${m[2]}`
  },
  {
    pattern: /^limit order triggered at (.+): (BUY|SELL) (.+) \(limit (.+)\)$/,
    translate: (m) => `지정가 주문 체결 (가격 ${m[1]}): ${SIGNAL_TYPE_KO[m[2]!]} ${m[3]} (지정가 ${m[4]})`
  },
  { pattern: /^limit order failed, cancelled: (.+)$/, translate: (m) => `지정가 주문 실패로 취소됨: ${m[1]}` },
  { pattern: /^limit order placed: (BUY|SELL) (.+) @ (.+)$/, translate: (m) => `지정가 주문 등록: ${SIGNAL_TYPE_KO[m[1]!]} ${m[2]} @ ${m[3]}` },
  { pattern: /^limit order cancelled: (BUY|SELL) (.+) @ (.+)$/, translate: (m) => `지정가 주문 취소됨: ${SIGNAL_TYPE_KO[m[1]!]} ${m[2]} @ ${m[3]}` },
  {
    pattern: /^position protection set: stopLoss=(.+) takeProfit=(.+) trailingStopPercent=(.+)$/,
    translate: (m) => `포지션 보호 설정: 스탑로스=${m[1]} 익절=${m[2]} 트레일링 스탑 비율=${m[3]}`
  },
  { pattern: /^position sizing set: mode=(.+)$/, translate: (m) => `포지션 사이징 설정: 모드=${m[1]}` },
  { pattern: /^strategy periods set: short=(.+) long=(.+)$/, translate: (m) => `전략 기간 설정: 단기=${m[1]} 장기=${m[2]}` },
  { pattern: /^champion promoted: (.+)$/, translate: (m) => `챔피언 승격: ${m[1]}` },
  { pattern: /^reference accounting diverged from the real account: (.+)$/, translate: (m) => `참조 회계가 실제 계좌와 불일치함: ${m[1]}` },
  // "CODE: reason text" from the value-based audit-only RiskEngine/OrderPlanner estimate --
  // translates the known code prefix, keeps the (numeric-heavy, already-language-neutral)
  // reason detail as-is rather than guessing at an exhaustive regex for every embedded number.
  {
    pattern: /^([A-Z_]+): (.+)$/,
    translate: (m) => (VALUE_CHECK_CODE_KO[m[1]!] !== undefined ? `${VALUE_CHECK_CODE_KO[m[1]!]}: ${m[2]}` : m[0]!)
  }
];

/**
 * Unlike errorMessages.ts's translateErrorMessage() (which always prefixes an unrecognized
 * message with "오류: " since every input there is, by construction, a rejected request), a log
 * entry can be routine (STATUS/SYSTEM) rather than a failure -- so an unrecognized message here
 * is returned unchanged rather than wrapped in a Korean word that would misrepresent it as an
 * error. The enumerated set above (drawn directly from every ControlPlane.record() call site
 * this app's request paths can reach) is expected to cover the real cases; this is a graceful
 * fallback for anything new, not the primary path.
 */
export function translateLogMessage(message: string): string {
  const exact = EXACT_LOG_MESSAGES[message];
  if (exact !== undefined) return exact;
  for (const { pattern, translate } of LOG_PATTERN_TRANSLATORS) {
    const match = message.match(pattern);
    if (match) return translate(match);
  }
  return message;
}
