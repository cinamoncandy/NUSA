const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");

test("desktop startup records an explicit observed Paper session before market streaming", () => {
  const sessionCall = source.indexOf("evidenceRecorder.sessionObserved(");
  const streamStart = source.indexOf("stream.start()");
  assert.ok(sessionCall >= 0, "desktop startup must record SESSION_OBSERVED evidence");
  assert.ok(streamStart > sessionCall, "the observed-session event must be persisted before market streaming starts");
});

test("session evidence uses the same SQLite transaction as runtime state", () => {
  assert.match(source, /append:\s*\(event\)\s*=>\s*\{[\s\S]*saveWithScenarioEvent\(broker\.exportState\(\), control\.exportState\(\), event\)/);
  assert.doesNotMatch(source, /sessionObserved[\s\S]{0,200}persistRuntime\(\)/);
});

test("missing session evidence persistence fails closed", () => {
  const block = source.match(/if \(paperTradingAvailable\) \{[\s\S]*?stream = new UpbitWebSocketClient/);
  assert.ok(block, "startup availability block is required");
  assert.match(block[0], /Paper evidence recorder is unavailable/);
  assert.match(block[0], /control\.fault\(PERSISTENCE_FAULT_MESSAGE\)/);
  assert.match(block[0], /runtime\.markUnavailable\(\)/);
});
