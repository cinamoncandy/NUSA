const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtime = fs.readFileSync(path.join(__dirname, "../apps/desktop/renderer/app-runtime.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../apps/desktop/renderer/index.html"), "utf8");

test("canonical renderer keeps NUSA server and Upbit market connection truth independent", () => {
  assert.match(runtime, /serverConnectionCode:\s*"unknown"/);
  assert.match(runtime, /serverLastSuccessAt:\s*null/);
  assert.match(runtime, /function marketConnection\(\)/);
  assert.match(runtime, /function serverConnection\(\)/);
  assert.match(runtime, /function overallConnection\(\)/);
  assert.match(runtime, /서버 · 업비트 정상/);
  assert.match(runtime, /업비트 연결 끊김|`업비트 \$\{marketLabel\}`/);
  assert.match(runtime, /`서버 \$\{serverLabel\}`/);
  assert.match(html, /data-simple-connection/);
  assert.match(html, /data-simple-market-status/);
});

test("validated ticker flow repairs a missed initial Upbit connected status", () => {
  assert.match(runtime, /if \(finite\(ticker\?\.trade_price\)\) \{[\s\S]*state\.connectionCode = "connected"/);
  assert.match(runtime, /renderConnection\(\); renderPositions/);
});

test("successful Cloud snapshots mark server connected while failed initial reads fail closed", () => {
  assert.match(runtime, /onSnapshot\(\(value\) => \{ markServerConnected\(\); renderConnection\(\); renderSnapshot\(value\); \}\)/);
  assert.match(runtime, /readResult\(api\?\.getSnapshot/);
  assert.match(runtime, /markServerDisconnected\(\);[\s\S]*초기 Cloud snapshot 연결 실패/);
});

test("stale server snapshots are demoted and Paper orders require both connections", () => {
  assert.match(runtime, /SERVER_SNAPSHOT_STALE_MS = 7_000/);
  assert.match(runtime, /Date\.now\(\) - state\.serverLastSuccessAt > SERVER_SNAPSHOT_STALE_MS/);
  assert.match(runtime, /Cloud snapshot이 stale 상태로 전환됨/);
  assert.match(runtime, /const \[connectionTone\] = overallConnection\(\)/);
  assert.match(runtime, /NUSA 서버와 시장 데이터가 모두 연결되어야 주문할 수 있습니다/);
  assert.match(runtime, /global\.clearInterval\(connectionWatchdog\)/);
});

test("connection-truth successor remains canonical and does not revive simple-ui", () => {
  assert.doesNotMatch(html, /src="simple-ui\.js"/);
  assert.doesNotMatch(html, /href="simple-ui\.css"/);
  assert.match(html, /src="app-runtime\.js"/);
});

test("before any data or control answer the desktop says unknown, never stopped, and does not show the page-load clock as an update", () => {
  // initial HTML defaults are "확인 중", not a claim that the strategy is stopped or automation is off
  assert.doesNotMatch(html, /data-simple-strategy-status>중지됨/);
  assert.doesNotMatch(html, /data-simple-auto-trade>꺼짐/);
  assert.match(html, /data-simple-strategy-status>확인 중/);
  assert.match(html, /모의\(PAPER\) 자동화/);
  // an unknown control state shows "확인 중" and keeps both start and stop disabled
  assert.match(runtime, /const known = control != null;/);
  assert.match(runtime, /const unknownLabel = state\.controlLoadFailed === true \? "확인 불가" : "확인 중"/);
  assert.match(runtime, /!known \? unknownLabel/);
  assert.match(runtime, /button\.disabled = !known \|\| status === "RUNNING"/);
  assert.match(runtime, /button\.disabled = !known \|\| status === "STOPPED"/);
  // only a received snapshot sets the update label; otherwise it says no data yet
  assert.match(runtime, /if \(snapshot\) \{ state\.lastUpdated = new Date\(\);[^}]*데이터 받은 시각/);
  assert.match(runtime, /아직 데이터를 받지 못했습니다/);
  assert.doesNotMatch(runtime, /state\.loading = false; state\.lastUpdated = new Date\(\)/);
});
