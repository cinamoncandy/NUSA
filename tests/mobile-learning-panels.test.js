"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../dist/apps/mobile/src/learningPanelsModel.js");
const loop = require("../dist/apps/mobile/src/learningLoopModel.js");

// The numbers of the live server read on 2026-10-22 (oracle-host-diagnose /health), not invented values.
const live = { experiments: 15, configurations: 192, discoveryPasses: 15, holdoutPasses: 0, overfitRatePercent: 100, paperPeriodsConsumed: 68, paperNetBp: -17, paperExcessBp: 2, shadowTrades: 580, shadowWins: 115, shadowGrossGainBp: 3900, shadowGrossLossBp: 5684, shadowFeeBp: 5799 };

test("the study timeline is sorted, marks the next verdict and counts days", () => {
  const rows = m.buildStudyTimeline(Date.parse("2026-10-22T12:00:00Z"));
  assert.deepEqual(rows.map((r) => r.id), ["호가", "S2~S4", "S5"]);
  assert.deepEqual(rows.map((r) => r.next), [true, false, false]);
  assert.equal(rows[0].dateLabel, "10-29");
  assert.match(rows[0].status, /결과 대기 · 7일 남음/);
  assert.match(rows[1].status, /설계 고정됨/);
});

test("a verdict time in the past asks for the result instead of claiming progress", () => {
  const rows = m.buildStudyTimeline(Date.parse("2026-11-01T00:00:00Z"));
  assert.match(rows[0].status, /판정 시점이 지났어요/);
  assert.equal(rows[0].tone, "ATTENTION");
  assert.equal(rows[1].next, true);
});

test("the cost waterfall is computed from the measured shadow totals per trade", () => {
  const { cost } = loop.buildLearningLoopPanels(live);
  assert.equal(cost.trades, 580);
  assert.deepEqual(cost.rows.map((r) => r.kind), ["GAIN", "LOSS", "COST", "RESULT"]);
  const [gain, loss, fee, result] = cost.rows.map((r) => r.bp);
  assert.ok(Math.abs(gain - 3900 / 580) < 1e-9 && Math.abs(loss + 5684 / 580) < 1e-9 && Math.abs(fee + 5799 / 580) < 1e-9);
  assert.ok(Math.abs(result - (3900 - 5684 - 5799) / 580) < 1e-9);
  assert.ok(result < 0 && cost.scaleBp >= Math.abs(result));
  assert.equal(Math.round(cost.winRatePercent), 20);
  assert.match(cost.summary, /수수료를 빼기 전에도 거래당 -3\.1bp/);
});

test("paper result and the holdout gate use the measured values and say plainly when nothing passed", () => {
  const { paper, overfit } = loop.buildLearningLoopPanels(live);
  assert.equal(paper.netBp, -17);
  assert.equal(paper.excessBp, 2);
  assert.equal(paper.periods, 68);
  assert.match(paper.summary, /68구간 동안 모의투자 순결과 -17bp, 전부 사기 대비 \+2bp/);
  assert.equal(overfit.holdoutPasses, 0);
  assert.match(overfit.summary, /15개가 모두 새 데이터에서 탈락/);
});

test("missing, malformed or inconsistent inputs produce no panel instead of a guessed number", () => {
  for (const raw of [null, undefined, 5, "x", [], {}]) assert.deepEqual(loop.buildLearningLoopPanels(raw), { cost: null, paper: null, overfit: null });
  assert.equal(loop.buildLearningLoopPanels({ ...live, shadowTrades: 0 }).cost, null);
  assert.equal(loop.buildLearningLoopPanels({ ...live, shadowWins: 581 }).cost, null);
  assert.equal(loop.buildLearningLoopPanels({ ...live, shadowFeeBp: -5 }).cost, null);
  assert.equal(loop.buildLearningLoopPanels({ ...live, shadowGrossGainBp: 1.5 }).cost, null);
  assert.equal(loop.buildLearningLoopPanels({ ...live, holdoutPasses: 16 }).overfit, null);
  assert.equal(loop.buildLearningLoopPanels({ ...live, discoveryPasses: 200 }).overfit, null);
  assert.equal(loop.buildLearningLoopPanels({ ...live, paperNetBp: NaN, paperExcessBp: undefined }).paper, null);
  assert.equal(loop.buildLearningLoopPanels({ paperNetBp: -17 }).paper.excessBp, null);
});

test("the learning panels contain no example values and no heavy weights, and the app passes the real heartbeat", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/learningPanels.tsx"), "utf8");
  assert.doesNotMatch(src, /예시/);
  assert.doesNotMatch(src, /fontWeight: "(700|800|900)"/);
  assert.doesNotMatch(src, /#[0-9A-Fa-f]{6}/);
  const view = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/learningView.tsx"), "utf8");
  assert.match(view, /<CostWaterfall raw=\{learningLoop\} \/>/);
  assert.doesNotMatch(view, /DecisionBars|CostWall\b/);
  const app = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/App.tsx"), "utf8");
  assert.equal((app.match(/learningLoop=\{snapshot\?\.operations\.heartbeat\?\.learningLoop \?\? null\}/g) || []).length, 2);
});
