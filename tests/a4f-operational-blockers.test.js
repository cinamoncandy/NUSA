const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
// diagnostics:a4's activationSource field lives in registerDiagnosticsIpcHandlers.ts.
const diagnosticsIpcSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "ipc", "registerDiagnosticsIpcHandlers.ts"), "utf8");

test("A4F does not map generic FAULTED control status to Kill Switch or P0", () => {
  assert.match(mainSource, /getControl:\s*\(\)\s*=>\s*\(\{ killSwitchActive: persistedKillSwitchActive, openP0: persistedOpenP0Codes\.length > 0 \}\)/);
  assert.match(mainSource, /killSwitch:\s*persistedKillSwitchActive/);
  assert.match(mainSource, /openP0:\s*persistedOpenP0Codes\.length > 0/);
  assert.doesNotMatch(mainSource, /getControl:\s*\(\)\s*=>[\s\S]{0,180}control\.snapshot\(\)\.status === "FAULTED"/);
});

test("A4F starts public market data independently of Paper execution availability", () => {
  assert.match(mainSource, /Public market data is safe to observe even while Paper execution is unavailable/);
  assert.match(mainSource, /\n\s*stream\.start\(\);/);
  assert.doesNotMatch(mainSource, /if \(paperTradingAvailable\) stream\.start\(\);/);
});

test("A4F preserves fail-closed recovery reconciliation", () => {
  assert.match(mainSource, /operationalPreflight\.reconciliation\.status === "PASS" && !safetyRecoveryBlocked/);
  assert.match(diagnosticsIpcSource, /activationSource: ctx\.persistedKillSwitchActive \? "PERSISTED_PAPER_SAFETY_SNAPSHOT" : null/);
});
