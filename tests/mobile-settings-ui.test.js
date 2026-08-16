const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("production Settings exposes automatic Cloud status without infrastructure inputs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");
  assert.match(source, /testID="settings-screen"/);
  assert.match(source, /testID="settings-cloud-connection"/);
  assert.match(source, /서버 위치는 앱이 관리합니다/);
  assert.match(source, /NUSA Cloud 경유/);
  assert.doesNotMatch(source, /settings-paper-endpoint|settings-paper-token|settings-paper-connect|settings-paper-disconnect|UpbitConnectionPanel|operatorToken|credentialSession\.connect/);
  assert.match(source, /PAPER ONLY/);
  assert.match(source, /Production mutation/);
  assert.match(source, /AI authority/);
});

test("App uses canonical build origin and never replaces Home with setup", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /tryReadCanonicalNusaOrigin/);
  assert.match(app, /markPaperConnectionVerified\(canonicalOrigin\)/);
  assert.match(app, /const requiresDashboardConnection = false/);
  assert.doesNotMatch(app, /settings\.paperEndpoint/);
});
