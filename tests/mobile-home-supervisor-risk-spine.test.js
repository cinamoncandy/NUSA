const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical HOME keeps the content-first command center hierarchy instead of restoring the legacy truth rail", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const risk = home.indexOf('testID="home-risk-status"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const performance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0 && risk >= 0 && terrain >= 0 && performance >= 0 && learning >= 0);
  assert.ok(terrain < performance && performance < learning && learning < ai && ai < risk);
  assert.doesNotMatch(home, /<TruthCell label="(?:NOW|WHY|RESULT|RISK|LEARNING)"/);
});

test("canonical decision risk remains fail-closed and derives only from PAPER runtime/safety evidence", () => {
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");
  assert.match(decisionSurface, /const risk = input\.disconnected/);
  assert.match(decisionSurface, /"진행 불가 · 모의투자 연결 필요"/);
  assert.match(decisionSurface, /"진행 불가 · 연결 복구 필요"/);
  assert.match(decisionSurface, /runtimeActionRequired/);
  assert.match(decisionSurface, /runtimeWatch/);
  assert.match(decisionSurface, /input\.accountSource !== "CLOUD"\s*\n\s*\? "확인할 데이터 부족 · 모의투자 실행 기록 없음"/);
  assert.match(decisionSurface, /signalReady\s*\n\s*\? "모의투자 전용 · 안전 확인 완료 · 실거래 권한 없음"/);
  assert.match(decisionSurface, /"주의 · 모의투자 안전 확인 필요"/);
  assert.doesNotMatch(decisionSurface, /(?:LIVE READY|LIVE ACTIVE|LIVE ENABLED|LIVE AUTHORIZED)/);
});

test("canonical HOME preserves zero-authority safety and one PAPER learning route", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /모의투자 전용 · 실거래 권한 없음 · AI 실행 권한 없음/);
  assert.match(home, /testID="home-supervisor-learning"/);
  assert.equal((home.match(/testID="home-paper-learning"/g) ?? []).length, 1);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});
