const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("shared text field forwards native input semantics and truthful disabled state", () => {
  const source = read("apps/mobile/src/components.tsx");
  assert.match(source, /type TextInputProps/);
  assert.match(source, /accessibilityState=\{\{ disabled: !editable \}\}/);
  assert.match(source, /editable=\{editable\}/);
});

test("production Settings has no connection mutation or bearer input", () => {
  const source = read("apps/mobile/src/settingsView.tsx");
  assert.match(source, /settings-cloud-connection/);
  assert.match(source, /서버 위치는 앱이 관리합니다/);
  assert.doesNotMatch(source, /endpointDraft|tokenDraft|operatorToken|credentialSession\.connect|settings-paper-endpoint|settings-paper-token|allowUnverifiedEndpoint/);
});

test("PAPER transport uses canonical endpoint state and an unavailable mobile session fails closed", () => {
  const app = read("apps/mobile/App.tsx");
  const operations = read("apps/mobile/src/personalPaperOperationsClient.ts");
  assert.match(app, /tryReadCanonicalNusaOrigin/);
  assert.match(app, /setConfiguredPaperEndpoint\(canonicalOrigin\)/);
  assert.match(app, /unavailableDashboardCredentialProvider/);
  assert.match(operations, /NUSA Cloud mobile session is unavailable/);
  assert.doesNotMatch(app, /settings\.paperEndpoint/);
});

test("PAPER order inputs are numeric-first and locked during an in-flight submit", () => {
  const source = read("apps/mobile/src/tradingView.tsx");
  assert.match(source, /keyboardType="decimal-pad" label="지정 가격"/);
  assert.match(source, /keyboardType="decimal-pad" label=\{`수량/);
  assert.match(source, /disabled=\{!submitEnabled\}/);
  assert.match(source, /productionMutationAllowed: false/);
});
