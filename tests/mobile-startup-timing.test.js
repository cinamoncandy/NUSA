const test = require("node:test");
const assert = require("node:assert/strict");
const { markStartup, startupTimingSummary, resetStartupTimingForTest } = require("../dist/apps/mobile/src/startupTiming.js");

test("nothing is reported before the app has started, and partial progress says it is still measuring", () => {
  resetStartupTimingForTest();
  assert.equal(startupTimingSummary(), "측정 전");
  markStartup("appStart", 1000);
  assert.equal(startupTimingSummary(), "측정 중");
  markStartup("endpointReady", 1200);
  assert.equal(startupTimingSummary(), "설정 0.2초 · 측정 중");
  markStartup("sessionVerified", 3100);
  assert.equal(startupTimingSummary(), "설정 0.2초 · 인증 1.9초 · 측정 중");
});

test("a finished cold start reports each step and the total", () => {
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 240); markStartup("sessionVerified", 2140); markStartup("firstData", 3040);
  assert.equal(startupTimingSummary(), "설정 0.2초 · 인증 1.9초 · 첫 데이터 0.9초 (합 3.0초)");
});

test("only the first occurrence of a step counts, so a later foreground resume cannot rewrite the cold start", () => {
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 100); markStartup("sessionVerified", 900); markStartup("firstData", 1500);
  markStartup("sessionVerified", 90_000); markStartup("firstData", 95_000); markStartup("appStart", 80_000);
  assert.equal(startupTimingSummary(), "설정 0.1초 · 인증 0.8초 · 첫 데이터 0.6초 (합 1.5초)");
});

test("data that arrives before the session is proven is labelled, not misattributed", () => {
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 200); markStartup("firstData", 700);
  assert.equal(startupTimingSummary(), "설정 0.2초 · 첫 데이터 0.5초(인증 전) (합 0.7초)");
});

test("the timing is wired into the session owner, the app shell and the advanced settings card, and stays dependency-free", () => {
  const fs = require("node:fs");
  const read = (f) => fs.readFileSync(`apps/mobile/${f}`, "utf8");
  assert.match(read("src/paperConnectionSession.ts"), /markStartup\("sessionVerified"\)/);
  assert.match(read("src/paperConnectionSession.ts"), /markStartup\("endpointReady"\)/);
  assert.match(read("App.tsx"), /markStartup\("appStart"\)/);
  assert.match(read("App.tsx"), /markStartup\("firstData"\)/);
  assert.match(read("src/settingsView.tsx"), /label="시작 지연" value=\{startupTimingSummary\(\)\}/);
  assert.ok(!/^import /m.test(read("src/startupTiming.ts")), "no imports, so single-file transpile tests keep working");
});
