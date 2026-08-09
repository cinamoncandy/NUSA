const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("Home presents financial status first with real Portfolio navigation", () => {
  const app = read("App.tsx");
  const home = read("src/homeView.tsx");
  assert.match(app, /FINANCIAL COMMAND CENTER/);
  assert.match(app, /자산과 손익, AI 인사이트, 안전 상태를 우선 표시합니다/);
  assert.match(app, /<HomeSnapshotContent/);
  assert.match(app, /onOpenPortfolio=\{\(\) => \{ setUtilityView\(null\); setActiveTab\("Portfolio"\); \}\}/);
  assert.match(home, /testID="home-financial-card"/);
  assert.match(home, /PAPER EQUITY/);
  assert.match(home, /계정 누적 손익/);
  assert.match(home, /전체 포지션 평가액/);
  assert.match(home, /testID="home-open-portfolio"/);
});

test("Home presents evidence-backed AI second with a real AI destination", () => {
  const app = read("App.tsx");
  const home = read("src/homeView.tsx");
  assert.match(app, /onOpenAi=\{\(\) => \{ setUtilityView\(null\); setActiveTab\("More"\); \}\}/);
  assert.match(home, /testID="home-ai-insight-card"/);
  assert.match(home, /AI READ ONLY/);
  assert.match(home, /ZERO AUTHORITY/);
  assert.match(home, /ai\.evidenceReferences\.length/);
  assert.match(home, /현재 표시할 AI 분석이 없습니다/);
  assert.match(home, /testID="home-open-ai"/);
});

test("Home keeps safety compact and removes developer-console research details", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /testID="home-safety-card"/);
  assert.match(home, /PAPER 런타임/);
  assert.match(home, /킬 스위치/);
  assert.match(home, /LIVE 권한/);
  assert.match(home, /Production mutation/);
  assert.doesNotMatch(home, /scheduler|pendingWrites|Champion|Challenger|candidateCount|modelVersion|promptVersion|criticSeverity|promptDigest/);
});

test("Home actions remain read-only and dashboard credentials stay outside Home state", () => {
  const app = read("App.tsx");
  const home = read("src/homeView.tsx");
  assert.match(app, /credentialSession\.connect\(dashboardTokenDraft\)/);
  assert.match(app, /프로세스 메모리에만 유지/);
  assert.match(home, /testID="dashboard-disconnect"/);
  assert.doesNotMatch(home, /onSubmit|ORDER_CREATE|cancel|withdraw|transfer|credentialSession|dashboardTokenDraft/);
  assert.doesNotMatch(home, /#[0-9a-fA-F]{3,8}/);
});
