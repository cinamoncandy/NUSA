const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = (f) => fs.readFileSync(path.join(path.resolve(__dirname, ".."), "apps/mobile/src", f), "utf8");

test("the PAPER tab is called Lab (the owner's decision after withdrawing the learning loop)", () => {
  assert.match(src("navigationContract.ts"), /Paper: "Lab",/);
  assert.match(src("learningView.tsx"), /index="02 \/ Lab"/);
  assert.match(src("learningView.tsx"), /‹ Lab 요약/);
});

test("the funnel hero and the tab hint use the new name too", () => {
  assert.match(src("learningFunnel.tsx"), /<Text style=\{styles\.index\}>02 \/ Lab<\/Text>/);
  assert.match(src("primaryNavigation.tsx"), /Paper: "PAPER 실행과 증거",/);
  assert.doesNotMatch(src("primaryNavigation.tsx"), /증거와 학습/);
});

test("the new headlines still fit the hero at 320 px", () => {
  const m = require("../dist/apps/mobile/src/learningScreenModel.js");
  for (const t of ["PAPER 연계가 멈춰 있어요", "PAPER 연계에 오류가 있어요", "PAPER 연계가 잠시 쉬고 있어요", "모의투자 연계가 돌고 있어요", "Lab 정보를 받지 못했어요"]) {
    assert.ok(m.heroFontSize(m.splitHeroLines(t), 320) >= 36, t);
  }
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

test("the Home card, the Home labels and the stage chip follow the Lab name; the 성과 headline explains its two windows", () => {
  assert.match(src("homeView.tsx"), />Lab<\/Text><Text style=\{\[styles\.commandArrow/);
  assert.match(src("homeView.tsx"), />Lab 기록<\/Text>/);
  assert.match(src("homeView.tsx"), /시세 · 흐름 · Lab 자세히 보기/);
  assert.match(src("homeVitalsModel.ts"), /learning: "Lab 데이터"/);
  assert.match(src("homeDetailCopy.ts"), /learning: "Lab",/);
  assert.match(src("stageTraceModel.ts"), /"LAB · PAPER 연계"/);
  const perf = src("performanceModel.ts");
  assert.match(perf, /손익은 계좌 누적 기준이고, 수수료·거래 대금·체결 수는 최근 기록 기준이에요\./);
  assert.match(perf, /performance\.realizedPnL !== 0 \|\| performance\.unrealizedPnL !== 0 \?/);
  assert.match(src("homeDecisionSurface.ts"), /검증된 근거만 Lab 화면으로 연결/);
});
