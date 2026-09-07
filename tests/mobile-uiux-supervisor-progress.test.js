const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "apps/mobile/src/homeView.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "apps/mobile/src/supervisorProgressPanel.tsx"), "utf8");
const client = fs.readFileSync(path.join(root, "apps/mobile/src/operationalProgressClient.ts"), "utf8");
const contract = fs.readFileSync(path.join(root, "packages/contracts/src/operationalProgress.ts"), "utf8");

test("Canonical HOME does not restore the retired Supervisor progress panel", () => {
  assert.doesNotMatch(home, /<SupervisorProgressPanel/);
  assert.doesNotMatch(home, /home-supervisor-progress-attention/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /testID="home-now"/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /testID="ai-card"/);
  assert.match(home, /testID="home-risk-status"/);
  assert.match(home, /testID="home-decision-stage"/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});

test("Supervisor progress remains a truthful reusable read-only projection", () => {
  assert.match(panel, /loadOperationalProgress/);
  assert.match(panel, /InMemoryDashboardCredentialSession/);
  assert.match(panel, /getConfiguredPaperEndpoint/);
  assert.match(client, /validateOperationalProgressSnapshot/);
  assert.match(contract, /authority: "READ_ONLY"/);
  assert.match(contract, /scope: "OPERATIONAL_EVIDENCE_ONLY"/);
});

test("Supervisor progress surfaces attention before progress and expandable evidence provenance", () => {
  const attention = panel.indexOf('testID="home-supervisor-progress-attention"');
  const progress = panel.indexOf('testID="home-supervisor-progress-ratio"');
  const evidenceToggle = panel.indexOf('testID="home-supervisor-progress-toggle"');
  const evidence = panel.indexOf('testID="home-supervisor-progress-evidence"');
  assert.ok(attention >= 0 && progress > attention && evidenceToggle > progress && evidence > evidenceToggle);
  assert.match(panel, /primaryBlocker/);
  assert.match(panel, /blockerCount/);
  assert.match(panel, /snapshot\.headSha/);
  assert.match(panel, /snapshot\.domains\.map/);
  assert.match(panel, /snapshot\.reasons/);
});

test("Unavailable or stale progress never falls back to invented percentages", () => {
  assert.match(panel, /state\.status !== "READY"/);
  assert.match(panel, /검증된 운영 진척도 없음/);
  assert.doesNotMatch(panel, /72%|80%|90%/);
});
