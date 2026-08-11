const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("settings UI exposes only implemented preferences, Paper safety, reset, and local sign-out", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");
  assert.match(source, /settings-theme/);
  assert.match(source, /settings-notifications/);
  assert.match(source, /settings-mode/);
  assert.match(source, /settings-about/);
  assert.match(source, /settings-reset/);
  assert.match(source, /settings-session/);
  assert.match(source, /settings-capital-allocation/);
  assert.match(source, /실제 투자 가능 금액/);
  assert.match(source, /보호되는 현금 금액/);
  assert.match(source, /settings-sign-out/);
  assert.match(source, /settings-loading/);
  assert.match(source, /settings-error/);
  assert.match(source, /value === "SYSTEM" \? "system"/);
  assert.match(source, /기기의 라이트·다크 설정을 그대로 따릅니다/);
  assert.doesNotMatch(source, /settings-locale-|언어 선택/);
  assert.match(source, /PAPER/);
  assert.match(source, /LIVE trading은 정책상 비활성입니다/);
  assert.match(source, /이 설정 화면에서 권한을 승격할 수 없습니다/);
  assert.match(source, /SettingsRepository/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /header-settings/);
  assert.match(app, /utilityView === "SETTINGS" \? <SettingsView exchangeCash=\{account\?\.cash \?\? 0\} onSignOut=\{handleSignOut\}/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
  assert.match(app, /settingsRepository/);
});
