/**
 * Translates the English domain-error messages thrown by this server's own validation
 * (apiRouter.ts) and by the reused apps/desktop business logic (PaperBroker/ControlPlane/
 * RuntimeCommandService, imported as-is -- not modified for this product, see paperRuntime.ts's
 * own doc comment) into Korean, so that every error the operator actually sees in the browser
 * (apps/web/app.js's submitCommand writes error.message straight into the page) matches the
 * rest of the UI's fixed-Korean text instead of switching to raw English mid-sentence.
 *
 * Deliberately applied only at this one boundary (apiRouter.ts's errorResponse()) rather than
 * inside paperRuntime.ts or apps/desktop: the domain layer's own thrown messages, and their
 * existing tests that assert on that exact English text, are untouched.
 */

const FIELD_NAMES_KO: Readonly<Record<string, string>> = Object.freeze({
  quantity: "수량",
  limitPrice: "지정가",
  riskFraction: "리스크 비율",
  stopLossPrice: "스탑로스 가격",
  takeProfitPrice: "익절 가격",
  trailingStopPercent: "트레일링 스탑 비율",
  shortPeriod: "단기 기간",
  longPeriod: "장기 기간",
  enabled: "사용 여부",
  webhookUrl: "웹훅 URL"
});

function fieldKo(name: string): string {
  return FIELD_NAMES_KO[name] ?? name;
}

const EXACT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  // apiRouter.ts request validation / httpServer.ts request-parsing errors
  "request body must be a JSON object": "요청 본문은 JSON 객체여야 합니다",
  "request body too large": "요청 본문이 너무 큽니다",
  "request body must be valid JSON": "요청 본문이 올바른 JSON 형식이 아닙니다",
  "NOT_FOUND": "요청한 경로를 찾을 수 없습니다",
  "METHOD_NOT_ALLOWED": "허용되지 않는 요청 방식입니다",
  "TOO_MANY_REQUESTS": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  "side must be \"BUY\" or \"SELL\"": "구분(side)은 \"BUY\" 또는 \"SELL\"이어야 합니다",
  "unit must be \"minute\" or \"day\"": "기간(unit)은 \"minute\" 또는 \"day\"여야 합니다",
  "mode must be \"FIXED\" or \"FIXED_FRACTIONAL\"": "사이징 방식(mode)은 \"FIXED\" 또는 \"FIXED_FRACTIONAL\"이어야 합니다",
  "id must be a non-empty string": "id는 비어 있지 않은 문자열이어야 합니다",

  // paperRuntime.ts domain validation
  "quantity must be a positive number": "수량은 0보다 큰 숫자여야 합니다",
  "limitPrice must be a positive number": "지정가는 0보다 큰 숫자여야 합니다",
  "stopLossPrice must be a positive number or null": "스탑로스 가격은 0보다 큰 숫자이거나 비어 있어야 합니다",
  "takeProfitPrice must be a positive number or null": "익절 가격은 0보다 큰 숫자이거나 비어 있어야 합니다",
  "stopLossPrice must be less than takeProfitPrice": "스탑로스 가격은 익절 가격보다 낮아야 합니다",
  "trailingStopPercent must be finite and within (0, 1) or null": "트레일링 스탑 비율은 0~1 사이의 숫자이거나 비어 있어야 합니다",
  "stopLossPrice and trailingStopPercent are mutually exclusive -- set only one": "스탑로스 가격과 트레일링 스탑은 동시에 설정할 수 없습니다",
  "riskFraction must be finite and within (0, 1] when mode is FIXED_FRACTIONAL": "FIXED_FRACTIONAL 모드에서는 리스크 비율이 0보다 크고 1 이하의 숫자여야 합니다",
  "market price is not available yet": "아직 시세 정보를 사용할 수 없습니다",
  "market price is stale; waiting for a fresh update": "시세 정보가 오래되어 갱신을 기다리는 중입니다",
  "no open position to close": "청산할 보유 포지션이 없습니다",
  "webhookUrl must be a valid http(s) URL when notifications are enabled": "알림을 사용하려면 웹훅 URL이 올바른 http(s) 주소여야 합니다",
  "no webhookUrl is configured": "설정된 웹훅 URL이 없습니다",

  // apps/desktop/src/strategyEngine.ts / apps/server/src/emaCrossoverStrategy.ts -- thrown by
  // SmaCrossoverStrategy/EmaCrossoverStrategy's own constructors, reached via POST
  // /api/strategy/periods (paperRuntime.ts's setStrategyPeriods() reuses their validation
  // rather than duplicating it -- see that file's own doc comment).
  "invalid SMA periods": "SMA 기간이 올바르지 않습니다 (단기 기간은 2 이상, 장기 기간은 단기 기간보다 커야 합니다)",
  "invalid EMA periods": "EMA 기간이 올바르지 않습니다 (단기 기간은 2 이상, 장기 기간은 단기 기간보다 커야 합니다)",

  // apps/desktop/src/paperBroker.ts (PaperBroker.execute), reached via manual/limit orders and
  // position protection triggers
  "invalid paper side": "잘못된 매매 구분입니다",
  "quantity must be positive": "수량은 0보다 커야 합니다",
  "price must be positive": "가격은 0보다 커야 합니다",
  "price does not align to tick size": "가격이 호가 단위에 맞지 않습니다",
  "quantity is below market step or dust threshold": "수량이 최소 거래 단위보다 작습니다",
  "insufficient paper position": "보유 수량이 부족합니다",
  "paper risk: max order notional exceeded": "리스크 한도 초과: 1회 주문 금액 한도를 초과했습니다",
  "notional is below minimum order notional": "주문 금액이 최소 주문 금액보다 작습니다",
  "paper risk: max realized loss exceeded": "리스크 한도 초과: 누적 실현 손실 한도를 초과했습니다",
  "paper risk: max position quantity exceeded": "리스크 한도 초과: 최대 보유 수량을 초과했습니다",
  "insufficient paper cash": "현금 잔고가 부족합니다",

  // apps/desktop/src/controlPlane.ts, reached via strategy start/stop/auto-trade/quantity
  "faulted control plane requires operator repair before restart": "시스템이 오류 상태입니다. 재시작하려면 점검이 필요합니다",
  "strategy must be running before auto trading": "자동매매를 사용하려면 먼저 전략을 시작해야 합니다",
  "order quantity must be positive": "주문 수량은 0보다 커야 합니다",
  "kill switch did not reach a safe stopped state": "중지 처리 중 안전한 정지 상태에 도달하지 못했습니다",

  // apps/desktop/src/runtimeCommandService.ts's PERSISTENCE_REPAIR_MESSAGE constant
  "Paper trading is unavailable. Stop the application, preserve the failed database, restore a verified backup, then restart and review state before manually resuming.":
    "Paper 거래를 사용할 수 없습니다. 애플리케이션을 중지하고 손상된 데이터베이스를 보존한 뒤, 검증된 백업으로 복원하고 재시작하여 상태를 검토한 후 수동으로 재개하세요.",

  // apps/server/src/liveCandleFeed.ts -- surfaced via /api/market's lastError field when a
  // poll of Upbit's public candle API fails, shown in the always-visible header status pill
  "upbit candle response is empty": "Upbit 캔들 응답이 비어 있습니다",
  "Upbit returned no candles": "Upbit에서 캔들 데이터를 받지 못했습니다"
});

const PATTERN_TRANSLATORS: readonly { readonly pattern: RegExp; readonly translate: (match: RegExpMatchArray) => string }[] = [
  { pattern: /^(\w+) must be a finite number$/, translate: (m) => `${fieldKo(m[1]!)}은(는) 유효한 숫자여야 합니다` },
  { pattern: /^(\w+) must be a finite number or null$/, translate: (m) => `${fieldKo(m[1]!)}은(는) 숫자이거나 비어 있어야 합니다` },
  { pattern: /^(\w+) must be a boolean$/, translate: (m) => `${fieldKo(m[1]!)}은(는) true/false 값이어야 합니다` },
  { pattern: /^(\w+) must be a string or null$/, translate: (m) => `${fieldKo(m[1]!)}은(는) 문자열이거나 비어 있어야 합니다` },
  { pattern: /^choice must be one of: (.+)$/, translate: (m) => `전략 선택 값은 다음 중 하나여야 합니다: ${m[1]}` },
  { pattern: /^unknown strategy: (.+)$/, translate: (m) => `알 수 없는 전략입니다: ${m[1]}` },
  { pattern: /^no pending limit order with id (.+)$/, translate: (m) => `ID가 ${m[1]}인 대기 중인 지정가 주문이 없습니다` },
  { pattern: /^unknown challenger id: (.+)$/, translate: (m) => `알 수 없는 챌린저 ID입니다: ${m[1]}` },
  // packages/core/src/pnl/pnl.ts's PnLFailureCode, reached via GET /api/reference-accounting
  // (paperRuntime.ts's getReferenceAccounting()) -- an internal invariant, not user input, so
  // this stays a generic "다시 시도" message rather than a per-code explanation.
  { pattern: /^reference PnL calculation failed: (.+)$/, translate: () => "참조 회계 계산에 실패했습니다. 잠시 후 다시 시도해 주세요." },
  { pattern: /^Upbit request failed: HTTP (\d+)$/, translate: (m) => `Upbit 요청 실패: HTTP ${m[1]}` },
  { pattern: /^upbit candle (\d+) is missing market$/, translate: (m) => `업비트 캔들 ${m[1]}번에 market 필드가 없습니다` },
  { pattern: /^upbit candle (\d+) has an invalid candle_date_time_utc$/, translate: (m) => `업비트 캔들 ${m[1]}번의 시각(candle_date_time_utc) 값이 올바르지 않습니다` },
  { pattern: /^upbit candle (\d+) candle_acc_trade_volume must be finite and non-negative$/, translate: (m) => `업비트 캔들 ${m[1]}번의 거래량(candle_acc_trade_volume) 값이 올바르지 않습니다` },
  { pattern: /^upbit candle (\d+) (\w+) must be positive and finite$/, translate: (m) => `업비트 캔들 ${m[1]}번의 ${m[2]} 값이 올바르지 않습니다` }
];

export function translateErrorMessage(message: string): string {
  const exact = EXACT_MESSAGES[message];
  if (exact !== undefined) return exact;
  for (const { pattern, translate } of PATTERN_TRANSLATORS) {
    const match = message.match(pattern);
    if (match) return translate(match);
  }
  // Unrecognized message (e.g. a future error text this dictionary hasn't caught up to yet) --
  // still Korean-prefixed rather than pure English, but keeps the original text visible for
  // debugging instead of silently discarding it.
  return `오류: ${message}`;
}
