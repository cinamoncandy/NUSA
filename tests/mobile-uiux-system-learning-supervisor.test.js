const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const cockpit = fs.readFileSync(path.join(root, "apps/mobile/src/paperShadowMonitorView.tsx"), "utf8");
const view = fs.readFileSync(path.join(root, "apps/mobile/src/systemLearningSupervisorView.tsx"), "utf8");
const client = fs.readFileSync(path.join(root, "apps/mobile/src/evolutionLearningSupervisorClient.ts"), "utf8");

test("system learning is a distinct read-only supervisor mode, not PAPER learning", () => {
  assert.match(cockpit, /"PAPER", "SYSTEM", "SHADOW", "REAL", "LIVE_READY"/);
  assert.match(cockpit, /SYSTEM LEARNING/);
  assert.match(cockpit, /SystemLearningSupervisorView/);
  assert.match(cockpit, /InMemoryDashboardCredentialSession/);
});

test("system learning presents result before progressively disclosed evidence", () => {
  const result = view.indexOf('testID="system-learning-latest"');
  const toggle = view.indexOf('testID="system-learning-evidence-toggle"');
  const details = view.indexOf('testID="system-learning-evidence-details"');
  assert.ok(result >= 0 && toggle > result && details > toggle);
  assert.match(view, /VALIDATION/);
  assert.match(view, /REUSABLE/);
  assert.match(view, /headHash\.slice/);
  assert.match(view, /evidenceReferences\.map/);
});

test("system learning surface keeps zero-authority truth visible", () => {
  assert.match(view, /READ ONLY · AI ZERO AUTHORITY · LIVE NONE/);
  assert.match(view, /전략 승격, 주문, 자본 변경 권한을 갖지 않습니다/);
  assert.match(client, /validateEvolutionLearningSupervisorSnapshot/);
  assert.match(client, /redirect: "error"/);
  assert.match(client, /connection changed while the request was in flight/);
});

test("empty or unavailable learning evidence remains truthful", () => {
  assert.match(view, /아직 검증된 시스템 학습 기록이 없습니다/);
  assert.match(view, /system-learning-unavailable/);
  assert.doesNotMatch(view, /confidence|score|percent/i);
});
