const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("settings UI exposes only implemented preferences, PAPER safety, reset, and local sign-out", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");

  assert.match(source, /testID="settings-screen"/);
  assert.match(source, /testID="settings-loading"/);
  assert.match(source, /testID="settings-error"/);
  assert.match(source, /testID="settings-paper-connection"/);
  assert.match(source, /testID="settings-paper-endpoint"/);
  assert.match(source, /testID="settings-paper-token"/);
  assert.match(source, /testID="settings-paper-connect"/);
  assert.match(source, /testID="settings-paper-disconnect"/);

  assert.match(source, /화면 테마/);
  assert.match(source, /themes\.map\(\(value\) => <NusaButton/);
  assert.match(source, /label=\{themeLabels\[value\]\}/);
  assert.match(source, /onPress=\{\(\) => updateTheme\(value\)\}/);
  assert.match(source, /settings\.theme === value \? "primary" : "neutral"/);
  assert.match(source, /value === "SYSTEM" \? "system"/);

  assert.doesNotMatch(source, /updateNotification|전체 알림|리스크 알림|주문 상태 업데이트/);
  assert.doesNotMatch(source, /"enabled", "riskAlerts", "orderUpdates"/);

  assert.match(source, /거래 권한/);
  assert.match(source, /StatusChip label="PAPER ONLY"/);
  assert.match(source, /DataRow label="운영 모드" value="PAPER"/);
  assert.match(source, /DataRow label="LIVE 주문" value="금지"/);
  assert.match(source, /LIVE·출금·이체·production mutation 권한은 없습니다/);

  assert.match(source, /앱 정보/);
  assert.match(source, /NUSA Mobile 0\.1\.0/);
  assert.match(source, /PAPER \/ Personal/);
  assert.match(source, /로컬 설정 초기화/);
  assert.match(source, /onPress=\{resetSettings\}/);
  assert.match(source, /로컬 세션/);
  assert.match(source, /label="개인 모드 종료"/);
  assert.match(source, /onPress=\{onSignOut\}/);

  assert.match(source, /SettingsRepository/);
  assert.match(source, /credentialSession\.clear\(\)/);
  assert.match(source, /clearPaperConnectionVerification\(\)/);
  assert.doesNotMatch(source, /settings-locale-|언어 선택/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);

  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.doesNotMatch(app, /<MoreView/);
  assert.match(app, /header-settings/);
  assert.match(app, /utilityView === "SETTINGS" \? <SettingsView onSignOut=\{handleSignOut\}/);
  assert.match(app, /credentialSession\.clear\(\)/);
  assert.match(app, /signOut\(\)/);
  assert.match(app, /settingsRepository/);
});
