const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mobile = path.resolve(__dirname, "../apps/mobile");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

test("UIUX-002 preserves stable five-tab keys while presenting product navigation", () => {
  const app = read("App.tsx");
  assert.match(app, /const tabs = \["Home", "Markets", "Trade", "Portfolio", "More"\] as const/);
  assert.match(app, /Home: "홈"/);
  assert.match(app, /Markets: "시장"/);
  assert.match(app, /Trade: "PAPER"/);
  assert.match(app, /Portfolio: "자산"/);
  assert.match(app, /More: "AI"/);
  assert.match(app, /activeTab === "More" \? <AiView/);
});

test("mobile intelligence shell displays real AI projection and truthful scoped authority state", () => {
  const app = read("App.tsx");
  const aiView = read("src/aiView.tsx");
  const components = read("src/components.tsx");
  assert.match(app, /const ai = snapshot\?\.ai \?\? null/);
  assert.match(aiView, /AI ZERO AUTHORITY/);
  assert.match(aiView, /READ ONLY/);
  assert.match(components, /AI는 주문, 이체, 출금 또는 운영 상태를 변경할 권한이 없습니다/);
  assert.doesNotMatch(app, /94%/);
});

test("PAPER surface stays PAPER-only and fails closed without a mobile session", () => {
  const app = read("App.tsx");
  const trading = read("src/tradingView.tsx");
  assert.match(app, /<TradingView[^>]*snapshot=/s);
  assert.match(trading, /PAPER 주문 작업공간/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /unavailableDashboardCredentialProvider/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.doesNotMatch(trading, /authority:\s*"LIVE"|productionMutationAllowed:\s*true/);
});

test("production Settings owns no dashboard credential and no infrastructure input", () => {
  const app = read("App.tsx");
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /settings-cloud-connection/);
  assert.match(settings, /서버 위치는 앱이 관리합니다/);
  assert.doesNotMatch(settings, /InMemoryDashboardCredentialSession|credentialSession\.connect|settings-paper-endpoint|settings-paper-token/);
  assert.match(app, /tryReadCanonicalNusaOrigin/);
  assert.doesNotMatch(app, /settings\.paperEndpoint/);
});
