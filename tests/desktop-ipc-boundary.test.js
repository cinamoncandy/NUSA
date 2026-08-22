const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("desktop IPC rejects coerced control values and public market data remains observable during Paper recovery", () => {
  const source = readFileSync("apps/desktop/src/main.ts", "utf8");
  // control:auto/control:quantity input validation lives in registerControlIpcHandlers.ts.
  const controlIpcSource = readFileSync("apps/desktop/src/ipc/registerControlIpcHandlers.ts", "utf8");
  assert.match(controlIpcSource, /typeof enabled !== "boolean"/);
  assert.match(controlIpcSource, /typeof quantity !== "number" \|\| !Number\.isFinite\(quantity\)/);
  assert.doesNotMatch(controlIpcSource, /setAutoTrade\(Boolean\(enabled\)\)/);
  // paper:order input validation lives in registerPaperIpcHandlers.ts.
  const paperIpcSource = readFileSync("apps/desktop/src/ipc/registerPaperIpcHandlers.ts", "utf8");
  assert.match(paperIpcSource, /typeof candidate\.quantity !== "number" \|\| !Number\.isFinite\(candidate\.quantity\)/);
  assert.match(source, /Public market data is safe to observe even while Paper execution is unavailable/);
  assert.match(source, /\n\s*stream\.start\(\);/);
  assert.doesNotMatch(source, /if \(paperTradingAvailable\) stream\.start\(\)/);
  assert.doesNotMatch(source, /fetch\(|axios|Authorization|jwt|withdraw/i);
  assert.doesNotMatch(controlIpcSource, /fetch\(|axios|Authorization|jwt|withdraw/i);
  assert.doesNotMatch(paperIpcSource, /fetch\(|axios|Authorization|jwt|withdraw/i);
});

test("mutating IPC commands are not automatically retried", () => {
  const source = readFileSync("apps/desktop/src/preload.ts", "utf8");
  assert.match(source, /const invokeMutation/);
  assert.match(source, /placeOrder: .*invokeMutation\("cloud-paper:order"/);
  assert.match(source, /const automaticUnavailable = .*invokeMutation<T>\("cloud-paper:automatic-unavailable"\)/);
  assert.match(source, /startStrategy: \(\) => automaticUnavailable<ControlSnapshot>\(\)/);
  assert.match(source, /stopStrategy: \(\) => invokeMutation\("control:stop"\)/);
  assert.match(source, /setAutoTrade: .*automaticUnavailable<ControlSnapshot>\(\).*invokeMutation\("control:auto", false\)/);
  assert.match(source, /setStrategyQuantity: .*automaticUnavailable<ControlSnapshot>\(\)/);
  assert.match(source, /releaseKillSwitch: .*invokeMutation\("safety:kill-switch-release"/);
  assert.match(source, /activateKillSwitch: .*invokeMutation\("safety:kill-switch-activate"/);
  assert.doesNotMatch(source, /placeOrder: .*invokeReadWithRecovery/);
  assert.doesNotMatch(source, /invokeReadWithRecovery[^\n]*"cloud-paper:order"/);
});

test("desktop execution requires fresh connected market data and a runtime readiness provider", () => {
  const source = readFileSync("apps/desktop/src/main.ts", "utf8");
  assert.match(source, /function assertFreshMarketData\(\)/);
  assert.match(source, /if \(!websocketConnected\) throw new Error\("market data connection is unavailable"\)/);
  assert.match(source, /market price is stale; wait for a fresh ticker/);
  assert.match(source, /evaluateOperationalReadiness\(input\)/);
  assert.doesNotMatch(source, /\}, undefined, evidenceRecorder\)/);
  assert.match(source, /status\.startsWith\("stale"\)/);
  // control:auto's fresh-market-data gate lives in registerControlIpcHandlers.ts.
  const controlIpcSource = readFileSync("apps/desktop/src/ipc/registerControlIpcHandlers.ts", "utf8");
  assert.match(controlIpcSource, /if \(enabled\) ctx\.assertFreshMarketData\(\)/);
});

test("shadow start performs the same read-only preflight before creating a session", () => {
  const source = readFileSync("apps/desktop/src/ipc/registerShadowIpcHandlers.ts", "utf8");
  assert.match(source, /ipcMain\.handle\("shadow:preflight", \(\) => ctx\.shadowRuntime\.startPrecheckBlockers\(false\)\)/);
  assert.match(source, /parseShadowStartIpc\(input\);\s*const blockers = ctx\.shadowRuntime\.startPrecheckBlockers\(false\);\s*if \(blockers\.length > 0\) throw new Error/);
});