const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Home exposes one real next action from verified runtime state", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="home-next-action"/);
  assert.match(app, /testID="home-next-action-button"/);
  assert.match(app, /PAPER 상태 보기/);
  assert.match(app, /AI 분석 보기/);
  assert.match(app, /시장 보기/);
  assert.match(app, /setActiveTab\(nextAction\.tab\)/);
  assert.match(app, /snapshot\.health !== "HEALTHY" \|\| snapshot\.dashboard\.killSwitchActive/);
});

test("AI confidence is presented as an uncalibrated model score, not trusted probability", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  for (const source of [app, ai]) {
    assert.match(source, /모델 점수 \(미보정\)/);
    assert.match(source, /보정 상태/);
    assert.doesNotMatch(source, /<DataRow label="신뢰도"/);
  }
  assert.match(ai, /검증된 확률이나 성과 보장을 의미하지 않습니다/);
});

test("Portfolio does not imply hidden positions that the PAPER contract cannot expose", () => {
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const contract = read("packages/contracts/src/personalPaperOperations.ts");
  const accounting = read("apps/desktop/src/paperAccountingService.ts");
  assert.match(portfolio, />열린 포지션</);
  assert.doesNotMatch(portfolio, /대표 열린 포지션/);
  assert.match(contract, /readonly position: Readonly</);
  assert.doesNotMatch(contract, /readonly positions:/);
  assert.match(accounting, /state\.broker\.position\.market/);
});

test("Final polish preserves read-only and zero-authority product boundaries", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.doesNotMatch(app, /<TradingView[^>]*onSubmit=/s);
  assert.match(ai, /ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});
