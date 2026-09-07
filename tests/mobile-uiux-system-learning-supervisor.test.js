const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const cockpit = fs.readFileSync(path.join(root, "apps/mobile/src/paperShadowMonitorView.tsx"), "utf8");
const view = fs.readFileSync(path.join(root, "apps/mobile/src/systemLearningSupervisorView.tsx"), "utf8");
const client = fs.readFileSync(path.join(root, "apps/mobile/src/evolutionLearningSupervisorClient.ts"), "utf8");
const contract = fs.readFileSync(path.join(root, "packages/contracts/src/evolutionLearningSupervisor.ts"), "utf8");
const projection = fs.readFileSync(path.join(root, "apps/cloud/src/evolutionLearningSupervisorProjection.ts"), "utf8");

test("system learning is a distinct read-only supervisor mode, not PAPER learning", () => {
  assert.match(cockpit, /BASE_MODES = \["PAPER", "SHADOW", "REAL"\]/);
  assert.match(cockpit, /"SYSTEM"/);
  assert.match(cockpit, /SYSTEM LEARNING/);
  assert.match(cockpit, /SystemLearningSupervisorView/);
  assert.match(cockpit, /InMemoryDashboardCredentialSession/);
});

test("system learning presents attention, freshness and result before progressively disclosed evidence", () => {
  const attention = view.indexOf('testID="system-learning-attention"');
  const freshness = view.indexOf('testID="system-learning-freshness"');
  const result = view.indexOf('testID="system-learning-latest"');
  const historyToggle = view.indexOf('testID="system-learning-history-toggle"');
  const evidenceToggle = view.indexOf('testID="system-learning-evidence-toggle"');
  const details = view.indexOf('testID="system-learning-evidence-details"');
  assert.ok(attention >= 0 && freshness > attention && result > freshness && historyToggle > result && evidenceToggle > historyToggle && details > evidenceToggle);
  assert.match(view, /VALIDATION/);
  assert.match(view, /REUSABLE/);
  assert.match(view, /headHash\.slice/);
  assert.match(view, /evidenceReferences\.map/);
});

test("system learning freshness is deterministic from recordedAt and does not invent confidence", () => {
  assert.match(view, /FRESH_EVIDENCE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(view, /STALE_EVIDENCE_MS = 72 \* 60 \* 60 \* 1000/);
  assert.match(view, /Date\.parse\(recordedAt\)/);
  assert.match(view, /ageMs < 0/);
  assert.match(view, /label: "FRESH"/);
  assert.match(view, /label: "AGING"/);
  assert.match(view, /label: "STALE"/);
  assert.match(view, /현재 상태를 대표한다고 가정하지 않습니다/);
  assert.doesNotMatch(view, /confidence|score|percent/i);
});

test("system learning recent history is bounded canonical evidence with no invented trend score", () => {
  assert.match(contract, /MAX_RECENT = 5/);
  assert.match(contract, /recent\?: readonly EvolutionLearningSupervisorRecord\[\]/);
  assert.match(contract, /recent evidence must be newest first/);
  assert.match(projection, /RECENT_LIMIT = 5/);
  assert.match(projection, /replay\.records\.slice\(-RECENT_LIMIT\)\.reverse\(\)/);
  assert.match(view, /ready\?\.recent\?\.slice\(1\)/);
  assert.match(view, /RECENT LEARNING/);
  assert.match(view, /system-learning-history/);
  assert.doesNotMatch(view, /growth|trend|confidence|score|percent/i);
});

test("system learning attention is deterministic from recorded outcome only", () => {
  assert.match(view, /outcome === "FAILED" \|\| outcome === "REGRESSION"/);
  assert.match(view, /outcome === "PARTIAL_SUCCESS" \|\| outcome === "UNDERPERFORMED"/);
  assert.match(view, /outcome === "SUCCESS"/);
  assert.match(view, /label: "REVIEW"/);
  assert.match(view, /label: "WATCH"/);
  assert.match(view, /label: "CLEAR"/);
  assert.match(view, /label: "INSUFFICIENT"/);
  assert.doesNotMatch(view, /confidence|score|percent/i);
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
});
