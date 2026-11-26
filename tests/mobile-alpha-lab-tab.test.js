const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = (f) => fs.readFileSync(path.join(path.resolve(__dirname, ".."), "apps/mobile/src", f), "utf8");

test("the PAPER tab is called 알파랩 (the owner's decision after withdrawing the learning loop)", () => {
  assert.match(src("navigationContract.ts"), /Paper: "알파랩",/);
  assert.match(src("learningView.tsx"), /index="02 \/ 알파랩"/);
  assert.match(src("learningView.tsx"), /‹ 알파랩 요약/);
});

test("the loop steps are labelled as the PAPER link, not as learning", () => {
  assert.match(src("learningView.tsx"), /<SectionLabel left="PAPER 연계 · 모의투자"/);
  const m = src("learningScreenModel.ts");
  assert.match(m, /"PAPER 연계가 멈춰 있어요"/);
  assert.match(m, /"PAPER 연계에 오류가 있어요"/);
  assert.match(m, /"PAPER 연계가 잠시 쉬고 있어요"/);
  assert.match(m, /"모의투자 연계가 돌고 있어요"/);
  assert.doesNotMatch(m, /배우는 중이에요"/);
});

test("the wording that states the truth stays: collect-only pause, missing data, no results claimed", () => {
  const m = src("learningScreenModel.ts");
  assert.match(m, /수집 전용이라 판단은 쉬어요/);
  assert.match(m, /빈 값은 결과가 없다는 뜻이 아니에요/);
  assert.match(m, /아직 평가 결론은 없어요/);
});
