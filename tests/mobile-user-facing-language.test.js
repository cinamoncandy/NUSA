const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("primary navigation keeps internal ids but shows easy Korean labels", () => {
  const contract = read("apps/mobile/src/navigationContract.ts");
  assert.match(contract, /PRIMARY_DESTINATIONS = \["Home", "Paper", "Live", "More"\]/);
  for (const pair of [['Home: "홈"'], ['Paper: "모의투자"'], ['Live: "실거래 준비"'], ['More: "더보기"']]) assert.ok(contract.includes(pair[0]));
});

test("PAPER wording and false-green mapping are user friendly", () => {
  const view = read("apps/mobile/src/paperLearningMonitorView.tsx");
  assert.match(view, /title="모의투자 학습 상태"/);
  assert.match(view, />데이터 출처</);
  assert.match(view, /title="기기 내 대체 데이터"/);
  assert.match(view, /label="확정 손익"/);
  assert.match(view, /label="평가 손익"/);
  assert.match(view, /state\.serverSource === "NOT_CONFIGURED" \? "연결 안 됨"/);
  assert.match(view, /state\.status === "RUNNING" \? "모의투자 실행 중"/);
  assert.match(view, /state\.dataSource === "LOCAL_FALLBACK" \? "기기 내 데이터"/);
});

test("More destinations are easy Korean terms", () => {
  const more = read("apps/mobile/src/moreMenuView.tsx");
  for (const label of ["전략", "자산 구성", "위험관리", "성과", "모의투자 실행 기록", "주문 기록", "상태", "알림", "설정", "도움말"]) assert.ok(more.includes(`"${label}"`), label);
});

test("local public input no longer defines backend PAPER runtime state", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /const paperLearningRuntimeStatus = snapshot\?\.paperLearning\?\.runtimeStatus \?\? "PAUSED"/);
  assert.doesNotMatch(app, /getLocalPaperLearningReadiness\(/);
});
