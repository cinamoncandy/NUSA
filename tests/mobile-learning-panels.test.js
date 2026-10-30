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

test("a verdict time in the past without a server result says so instead of claiming progress", () => {
  const rows = m.buildStudyTimeline(Date.parse("2026-11-01T00:00:00Z"));
  assert.match(rows[0].status, /판정 시점이 지났는데 서버가 결과를 아직 안 보냈어요/);
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

// WO-UI-20261030-ORDERBOOK-STUDY-RESULT: the 호가 row follows the server's study result and never guesses.
const study = { schemaVersion: 1, studyId: "ML_ORDERBOOK_60M_20261029", status: "HOLDOUT_FAIL", eligible: 180, discoveryPass: true, resultFileMtimeMs: 1793000000000 };
const after = Date.parse("2026-10-30T09:00:00Z");
const row = (raw, now = after) => m.buildStudyTimeline(now, undefined, raw)[0];

test("a server FAIL reads as 불합격, keeps ATTENTION and shows the market count", () => {
  const r = row(study);
  assert.equal(r.status, "불합격 · 그대로 기록해요 · 대상 시장 180개");
  assert.equal(r.tone, "ATTENTION");
});

test("a server PASS is a paper-only candidate and never reads as live or authority", () => {
  const r = row({ ...study, status: "HOLDOUT_PASS" });
  assert.equal(r.status, "합격 · 앞으로 모의로만 검증할 후보예요 (실전 아님) · 대상 시장 180개");
  assert.match(r.status, /모의로만/);
  assert.match(r.status, /실전 아님/);
  assert.doesNotMatch(r.status, /실전 투자|실거래 가능|자동 매매|승인|라이브/);
});

test("no object, or a malformed one, after the verdict time says the server has not sent it and never claims pass/fail", () => {
  const waiting = "판정 시점이 지났는데 서버가 결과를 아직 안 보냈어요";
  const bads = [undefined, null, [], "HOLDOUT_PASS", { ...study, status: "WAITING_DATA" }, { ...study, studyId: "OTHER" }, { ...study, schemaVersion: 2 }, { ...study, eligible: -1 }, { ...study, eligible: 1.5 }, { ...study, eligible: "180" }, { ...study, discoveryPass: "yes" }, { ...study, extra: 1 }, { ...study, resultFileMtimeMs: "x" }];
  for (const bad of bads) {
    const r = row(bad);
    assert.equal(r.status, waiting, JSON.stringify(bad));
    assert.equal(r.tone, "ATTENTION");
  }
});

test("before the verdict time the row is unchanged even if an object is present", () => {
  const before = Date.parse("2026-10-22T12:00:00Z");
  assert.match(row(study, before).status, /결과 대기 · 7일 남음/);
  assert.match(row(undefined, before).status, /결과 대기 · 7일 남음/);
});

test("other studies are not touched by the result object", () => {
  const rows = m.buildStudyTimeline(Date.parse("2026-12-30T00:00:00Z"), undefined, study);
  assert.match(rows[1].status, /판정 시점이 지났어요 · 결과를 확인하세요/);
});

test("the result is wired from the heartbeat, with no raw colour in the model and CRLF-safe source reads", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  assert.match(read("apps/mobile/App.tsx"), /orderBookStudy=\{snapshot\?\.operations\.heartbeat\?\.orderBookStudy \?\? null\}/);
  assert.match(read("apps/mobile/src/learningView.tsx"), /<StudyTimeline nowMs=\{Date\.now\(\)\} orderBookStudy=\{orderBookStudy\} \/>/);
  assert.doesNotMatch(read("apps/mobile/src/learningPanelsModel.ts"), /#[0-9a-fA-F]{3,8}\b/);
});
