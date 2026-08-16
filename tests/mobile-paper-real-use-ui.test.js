const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("fresh install separates local app entry from Cloud authentication", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /NUSA 열기/);
  assert.match(app, /Cloud 모바일 세션 bootstrap이 연결되지 않았습니다/);
  assert.doesNotMatch(app, /testID="auth-email"|testID="auth-password"/);
  assert.doesNotMatch(app, /dashboard-credential/);
});

test("production Settings is not an endpoint or dashboard-token setup screen", () => {
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(settings, /settings-cloud-connection/);
  assert.match(settings, /서버 위치는 앱이 관리합니다/);
  assert.doesNotMatch(settings, /settings-paper-endpoint|settings-paper-token|settings-paper-connect|settings-paper-disconnect|credentialSession\.connect|markPaperConnectionVerified/);
});

test("cold start selects only the build-provided canonical origin", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /tryReadCanonicalNusaOrigin/);
  assert.match(app, /setConfiguredPaperEndpoint\(canonicalOrigin\)/);
  assert.match(app, /markPaperConnectionVerified\(canonicalOrigin\)/);
  assert.doesNotMatch(app, /settings\.paperEndpoint|setConfiguredPaperEndpoint\(""\)/);
});

test("Cloud failure leaves Home mounted and renders unavailable data rather than fake success", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(app, /const requiresDashboardConnection = false/);
  assert.match(app, /<HomeView/);
  assert.match(home, /notConfigured/);
  assert.match(home, /NUSA Cloud 연결 불가/);
});

test("PAPER and AI safety boundaries remain explicit", () => {
  const app = read("apps/mobile/App.tsx");
  const trading = read("apps/mobile/src/tradingView.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(ai, /AI ZERO AUTHORITY/);
});
