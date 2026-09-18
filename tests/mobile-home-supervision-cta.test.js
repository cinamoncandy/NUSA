const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeDecisionSurface.ts"), "utf8");

test("HOME MASTER keeps connection recovery and supervisor action truthful", () => {
  assert.match(home, /testID="home-operational-notice"/);
  assert.match(home, /PAPER CONNECTION REQUIRED/);
  assert.match(home, /OPEN SETTINGS →/);
  assert.match(home, /onPress=\{props\.onGoSettings\}/);
  assert.match(home, /const disconnected = props\.notConfigured != null && !localPaperActive/);
  assert.match(home, /const decision = buildHomeDecisionSurface\(\{[\s\S]*disconnected,[\s\S]*readOnlyError: props\.readOnlyError != null/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(decisionSurface, /const WATCH_RUNTIME_STATES = new Set\(\["DEGRADED", "STOPPED", "STOPPING"\]\)/);
  assert.match(decisionSurface, /PAPER runtime 상태가 저하되어 감독자의 확인이 필요합니다/);
});
