"use strict";
// UI/UX v6 phase 3 (docs/NUSA_MOBILE_UIUX_V6_CALM_FIELD.md): the host serves the study schedule, the app only draws it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const contracts = require("../dist/packages/contracts/src/personalPaperOperations.js");
const { RESEARCH_STUDY_SCHEDULE } = require("../dist/apps/cloud/src/researchStudySchedule.js");
const { ORDERBOOK_STUDY_IDS } = require("../dist/apps/cloud/src/researchStudyResult.js");
const m = require("../dist/apps/mobile/src/learningPanelsModel.js");

const row = (over = {}) => ({ id: "교차시장", name: "교차시장 상대 모멘텀", verdictAtMs: Date.UTC(2026, 11, 10), frozen: true, ...over });

test("the host schedule is itself valid, unique, in the registered window and maps results only to registered order-book ids", () => {
  assert.equal(contracts.isValidStudySchedule(RESEARCH_STUDY_SCHEDULE), true);
  assert.equal(new Set(RESEARCH_STUDY_SCHEDULE.map((s) => s.id)).size, RESEARCH_STUDY_SCHEDULE.length);
  for (const s of RESEARCH_STUDY_SCHEDULE) if (s.resultStudyId !== undefined) assert.ok(ORDERBOOK_STUDY_IDS.includes(s.resultStudyId), s.id);
  const dates = Object.fromEntries(RESEARCH_STUDY_SCHEDULE.map((s) => [s.id, new Date(s.verdictAtMs).toISOString()]));
  assert.equal(dates["호가3"], "2026-12-10T02:00:00.000Z", "docs/RESEARCH_PREREG_2026-11-25_ORDERBOOK_60M_THIRD.md");
  assert.equal(dates["체결흐름2"], "2026-11-29T00:16:00.000Z", "docs: the first daily research run after 2026-11-28T06:30Z");
  assert.equal(dates["RET48"], "2028-03-31T00:00:00.000Z");
  assert.ok(RESEARCH_STUDY_SCHEDULE.length >= 7, "more studies than the four rows the app used to hard-code");
});

test("the contract accepts a good schedule and rejects the whole value for any bad row", () => {
  assert.equal(contracts.isValidStudySchedule([row()]), true);
  assert.equal(contracts.isValidStudySchedule([row({ id: "호가3", name: "호가 연구 3차(ML)", resultStudyId: "ML_ORDERBOOK_60M_20261126" })]), true);
  const bad = [[], null, "x", Array.from({ length: 17 }, (_, i) => row({ id: `s${i}` })), [row(), row()], [row({ extra: 1 })], [row({ id: "" })], [row({ id: "a b" })], [row({ name: "" })], [row({ name: "x".repeat(41) })], [row({ name: "a<b" })], [row({ name: "a\u0000b" })],
    [row({ verdictAtMs: 1.5 })], [row({ verdictAtMs: 0 })], [row({ verdictAtMs: Date.UTC(2040, 0, 1) })], [row({ verdictAtMs: "2026-12-10" })], [row({ frozen: "yes" })], [row({ resultStudyId: "orderbook" })], [row({ resultStudyId: 5 })], [row({ resultStudyId: "ML_ORDERBOOK_60M_20261029" })], [row({ id: "호가2", resultStudyId: "ML_ORDERBOOK_60M_20261029" })], [row({ id: "__proto__", resultStudyId: "ML_ORDERBOOK_60M_20261029" })], [row({ id: "constructor" , resultStudyId: "ML_X" })], [null], [[1]]];
  for (const b of bad) assert.equal(contracts.isValidStudySchedule(b), false, JSON.stringify(b)?.slice(0, 60));
});

test("the contract and the app validate identically (the two copies cannot drift): fixed cases plus a deterministic fuzz", () => {
  const cases = [[row()], [row({ id: "호가", name: "호가 연구(ML)", resultStudyId: "ML_ORDERBOOK_60M_20261029" })], [row({ id: "호가", resultStudyId: "ML_ORDERBOOK_60M_20261111" })], [row({ id: "toString" })], [row({ id: "__proto__" })], RESEARCH_STUDY_SCHEDULE, [], null, "x", [row({ name: "a\u007fb" })], [row({ verdictAtMs: Date.UTC(2031, 0, 1) })], [row({ verdictAtMs: Date.UTC(2031, 0, 1) + 1 })]];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ids = ["호가", "호가2", "호가3", "S2~S4", "a", "x y", "", "constructor", "__proto__"];
  const results = [undefined, "ML_ORDERBOOK_60M_20261029", "ML_ORDERBOOK_60M_20261111", "ML_ORDERBOOK_60M_20261126", "bad", 7];
  for (let i = 0; i < 4000; i += 1) {
    const n = Math.floor(rnd() * 4);
    cases.push(Array.from({ length: n }, () => {
      const r = { id: ids[Math.floor(rnd() * ids.length)], name: rnd() < 0.9 ? "연구" : "x".repeat(41), verdictAtMs: rnd() < 0.9 ? Date.UTC(2026, 10, 25) + Math.floor(rnd() * 1e10) : 1.5, frozen: rnd() < 0.9 };
      const rs = results[Math.floor(rnd() * results.length)];
      if (rs !== undefined) r.resultStudyId = rs;
      if (rnd() < 0.05) r.extra = 1;
      return r;
    }));
  }
  for (const c of cases) assert.equal(m.parseStudySchedule(c) !== null, contracts.isValidStudySchedule(c), JSON.stringify(c)?.slice(0, 120));
});

test("the operations snapshot keeps a valid schedule and drops a malformed one on its own", () => {
  const heartbeat = (extra) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, ...extra });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (extra) => contracts.validatePersonalPaperOperationsSnapshot(contracts.buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(extra) }, paperLearning: null }, 1_000), 1_100, 500).operations.heartbeat;
  assert.equal(attempt({ studySchedule: [row()] }).studySchedule.length, 1);
  assert.equal(attempt({ studySchedule: [row({ extra: 1 })] }).studySchedule, undefined);
  assert.equal(attempt({ studySchedule: RESEARCH_STUDY_SCHEDULE }).studySchedule.length, RESEARCH_STUDY_SCHEDULE.length);
  assert.equal(attempt({}).studySchedule, undefined);
});

test("the cloud runtime puts the schedule in every heartbeat (a fixed list, no read, no authority)", () => {
  const runtime = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8").replace(/\r\n/g, "\n");
  assert.match(runtime, /import \{ RESEARCH_STUDY_SCHEDULE \} from "\.\/researchStudySchedule";/);
  assert.match(runtime, /\.\.\.orderBookStudyHeartbeat\(\), \.\.\.studyScheduleHeartbeat\(\) \}\)/);
  const src = fs.readFileSync("apps/cloud/src/researchStudySchedule.ts", "utf8");
  assert.doesNotMatch(src, /require\(|readFileSync|fetch\(|process\.env|\bfs\b/, "a fixed list: it reads nothing");
});

test("the app draws the served schedule, shows only its own result id, and falls back to the built-in list when the value is absent or bad", () => {
  const parsed = m.parseStudySchedule(RESEARCH_STUDY_SCHEDULE);
  assert.equal(parsed.length, RESEARCH_STUDY_SCHEDULE.length);
  for (const bad of [null, undefined, [], "x", [row({ extra: 1 })], [row(), row()], [row({ verdictAtMs: 1.5 })], [{ id: "a" }]]) assert.equal(m.parseStudySchedule(bad), null);
  const now = Date.parse("2026-11-25T04:00:00Z");
  const served = m.buildStudyTimeline(now, parsed);
  assert.deepEqual(served.map((r) => r.id), ["호가", "호가2", "체결흐름2", "S2~S4", "교차시장", "호가3", "S5", "RET48"]);
  assert.equal(served.find((r) => r.id === "체결흐름2").dateLabel, "11-29");
  assert.match(served.find((r) => r.id === "RET48").status, /^설계 고정됨 · \d+일 남음$/);
  // a served row's result is read only for its own resultStudyId, and a row cannot name another study's result
  assert.equal(m.parseStudySchedule([row({ id: "체결흐름2", resultStudyId: "ML_ORDERBOOK_60M_20261029" })]), null);
  const third = { schemaVersion: 1, studyId: "ML_ORDERBOOK_60M_20261126", status: "HOLDOUT_FAIL", eligible: 5, discoveryPass: false };
  const after = Date.parse("2026-12-10T09:00:00Z");
  assert.match(m.buildStudyTimeline(after, parsed, third).find((r) => r.id === "호가3").status, /^불합격/);
  assert.equal(m.buildStudyTimeline(after, parsed, third).find((r) => r.id === "호가2").status, "판정 시점이 지났는데 서버가 결과를 아직 안 보냈어요");
  // an absent or malformed schedule leaves the built-in list (no invented study)
  assert.deepEqual(m.buildStudyTimeline(now, m.parseStudySchedule([row({ extra: 1 })]) ?? undefined).map((r) => r.id), m.buildStudyTimeline(now).map((r) => r.id));
});

test("App and the learning view pass the served schedule from the heartbeat to the timeline", () => {
  const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  assert.equal((read("apps/mobile/App.tsx").match(/studySchedule=\{snapshot\?\.operations\.heartbeat\?\.studySchedule \?\? null\}/g) || []).length, 2, "both render sites");
  const view = read("apps/mobile/src/learningView.tsx");
  assert.match(view, /studySchedule, (collectOnly, )?\.\.\.monitorProps/, "not forwarded to the monitor");
  assert.match(view, /<StudyTimeline nowMs=\{Date\.now\(\)\} orderBookStudy=\{orderBookStudy\} studySchedule=\{studySchedule\} \/>/);
  assert.match(read("apps/mobile/src/learningPanels.tsx"), /parseStudySchedule\(studySchedule\) \?\? undefined/);
});
