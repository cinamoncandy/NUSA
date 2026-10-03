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
const { buildHomeVitals, VITAL_LABELS, VITAL_TEST_IDS } = load("../apps/mobile/src/homeVitalsModel.ts");
const { HOME_DETAIL_LABELS } = load("../apps/mobile/src/homeDetailCopy.ts");
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");

test("the four key tiles come in a fixed order with their labels", () => {
  const vitals = buildHomeVitals({ coin: { value: "XRP", tone: "ok" }, buy: { value: "없음 (09:00 이후)", tone: "ok" }, feed: { value: "끊김 0회", tone: "ok" }, learning: { value: "KRW-XRP 1/11일치 (9%)", detail: "마지막 수집 5분 전", tone: "ok" } });
  assert.deepEqual(vitals.map((v) => v.id), ["coin", "buy", "feed", "learning"]);
  assert.deepEqual(vitals.map((v) => v.label), ["거래 코인", "BUY 신호", "시세 연결", "학습 데이터"]);
  assert.equal(vitals[3].detail, "마지막 수집 5분 전");
  assert.equal(vitals[0].detail, null);
  assert.ok(Object.isFrozen(vitals));
});

test("a missing line reads as not reported and never as healthy", () => {
  const vitals = buildHomeVitals({});
  for (const v of vitals) assert.deepEqual([v.value, v.tone, v.detail], ["집계 미수신", "muted", null]);
  const bad = buildHomeVitals({ coin: { value: "", tone: "ok" }, buy: { value: 7, tone: "ok" }, feed: null, learning: undefined });
  for (const v of bad) assert.equal(v.tone, "muted");
});

test("an unknown tone is muted, and a not-reported value cannot be shown as ok", () => {
  const v = buildHomeVitals({ coin: { value: "XRP", tone: "great" }, buy: { value: "집계 미수신", tone: "ok" }, feed: { value: "끊김 3회", tone: "warn" } });
  assert.equal(v[0].tone, "muted");
  assert.equal(v[1].tone, "muted");
  assert.equal(v[2].tone, "warn");
});

test("the tiles keep the earlier row test ids and the detail rows speak Korean", () => {
  assert.deepEqual({ ...VITAL_TEST_IDS }, { coin: "home-traded-coin-line", buy: "home-buy-signal-line", feed: "home-feed-line", learning: "home-research-progress-line" });
  assert.deepEqual({ ...HOME_DETAIL_LABELS }, { risk: "위험", result: "결과", source: "출처", learning: "학습", aiTrust: "AI 신뢰", authority: "권한" });
  for (const text of Object.values(VITAL_LABELS)) assert.match(text, /[가-힣]/);
});

test("HOME shows the tiles up front, hidden only while setup is needed, and no longer repeats them in the details", () => {
  assert.match(view, /disconnected \? null : <View style=\{styles\.vitals\} testID="home-vitals">/);
  assert.ok(view.indexOf('testID="home-vitals"') < view.indexOf("DECISION BASIS"), "the tiles sit above the collapsed details");
  const details = view.slice(view.indexOf("DECISION BASIS"));
  for (const id of ["home-feed-line", "home-buy-signal-line", "home-research-progress-line", "home-traded-coin-line"]) assert.doesNotMatch(details, new RegExp(`testID="${id}"`));
  assert.match(view, /detailLabel: \{[^}]*fontSize: 12/, "detail labels are readable");
  assert.match(view, /detailValue: \{[^}]*fontSize: 14/, "detail values are readable");
});
