const test = require("node:test");
const assert = require("node:assert/strict");
const { translateEventType, translateLogMessage } = require("../dist/apps/server/src/logMessages.js");

test("translateEventType covers the fixed ControlEventType set", () => {
  assert.equal(translateEventType("SIGNAL"), "신호");
  assert.equal(translateEventType("STATUS"), "상태");
  assert.equal(translateEventType("SYSTEM"), "시스템");
  assert.equal(translateEventType("ORDER"), "주문");
  assert.equal(translateEventType("RISK"), "리스크");
  assert.equal(translateEventType("SOMETHING_NEW"), "SOMETHING_NEW", "unrecognized type passes through unchanged");
});

test("exact-match log messages translate", () => {
  assert.equal(translateLogMessage("strategy started"), "전략이 시작됨");
  assert.equal(translateLogMessage("strategy stopped"), "전략이 중지됨");
  assert.equal(translateLogMessage("execution report (manual)"), "체결 보고서 (수동)");
  assert.equal(translateLogMessage("insufficient paper position"), "보유 수량이 부족함");
});

test("signal messages (StrategyEngine's TYPE: reason) translate both parts", () => {
  assert.equal(translateLogMessage("HOLD: warming-up"), "보류: 워밍업 중");
  assert.equal(translateLogMessage("BUY: short-SMA crossed above long-SMA"), "매수: 단기 SMA가 장기 SMA를 상향 돌파");
  assert.equal(translateLogMessage("SELL: short-EMA crossed below long-EMA"), "매도: 단기 EMA가 장기 EMA를 하향 돌파");
  assert.equal(translateLogMessage("HOLD: strategy-stopped"), "보류: 전략 중지됨");
});

test("manual/automatic fill messages translate the side", () => {
  assert.equal(translateLogMessage("manual BUY filled"), "수동 매수 체결됨");
  assert.equal(translateLogMessage("automatic SELL filled"), "자동 매도 체결됨");
});

test("position protection trigger/set messages translate with embedded values preserved", () => {
  assert.equal(
    translateLogMessage("stop-loss triggered at 90000000: closed 0.001 KRW-BTC"),
    "스탑로스 발동 (가격 90000000): 0.001 KRW-BTC 청산"
  );
  assert.equal(
    translateLogMessage("trailing-stop trigger failed, protection disabled: insufficient paper position"),
    "트레일링 스탑 발동 실패, 보호 설정 해제됨: insufficient paper position"
  );
  assert.equal(
    translateLogMessage("position protection set: stopLoss=90000000 takeProfit=- trailingStopPercent=-"),
    "포지션 보호 설정: 스탑로스=90000000 익절=- 트레일링 스탑 비율=-"
  );
});

test("limit order lifecycle messages translate", () => {
  assert.equal(translateLogMessage("limit order placed: BUY 0.001 @ 90000000"), "지정가 주문 등록: 매수 0.001 @ 90000000");
  assert.equal(translateLogMessage("limit order cancelled: SELL 0.001 @ 100000000"), "지정가 주문 취소됨: 매도 0.001 @ 100000000");
  assert.equal(
    translateLogMessage("limit order triggered at 91000000: BUY 0.001 (limit 91500000)"),
    "지정가 주문 체결 (가격 91000000): 매수 0.001 (지정가 91500000)"
  );
  assert.equal(translateLogMessage("limit order failed, cancelled: insufficient paper cash"), "지정가 주문 실패로 취소됨: insufficient paper cash");
});

test("value-based audit-only RiskEngine/OrderPlanner CODE: reason messages translate the code", () => {
  assert.equal(
    translateLogMessage("INSUFFICIENT_BALANCE: orderValue (100) exceeds availableQuoteBalance (50)"),
    "잔고 부족: orderValue (100) exceeds availableQuoteBalance (50)"
  );
  assert.equal(
    translateLogMessage("RISK_BLOCKED: risk decision was not ALLOW: INSUFFICIENT_BALANCE -- orderValue (100) exceeds availableQuoteBalance (50)"),
    "리스크 검사에서 차단됨: risk decision was not ALLOW: INSUFFICIENT_BALANCE -- orderValue (100) exceeds availableQuoteBalance (50)"
  );
});

test("an unrecognized log message passes through unchanged (not misrepresented as an error)", () => {
  assert.equal(translateLogMessage("some brand new status message"), "some brand new status message");
});

test("champion/challenger system messages translate", () => {
  assert.equal(translateLogMessage("champion promoted: EMA(5,20)"), "챔피언 승격: EMA(5,20)");
  assert.equal(translateLogMessage("champion system reset"), "챔피언 시스템 초기화됨");
});
