const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { warmConnection, registerConnectionWarmup, resetConnectionWarmupForTest } = require("../dist/apps/mobile/src/connectionWarmup.js");
const { markStartup, startupTimingSummary, resetStartupTimingForTest } = require("../dist/apps/mobile/src/startupTiming.js");

test("nothing is requested until the app registers its transport", () => {
  resetConnectionWarmupForTest();
  assert.equal(warmConnection("https://nusa.example"), false);
});

test("it sends one plain GET of the public /health, once per endpoint, with no credential and no redirect", async () => {
  resetConnectionWarmupForTest();
  const calls = [];
  registerConnectionWarmup(async (url, init) => { calls.push({ url, init }); return {}; });
  assert.equal(warmConnection("https://nusa.example/"), true);
  assert.equal(warmConnection("https://nusa.example"), false, "once per endpoint per process");
  assert.equal(warmConnection("https://other.example"), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://nusa.example/health");
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(Object.keys(init).filter((k) => !["method", "redirect", "cache", "signal"].includes(k)), [], "no header, body, cookie or credential option");
  }
});

test("only a plain https server address is touched", () => {
  resetConnectionWarmupForTest();
  let called = 0;
  registerConnectionWarmup(async () => { called += 1; return {}; });
  for (const bad of ["http://127.0.0.1:41731", "http://nusa.example", "https://", "https://nusa.example/path", "https://user:pw@nusa.example/x", "ftp://nusa.example", "nusa.example", "", "https://a b.example"]) assert.equal(warmConnection(bad), false, bad);
  assert.equal(called, 0);
});

test("a failing or throwing transport is silent and never blocks anything", async () => {
  resetConnectionWarmupForTest();
  registerConnectionWarmup(async () => { throw new Error("network down"); });
  assert.doesNotThrow(() => warmConnection("https://down.example"));
  resetConnectionWarmupForTest();
  registerConnectionWarmup(() => { throw new Error("sync failure"); });
  assert.equal(warmConnection("https://sync.example"), false);
  await new Promise((resolve) => setImmediate(resolve));
});

test("the app registers its fetch at start-up and the endpoint setter warms the connection without touching authentication", () => {
  const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
  const session = fs.readFileSync("apps/mobile/src/paperConnectionSession.ts", "utf8");
  assert.match(app, /registerConnectionWarmup\(\(url, init\) => fetch\(url, init as RequestInit\)\)/);
  assert.match(session, /markStartup\("endpointReady"\); warmConnection\(next\);/);
  const source = fs.readFileSync("apps/mobile/src/connectionWarmup.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /authorization|bearer|getSecret|setItem|cookie|headers/i, "no credential, header or storage handling in the code itself");
  assert.doesNotMatch(source, /^import /m, "dependency-free");
});

test("the sign-in wait is split into read, refresh, save and identity when every step was seen in order", () => {
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 100); markStartup("sessionRead", 300); markStartup("tokensRefreshed", 1400); markStartup("tokensSaved", 1700); markStartup("sessionVerified", 2500); markStartup("firstData", 3300);
  assert.equal(startupTimingSummary(), "설정 0.1초 · 인증 2.4초 (읽기 0.2 · 새로고침 1.1 · 저장 0.3 · 신원 0.8) · 첫 데이터 0.8초 (합 3.3초)");
});

test("without the sub-steps (a silent or retried sign-in) the summary keeps its old shape", () => {
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 240); markStartup("sessionVerified", 2140); markStartup("firstData", 3040);
  assert.equal(startupTimingSummary(), "설정 0.2초 · 인증 1.9초 · 첫 데이터 0.9초 (합 3.0초)");
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 100); markStartup("sessionRead", 300); markStartup("sessionVerified", 2500);
  assert.equal(startupTimingSummary(), "설정 0.1초 · 인증 2.4초 · 측정 중", "a partial split is not shown");
  resetStartupTimingForTest();
  markStartup("appStart", 0); markStartup("endpointReady", 100); markStartup("tokensSaved", 200); markStartup("tokensRefreshed", 900); markStartup("sessionRead", 1000); markStartup("sessionVerified", 2500);
  assert.equal(startupTimingSummary(), "설정 0.1초 · 인증 2.4초 · 측정 중", "marks out of order are not shown");
});

test("the bearer restore records the three steps", () => {
  const src = fs.readFileSync("apps/mobile/src/mobileApprovedSession.ts", "utf8");
  for (const mark of ["sessionRead", "tokensRefreshed", "tokensSaved"]) assert.match(src, new RegExp(`markStartup\\("${mark}"\\)`));
  assert.ok(src.indexOf('markStartup("sessionRead")') < src.indexOf('markStartup("tokensRefreshed")') && src.indexOf('markStartup("tokensRefreshed")') < src.indexOf('markStartup("tokensSaved")'));
});
