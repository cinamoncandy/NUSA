const test = require("node:test");
const assert = require("node:assert/strict");
const { translateErrorMessage } = require("../dist/apps/server/src/errorMessages.js");

test("exact-match messages translate to their fixed Korean text", () => {
  assert.equal(translateErrorMessage("request body must be a JSON object"), "요청 본문은 JSON 객체여야 합니다");
  assert.equal(translateErrorMessage("side must be \"BUY\" or \"SELL\""), "구분(side)은 \"BUY\" 또는 \"SELL\"이어야 합니다");
  assert.equal(translateErrorMessage("no open position to close"), "청산할 보유 포지션이 없습니다");
  assert.equal(translateErrorMessage("insufficient paper cash"), "현금 잔고가 부족합니다");
  assert.equal(translateErrorMessage("market price is not available yet"), "아직 시세 정보를 사용할 수 없습니다");
});

test("parameterized messages substitute a Korean field label", () => {
  assert.equal(translateErrorMessage("quantity must be a finite number"), "수량은(는) 유효한 숫자여야 합니다");
  assert.equal(translateErrorMessage("riskFraction must be a finite number"), "리스크 비율은(는) 유효한 숫자여야 합니다");
  assert.equal(translateErrorMessage("stopLossPrice must be a finite number or null"), "스탑로스 가격은(는) 숫자이거나 비어 있어야 합니다");
  assert.equal(translateErrorMessage("enabled must be a boolean"), "사용 여부은(는) true/false 값이어야 합니다");
});

test("parameterized messages fall back to the raw field name if it isn't in the Korean label map", () => {
  assert.equal(translateErrorMessage("mysteryField must be a finite number"), "mysteryField은(는) 유효한 숫자여야 합니다");
});

test("id-carrying and choice-carrying messages keep the dynamic part verbatim", () => {
  assert.equal(translateErrorMessage("no pending limit order with id 123-1"), "ID가 123-1인 대기 중인 지정가 주문이 없습니다");
  assert.equal(translateErrorMessage("unknown strategy: macd-cross"), "알 수 없는 전략입니다: macd-cross");
  assert.equal(
    translateErrorMessage("choice must be one of: sma-crossover, ema-crossover"),
    "전략 선택 값은 다음 중 하나여야 합니다: sma-crossover, ema-crossover"
  );
});

test("an unrecognized message still gets a Korean prefix instead of pure English", () => {
  assert.equal(translateErrorMessage("some brand new error text"), "오류: some brand new error text");
});
