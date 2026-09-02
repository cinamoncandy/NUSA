const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../apps/desktop/renderer/simple-ui.js"), "utf8");

test("connection truth keeps NUSA server and Upbit market state independent", () => {
  assert.match(source, /serverConnectionCode:\s*"unknown"/);
  assert.match(source, /serverLastSuccessAt:\s*null/);
  assert.match(source, /function marketConnection\(\)/);
  assert.match(source, /function serverConnection\(\)/);
  assert.match(source, /서버 · 업비트 정상/);
  assert.match(source, /data-simple-server-status/);
});

test("validated Upbit ticker repairs a missed initial connected event", () => {
  assert.match(source, /if \(finite\(ticker\?\.trade_price\)\) \{[\s\S]*state\.connectionCode = "connected"/);
});

test("canonical Cloud snapshot drives server reachability without local fallback", () => {
  assert.match(source, /readResult\(api\?\.getSnapshot/);
  assert.match(source, /if \(snapshotResult\.ok\) \{[\s\S]*markServerConnected\(\)/);
  assert.match(source, /else \{[\s\S]*markServerDisconnected\(\)/);
  assert.match(source, /api\.onSnapshot\(\(value\) => \{ markServerConnected\(\)/);
  assert.doesNotMatch(source, /PaperBroker/);
});

test("server disconnect detection is bounded and recovers on later snapshots", () => {
  assert.match(source, /SERVER_SNAPSHOT_STALE_MS = 7_000/);
  assert.match(source, /Date\.now\(\) - state\.serverLastSuccessAt > SERVER_SNAPSHOT_STALE_MS/);
  assert.match(source, /global\.setInterval/);
  assert.match(source, /global\.clearInterval/);
});

test("Paper action and final mutation gates require combined server and market connection", () => {
  assert.match(source, /const \[connectionTone\] = overallConnection\(\)/);
  assert.match(source, /button\.disabled = !\(connectionTone === "connected"/);
  assert.match(source, /if \(connectionTone !== "connected" \|\| !state\.pendingOrder/);
});

test("connection truth remains observational and does not add REAL authority", () => {
  assert.doesNotMatch(source, /liveAuthority\s*=\s*["'](?!NONE)/);
  assert.doesNotMatch(source, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(source, /withdraw|transfer/i);
});
