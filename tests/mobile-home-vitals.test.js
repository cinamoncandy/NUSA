const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const load = (rel) => {
  const shim = { exports: {} };
  new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
  return shim.exports;
};
const { buildHomeVitals, VITAL_LABELS, VITAL_TEST_IDS, UNVERIFIED_NOTE, FEED_STALE_NOTE } = load("../apps/mobile/src/homeVitalsModel.ts");
const { HOME_DETAIL_LABELS } = load("../apps/mobile/src/homeDetailCopy.ts");
const { monitorLabel, MONITOR_LABEL_KEYS } = load("../apps/mobile/src/monitorCopy.ts");
const { readableFont, labelFont, readableLineHeight, MIN_BODY_FONT, MIN_LABEL_FONT } = load("../apps/mobile/src/designSystem.ts");

const ok = { coin: { value: "XRP", tone: "ok" }, buy: { value: "없음 (09:00 이후)", tone: "ok" }, feed: { value: "끊김 0회", tone: "ok" }, learning: { value: "KRW-XRP 1/11일치 (9%)", detail: "마지막 수집 5분 전", tone: "ok" } };

test("the four key tiles come in a fixed order with their labels", () => {
  const vitals = buildHomeVitals(ok);
  assert.deepEqual(vitals.map((v) => v.id), ["coin", "buy", "feed", "learning"]);
  assert.deepEqual(vitals.map((v) => v.label), ["거래 코인", "BUY 신호", "시세 연결", "학습 데이터"]);
  assert.equal(vitals[3].detail, "마지막 수집 5분 전");
  assert.equal(vitals[0].detail, null);
  assert.ok(vitals.every((v) => v.tone === "ok"));
  assert.ok(Object.isFrozen(vitals));
});

test("a missing line reads as not reported and never as healthy", () => {
  for (const v of buildHomeVitals({})) assert.deepEqual([v.value, v.tone, v.detail], ["집계 미수신", "muted", null]);
  for (const v of buildHomeVitals({ coin: { value: "", tone: "ok" }, buy: { value: 7, tone: "ok" }, feed: null, learning: undefined })) assert.equal(v.tone, "muted");
});

test("an unknown tone is muted, and a not-reported value cannot be shown as ok", () => {
  const v = buildHomeVitals({ coin: { value: "XRP", tone: "great" }, buy: { value: "집계 미수신", tone: "ok" }, feed: { value: "끊김 3회", tone: "warn" } });
  assert.deepEqual([v[0].tone, v[1].tone, v[2].tone], ["muted", "muted", "warn"]);
});

test("a feed the app currently sees as stale is never shown healthy, even if the server's history is clean", () => {
  const v = buildHomeVitals({ ...ok, feedStale: true });
  assert.equal(v[2].tone, "warn");
  assert.match(v[2].detail, new RegExp(FEED_STALE_NOTE));
  assert.equal(v[0].tone, "ok", "only the feed tile is affected");
  const withDetail = buildHomeVitals({ ...ok, feed: { value: "끊김 0회", detail: "긴 공백 0", tone: "ok" }, feedStale: true });
  assert.match(withDetail[2].detail, /지금 시세가 오래됨 · 긴 공백 0/);
});

test("while the session is recovering or the snapshot is cached, no tile reads as healthy and the note says why", () => {
  const v = buildHomeVitals({ ...ok, unverified: true });
  assert.ok(v.every((x) => x.tone === "muted"), "nothing is green while unverified");
  assert.ok(v.every((x) => x.detail != null && x.detail.includes(UNVERIFIED_NOTE)));
  assert.match(v[3].detail, /마지막 수집 5분 전/, "the original detail is kept after the note");
  const warn = buildHomeVitals({ ...ok, feed: { value: "끊김 4회", tone: "warn" }, unverified: true });
  assert.equal(warn[2].tone, "muted", "an old warning is also shown as last known, not as current");
});

test("a warning clause is first in the learning detail so it cannot be the one cut off", () => {
  const { buildResearchProgressLine } = load("../apps/mobile/src/researchProgressModel.ts");
  const now = Date.UTC(2026, 9, 3, 9, 0, 0);
  const line = buildResearchProgressLine({ market: "KRW-XRP", candleCount: 900, requiredCandles: 15840, firstCloseMs: now - 1000 * 60_000, lastCloseMs: now - 3 * 3_600_000, observedAt: now }, now);
  assert.equal(line.tone, "warn");
  assert.ok(line.detail.startsWith("수집이 멈췄을 수 있음"));
});

test("the tiles keep the earlier row test ids and the labels speak Korean", () => {
  assert.deepEqual({ ...VITAL_TEST_IDS }, { coin: "home-traded-coin-line", buy: "home-buy-signal-line", feed: "home-feed-line", learning: "home-research-progress-line" });
  assert.deepEqual({ ...HOME_DETAIL_LABELS }, { risk: "위험", result: "결과", source: "출처", learning: "학습", aiTrust: "AI 신뢰", authority: "권한" });
  for (const text of Object.values(VITAL_LABELS)) assert.match(text, /[가-힣]/);
});

test("the shared readability floor never lets text go below 12 px (body) or 11 px (tracked labels)", () => {
  assert.deepEqual([MIN_BODY_FONT, MIN_LABEL_FONT], [12, 11]);
  for (const n of [8, 9, 10, 11, 11.5]) assert.equal(readableFont(n), 12);
  for (const n of [8, 9, 10]) assert.equal(labelFont(n), 11);
  assert.equal(readableFont(14), 14);
  assert.equal(labelFont(13), 13);
  assert.equal(readableLineHeight(12, 13), 17);
  assert.equal(readableLineHeight(12, 20), 20);
});

test("monitor labels are Korean, keep an unknown term as given, and never touch the safety values", () => {
  assert.equal(monitorLabel("ORDER"), "주문");
  assert.equal(monitorLabel("NO EVENTS"), "이벤트 없음");
  assert.equal(monitorLabel("SOMETHING FROM THE SERVER"), "SOMETHING FROM THE SERVER");
  for (const key of MONITOR_LABEL_KEYS) assert.match(monitorLabel(key), /[가-힣]/, key);
  for (const safety of ["PAPER ONLY", "LIVE NONE", "ZERO AUTHORITY", "NONE"]) assert.equal(monitorLabel(safety), safety);
});
